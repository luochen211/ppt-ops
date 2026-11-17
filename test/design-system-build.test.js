import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import Ajv2020 from "ajv/dist/2020.js";
import { ApplicationService } from "../src/application/service.js";
import { persistedPackProject } from "./helpers/design-pack-project.js";
import { readProject } from "../src/core/project.js";
import { validateProject } from "../src/core/validate.js";
import { compileProjectLayout } from "../src/layout/catalog.js";
import { buildHtml } from "../src/adapters/html.js";
import { buildPptx } from "../src/adapters/pptx.js";

async function fixture(t, model) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-pack-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return { root, ...await persistedPackProject(root, model) };
}
async function slideXml(root, project, name) {
  const file = path.join(root, `${name}.pptx`);
  await buildPptx(project, file);
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  return { xml: await zip.file("ppt/slides/slide1.xml").async("string"), zip };
}
for (const model of ["foundation", "v1"]) test(`persisted ${model} shares reusable resources across HTML and native PPTX`, async (t) => {
  const f = await fixture(t, model);
  const project = await readProject(f.root);
  assert.deepEqual(validateProject(project), []);
  assert.equal(project.pages[0].design_system_layout_id, "layout-cover");
  const plans = compileProjectLayout(project);
  assert.deepEqual(plans[0].design_system, plans[1].design_system);
  const html = await buildHtml(project);
  assert.equal((html.match(/data-component-id="component-tag"/g) ?? []).length, 2);
  assert.equal((html.match(/data-asset-id="asset-mark"/g) ?? []).length, 2);
  assert.match(html, /data:image\/png;base64/);
  const { xml, zip } = await slideXml(f.root, project, "split");
  assert.match(xml, /Reusable safety label/);
  assert.match(xml, /<p:pic>/); assert.match(xml, /<a:t>Resource reuse<\/a:t>/);
  assert.match(await zip.file("ppt/slides/slide2.xml").async("string"), /Reusable safety label/);
  assert.ok(Object.keys(zip.files).some((key) => key.startsWith("ppt/media/") && key.endsWith(".png")));
  // Change only HTML's mapping: its structure changes; PPTX geometry does not.
  f.pack.layouts[0].renderers.html = "html-pack-stacked"; await f.write("pack.json", f.pack);
  const htmlOnly = await readProject(f.root);
  assert.match(await buildHtml(htmlOnly), /class="slide[^\"]*pack-stacked/);
  const unchanged = await slideXml(f.root, htmlOnly, "html-only");
  assert.equal(unchanged.xml, xml);
  // Change only PPTX's mapping: actual image placement moves below copy.
  f.pack.layouts[0].renderers.pptx = "pptx-pack-stacked"; await f.write("pack.json", f.pack);
  const stacked = await readProject(f.root);
  const changed = await slideXml(f.root, stacked, "stacked");
  const picture = (text) => text.match(/<p:pic>[\s\S]*?<\/p:pic>/)[0];
  assert.notEqual(picture(changed.xml), picture(xml));
  assert.equal(await buildHtml(stacked), await buildHtml(htmlOnly));
  assert.deepEqual(project.pages[0].asset_slots, []); // Adapter materialization is detached.
});

test("persisted selectors, typed references and implementations fail explicitly", async (t) => {
  const f = await fixture(t, "v1");
  const invalid = [
    [pack => pack.layouts[0].component_ids = "component-tag", "DESIGN_PACK_INVALID"],
    [pack => pack.layouts[0].asset_ids = [null], "DESIGN_PACK_INVALID"],
    [pack => pack.layouts[0].component_ids = ["missing"], "DESIGN_PACK_RESOURCE_MISSING"],
    [pack => pack.layouts[0].asset_ids = ["component-tag"], "DESIGN_PACK_RESOURCE_INCOMPATIBLE"],
    [pack => pack.layouts[0].component_ids = ["asset-mark"], "DESIGN_PACK_RESOURCE_INCOMPATIBLE"],
    [pack => pack.layouts[0].renderers.html = "unknown-web", "DESIGN_PACK_RENDERER_UNSUPPORTED"],
    [pack => pack.layouts[0].renderers.pptx = "unknown-native", "DESIGN_PACK_RENDERER_UNSUPPORTED"],
    [pack => pack.layouts[0].capacity = { asset_slots: 0 }, "LAYOUT_CAPACITY_EXCEEDED"],
    [pack => pack.components[0].type = "unsupported", "DESIGN_PACK_RESOURCE_INCOMPATIBLE"]
  ];
  for (const [mutate, code] of invalid) {
    const pack = structuredClone(f.pack); mutate(pack); await f.write("pack.json", pack);
    await assert.rejects(async () => compileProjectLayout(await readProject(f.root)), { code });
  }
  await f.write("pack.json", f.pack);
  await f.write("project.json", { ...f.project, design_system_pack_file: "../outside.json" });
  await assert.rejects(readProject(f.root), { code: "PROJECT_PATH_OUTSIDE_ROOT" });
  await f.write("project.json", { ...f.project, design_system_pack_file: undefined });
  await assert.rejects(async () => buildHtml(await readProject(f.root)), { code: "DESIGN_PACK_REQUIRED" });
  await f.write("project.json", f.project);
  await f.write("pages.json", f.pages.map(page => ({ ...page, design_system_layout_id: 42 })));
  const bad = await readProject(f.root);
  assert.ok(validateProject(bad).some(error => error.includes("design_system_layout_id")));
  assert.throws(() => compileProjectLayout(bad), { code: "DESIGN_PACK_INVALID" });
});

test("standalone persisted schemas validate pack paths and page selectors", async (t) => {
  const ajv = new Ajv2020({ strict: false });
  for (const directory of ["schemas", "schemas/v1"]) for (const name of await fs.readdir(new URL(`../${directory}/`, import.meta.url))) {
    if (name.endsWith(".json")) { const schema = JSON.parse(await fs.readFile(new URL(`../${directory}/${name}`, import.meta.url), "utf8")); ajv.addSchema(schema, `https://ppt-ops.local/${directory}/${name}`); }
  }
  for (const model of ["foundation", "v1"]) {
    const f = await fixture(t, model);
    const prefix = model === "v1" ? "v1/" : "";
    for (const [file, field, input] of [["project", "design_system_pack_file", f.project], ["page-spec", "design_system_layout_id", f.pages[0]]]) {
      const schema = JSON.parse(await fs.readFile(new URL(`../schemas/${prefix}${file}.schema.json`, import.meta.url), "utf8"));
      const validate = ajv.getSchema(schema.$id);
      assert.equal(validate(input), true, JSON.stringify(validate.errors));
      for (const value of [42, ""]) assert.equal(validate({ ...input, [field]: value }), false);
    }
  }
});

test("frozen builds retain selected pack semantics after the working pack changes", async (t) => {
  const f = await fixture(t, "v1");
  const app = await ApplicationService.open(f.root);
  t.after(() => app.store.close());
  const result = await app.freezeVersion();
  const version = result.version ?? result;
  f.pack.components[0].text = "Changed after freeze";
  await f.write("pack.json", f.pack);
  const frozen = await app.projectFromVersion(version.id);
  assert.match(await buildHtml(frozen), /Reusable safety label/);
  assert.doesNotMatch(await buildHtml(frozen), /Changed after freeze/);
  assert.match((await slideXml(f.root, frozen, "frozen")).xml, /Reusable safety label/);
});
