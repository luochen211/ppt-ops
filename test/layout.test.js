import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { buildHtml } from "../src/adapters/html.js";
import { buildPptx } from "../src/adapters/pptx.js";
import { validateV1Entity } from "../src/contracts/v1.js";
import { compileProjectLayout, LayoutCapacityError, resolveTheme, TEMPLATE_CATALOG } from "../src/layout/catalog.js";

const theme = { dimensions: { width: 13.333, height: 7.5 }, typography: { heading_font: "Aptos Display", body_font: "Aptos" }, colors: { background: "#FFFFFF", text: "#111111", accent: "#0057FF" }, spacing: { unit: 0.25, page_margin: 0.6 } };
const relations = ["hero", "parallel", "comparison", "sequence", "process", "hierarchy", "cause_effect", "cycle"];

test("catalog provides eight valid semantic templates with independent renderer mappings", () => {
  assert.equal(TEMPLATE_CATALOG.length, 8);
  assert.equal(new Set(TEMPLATE_CATALOG.map(({ id }) => id)).size, 8);
  for (const template of TEMPLATE_CATALOG) {
    assert.deepEqual(validateV1Entity(template, "template"), []);
    assert.match(template.renderers.html, /^layout-/);
    assert.match(template.renderers.pptx, /^layout-/);
  }
});

test("layout plans are deterministic and cover every template family", () => {
  const project = semanticProject();
  const first = compileProjectLayout(project);
  const second = compileProjectLayout(project);
  assert.deepEqual(first, second);
  assert.equal(new Set(first.map(({ template_id }) => template_id)).size, 8);
  for (const plan of first) {
    for (const rectangle of Object.values(plan.geometry)) for (const value of Object.values(rectangle)) assert.ok(Number.isFinite(value) && value >= 0);
  }
});

test("all eight templates render through HTML and native PPTX", async (t) => {
  const project = semanticProject();
  const html = await buildHtml(project);
  for (const template of TEMPLATE_CATALOG) {
    assert.match(html, new RegExp(`template-${template.id}`));
    assert.match(html, new RegExp(`data-html-layout="${template.renderers.html}"`));
  }
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-layout-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const output = path.join(directory, "templates.pptx");
  const result = await buildPptx(project, output);
  assert.equal(result.slideCount, 8);
  const archive = await JSZip.loadAsync(await fs.readFile(output));
  const xml = (await Promise.all(relations.map((_, index) => archive.file(`ppt/slides/slide${index + 1}.xml`).async("string")))).join("\n");
  for (const plan of compileProjectLayout(project)) assert.match(xml, new RegExp(plan.renderer.pptx));
});

test("over-capacity content fails both renderers instead of silently shrinking", async (t) => {
  const project = semanticProject();
  project.pages[0].screen_text.title = "X".repeat(91);
  assert.throws(() => compileProjectLayout(project), (error) => error instanceof LayoutCapacityError && error.code === "LAYOUT_CAPACITY_EXCEEDED");
  await assert.rejects(buildHtml(project), /exceeds template capacity/);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-overflow-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await assert.rejects(buildPptx(project, path.join(directory, "overflow.pptx")), /exceeds template capacity/);
});

test("template and relation mismatch is explicit", () => {
  const project = semanticProject(); project.pages[0].template_id = "template-comparison";
  assert.throws(() => compileProjectLayout(project), /does not support relation hero/);
});

test("theme overrides resolve base, project, then page without changing the base", () => {
  const original = structuredClone(theme);
  const resolved = resolveTheme(theme, { colors: { accent: "#FF0000" }, spacing: { unit: 0.3 } }, { colors: { accent: "#00FF00" }, typography: { heading_font: "Inter" } });
  assert.equal(resolved.colors.accent, "#00FF00");
  assert.equal(resolved.spacing.unit, 0.3);
  assert.equal(resolved.typography.heading_font, "Inter");
  assert.deepEqual(theme, original);
});

function semanticProject() {
  return {
    root: process.cwd(), project: { name: "templates", title: "Template Catalog" }, theme, assets: [],
    pages: relations.map((relation, index) => ({
      id: `page-${String(index + 1).padStart(3, "0")}`, page: index + 1, task: `Explain ${relation}`,
      three_second_message: `${relation} message`, relation, screen_text: { title: `${relation} template`, body: ["Point one", "Point two"] },
      visual_job: `Show ${relation}`, asset_slots: [], status: "approved"
    }))
  };
}
