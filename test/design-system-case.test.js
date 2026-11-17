import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import JSZip from "jszip";
import { validateDesignSystemCase } from "../src/qa/design-system-pack.js";
import { buildHtml } from "../src/adapters/html.js";
import { buildPptx } from "../src/adapters/pptx.js";

async function fixture() {
  const root = fileURLToPath(new URL("./fixtures/design-system-pack/", import.meta.url));
  return { ...JSON.parse(await fs.readFile(path.join(root, "multipage-reuse.json"), "utf8")), root };
}

test("six semantic pages build reusable components and images in both independent outputs", async t => {
  const f = await fixture();
  const result = await validateDesignSystemCase(f);
  assert.equal(result.automated.passed, true, JSON.stringify(result));
  assert.equal(result.automated.semantic_layouts, 6);
  assert.equal(result.automated.asset_types, 3);
  assert.deepEqual(result.automated.renderers, { html: "passed", pptx: "passed" });
  assert.deepEqual(result.gates, { powerpoint: "pending", human_visual_review: "pending" });
  assert.equal(result.status, "automated_passed_human_pending");
  const input = { ...f, assets: [], designSystemPack: f.pack };
  const html = await buildHtml(input);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-case-output-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, "case.html"), html);
  const output = path.join(directory, "case.pptx");
  await buildPptx(input, output);
  const zip = await JSZip.loadAsync(await fs.readFile(output));
  for (const [i, page] of f.pages.entries()) {
    const layout = f.pack.layouts.find(l => l.id === page.design_system_layout_id);
    const section = html.match(new RegExp(`<section[^>]*data-page="${i + 1}"[\\s\\S]*?</section>`))[0];
    const xml = await zip.file(`ppt/slides/slide${i + 1}.xml`).async("string");
    assert.ok(section.includes(page.screen_text.title));
    assert.ok(xml.includes(page.screen_text.title));
    for (const id of layout.component_ids) {
      assert.ok(section.includes(`data-component-id="${id}"`));
      assert.ok(xml.includes(f.pack.components.find(c => c.id === id).text));
    }
    const rels = await zip.file(`ppt/slides/_rels/slide${i + 1}.xml.rels`).async("string");
    for (const id of layout.asset_ids) {
      const asset = f.pack.assets.find(a => a.id === id);
      assert.ok(section.includes(`data-asset-id="${id}"`));
      const bytes = await fs.readFile(path.join(f.root, asset.source));
      assert.ok(section.includes(bytes.toString("base64")));
      const targets = [...rels.matchAll(/Target="([^\"]+)"/g)].map(m => path.posix.normalize(`ppt/slides/${m[1]}`));
      const media = await Promise.all(targets.filter(name => name.startsWith("ppt/media/")).map(name => zip.file(name).async("nodebuffer")));
      assert.ok(media.some(buffer => buffer.equals(bytes)), `page ${i + 1} embeds ${id}`);
    }
    assert.match(xml, /<p:pic>/);
  }
});

const invalid = [
  ["unsupported version", f => f.pack.contract_version = "999"],
  ["missing renderer", f => delete f.pack.layouts[0].renderers],
  ["unregistered renderer", f => f.pack.layouts[0].renderers.pptx = "missing"],
  ["missing resource", f => f.pack.layouts[0].asset_ids = ["missing"]],
  ["wrong resource type", f => f.pack.layouts[0].component_ids = ["asset-grid"]],
  ["missing source file", f => f.pack.assets[0].source = "missing.png"],
  ["unbuildable page", f => delete f.pages[0].screen_text],
  ["overflow", f => f.pages[0].screen_text.title = "X".repeat(91)],
  ["unused semantic layouts", f => f.pages = [f.pages[0], { ...f.pages[0], id: "page-extra", page: 2 }]],
  ["duplicate page identities", f => f.pages[1] = structuredClone(f.pages[0])],
  ["duplicate missing IDs on one page", f => { f.pages = [f.pages[0]]; f.pack.layouts[0].component_ids = ["missing", "missing"]; }],
];
for (const [name, mutate] of invalid) test(`case cannot pass with ${name}`, async () => {
  const f = await fixture(); mutate(f);
  const result = await validateDesignSystemCase(f);
  assert.equal(result.status, "failed");
  assert.equal(result.automated.passed, false);
  assert.ok(result.findings.length);
  assert.deepEqual(result.gates, { powerpoint: "pending", human_visual_review: "pending" });
});
