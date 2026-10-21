import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { indexDesignSystemPack, migrateLegacyTemplate, normalizeDesignSystemPack, resolveDesignSystemResource } from "../src/templates/design-system-pack.js";
import { compileProjectLayout } from "../src/layout/catalog.js";
import { inspectDesignSystemPack, validateDesignSystemCase } from "../src/qa/design-system-pack.js";

test("normalizes the versioned Design System Pack contract", () => {
  const pack = normalizeDesignSystemPack({ kind: "design_system_pack", id: "design-pack-blue", name: "Blue", tokens: { colors: {}, typography: {}, spacing: {} }, components: [], layouts: [], assets: [] });
  assert.equal(pack.contract_version, "1.0");
  assert.equal(pack.kind, "design_system_pack");
});

test("migrates a legacy reference without claiming a complete system", () => {
  const pack = migrateLegacyTemplate({ id: "legacy-blue", name: "Legacy Blue", reference_image: "references/blue.png" });
  assert.equal(pack.assets[0].type, "reference");
  assert.deepEqual(pack.layouts, []);
  assert.deepEqual(pack.migration, { status: "legacy-reference-only", source_template_id: "legacy-blue", requires_review: true });
});

test("rejects incomplete packs explicitly", () => {
  assert.throws(() => normalizeDesignSystemPack({ kind: "design_system_pack", id: "x", name: "X", tokens: {}, components: [], layouts: [], assets: [] }), (error) => error.code === "DESIGN_PACK_INVALID");
});

test("indexes six layouts and three visual asset types by stable ID", () => {
  const pack = completePack();
  const index = indexDesignSystemPack(pack);
  assert.deepEqual(index.metrics, { layouts: 6, asset_types: 3 });
  assert.equal(resolveDesignSystemResource(index, "layout-cover", "layout").semantic_family, "hero");
  assert.throws(() => resolveDesignSystemResource(index, "asset-grid", "component"), (error) => error.code === "DESIGN_PACK_RESOURCE_INCOMPATIBLE");
});

test("rejects duplicate and dangling resource IDs", () => {
  const duplicate = completePack(); duplicate.assets[1].id = duplicate.assets[0].id;
  assert.throws(() => indexDesignSystemPack(duplicate), (error) => error.code === "DESIGN_PACK_RESOURCE_DUPLICATE");
  const dangling = completePack(); dangling.relationships.push({ from: "layout-cover", to: "asset-missing", relation: "uses" });
  assert.throws(() => indexDesignSystemPack(dangling), (error) => error.code === "DESIGN_PACK_RESOURCE_MISSING");
});

test("Design and Build share IDs while renderers stay independent", () => {
  const pack = completePack();
  pack.layouts[0] = { ...pack.layouts[0], template_id: "template-hero", component_ids: ["component-title"], asset_ids: ["asset-grid"], renderers: { html: "design-cover-web", pptx: "design-cover-native" } };
  const project = { project: {}, theme: { dimensions: { width: 13.333, height: 7.5 }, typography: {}, colors: {}, spacing: { page_margin: 0.6 } }, assets: [], designSystemPack: pack, pages: [{ id: "page-1", page: 1, relation: "hero", design_system_layout_id: "layout-cover", screen_text: { title: "Cover", body: [] }, three_second_message: "One system", asset_slots: [] }] };
  const [plan] = compileProjectLayout(project);
  assert.deepEqual(plan.design_system, { pack_id: "design-pack-blue", layout_id: "layout-cover", component_ids: ["component-title"], asset_ids: ["asset-grid"] });
  assert.deepEqual(plan.renderer, { html: "design-cover-web", pptx: "design-cover-native" });
});

test("QA reports missing resources and capacity overflow by page", () => {
  const project = selectedProject();
  project.designSystemPack.layouts[0].asset_ids = ["asset-missing"];
  let report = inspectDesignSystemPack(project);
  assert.equal(report.findings[0].code, "DESIGN_PACK_RESOURCE_MISSING");
  project.designSystemPack.layouts[0].asset_ids = ["asset-grid"];
  project.pages[0].screen_text.title = "X".repeat(91);
  report = inspectDesignSystemPack(project);
  assert.equal(report.findings[0].code, "LAYOUT_CAPACITY_EXCEEDED");
  assert.equal(report.findings[0].page_id, "page-1");
});

test("QA preserves an explicit legacy migration review gate", () => {
  const project = selectedProject(); project.designSystemPack = migrateLegacyTemplate({ id: "old", name: "Old", reference_image: "old.png" });
  delete project.pages[0].design_system_layout_id;
  const report = inspectDesignSystemPack(project);
  assert.equal(report.status, "review_required");
  assert.equal(report.findings[0].code, "DESIGN_PACK_MIGRATION_REVIEW_REQUIRED");
});

test("multipage case proves reuse while PowerPoint and human gates stay separate", async () => {
  const fixture = JSON.parse(await fs.readFile(new URL("./fixtures/design-system-pack/multipage-reuse.json", import.meta.url), "utf8"));
  const result = validateDesignSystemCase(fixture);
  assert.equal(result.status, "automated_passed_human_pending");
  assert.equal(result.automated.semantic_layouts, 6);
  assert.equal(result.automated.asset_types, 3);
  assert.ok(result.automated.reused_resource_ids.includes("component-title"));
  assert.deepEqual(result.gates, { powerpoint: "pending", human_visual_review: "pending" });
});

function completePack() {
  return {
    kind: "design_system_pack", id: "design-pack-blue", name: "Technical Blue", tokens: { colors: { accent: "#0057ff" }, typography: { heading: "Aptos" }, spacing: { unit: 8 } },
    components: [{ id: "component-title" }, { id: "component-card" }],
    layouts: ["cover", "statement", "comparison", "sequence", "evidence", "closing"].map((name, index) => ({ id: `layout-${name}`, semantic_family: index === 0 ? "hero" : name, template_id: index === 0 ? "template-hero" : "template-statement", renderers: { html: `design-${name}-web`, pptx: `design-${name}-native` } })),
    assets: [{ id: "asset-grid", type: "background" }, { id: "asset-arrow", type: "icon" }, { id: "asset-orbit", type: "illustration" }],
    relationships: [{ from: "layout-cover", to: "asset-grid", relation: "uses" }]
  };
}

function selectedProject() {
  const pack = completePack();
  pack.layouts[0] = { ...pack.layouts[0], component_ids: ["component-title"], asset_ids: ["asset-grid"] };
  return { project: {}, theme: { dimensions: { width: 13.333, height: 7.5 }, typography: {}, colors: {}, spacing: { page_margin: 0.6 } }, assets: [], designSystemPack: pack, pages: [{ id: "page-1", page: 1, relation: "hero", design_system_layout_id: "layout-cover", screen_text: { title: "Cover", body: [] }, three_second_message: "One system", asset_slots: [] }] };
}
