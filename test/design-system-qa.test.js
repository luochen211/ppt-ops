import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { persistedPackProject } from "./helpers/design-pack-project.js";
import { readProject } from "../src/core/project.js";
import { inspectDesignSystemPack } from "../src/qa/design-system-pack.js";
import { inspectPresentation } from "../src/qa/index.js";
import { reviewProject } from "../src/review/index.js";
import { buildPptx } from "../src/adapters/pptx.js";
import { migrateLegacyTemplate } from "../src/templates/design-system-pack.js";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-pack-qa-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await persistedPackProject(root);
  return readProject(root);
}

for (const [name, mutate, code] of [
  ["asset used as component", p => { p.designSystemPack.layouts[0].component_ids = ["asset-mark"]; }, "DESIGN_PACK_RESOURCE_INCOMPATIBLE"],
  ["component used as asset", p => { p.designSystemPack.layouts[0].asset_ids = ["component-tag"]; }, "DESIGN_PACK_RESOURCE_INCOMPATIBLE"],
  ["missing resource", p => { p.designSystemPack.layouts[0].asset_ids = ["asset-missing"]; }, "DESIGN_PACK_RESOURCE_MISSING"],
  ["missing pack", p => { delete p.designSystemPack; }, "DESIGN_PACK_REQUIRED"],
  ["capacity overflow", p => { p.pages[0].screen_text.title = "X".repeat(91); }, "LAYOUT_CAPACITY_EXCEEDED"],
  ["incompatible relation", p => { p.pages[0].relation = "comparison"; }, "DESIGN_PACK_RESOURCE_INCOMPATIBLE"]
]) test(`Review fails visibly without a build for ${name}`, async t => {
  const project = await fixture(t);
  mutate(project);
  const report = await reviewProject(project, { render: false });
  const check = report.automated_checks.find(c => c.id === "design-system-pack");
  assert.equal(report.passed, false);
  assert.equal(check.required, true);
  assert.equal(check.status, "failed");
  assert.equal(check.evidence.metrics.selected, 2);
  const finding = check.evidence.findings[0];
  assert.equal(finding.code, code);
  assert.equal(finding.page, 1);
  assert.equal(finding.page_id, project.pages[0].id);
  assert.equal(finding.layout_id, "layout-cover");
});

test("only an unselected project without a pack is not applicable", async t => {
  const project = await fixture(t);
  delete project.designSystemPack;
  for (const page of project.pages) delete page.design_system_layout_id;
  assert.equal(inspectDesignSystemPack(project).status, "not_applicable");
  const report = await reviewProject(project, { render: false });
  assert.equal(report.passed, true);
  assert.equal(report.automated_checks.some(c => c.id === "design-system-pack"), false);
});

test("PPTX QA and Review preserve migration review instead of accepting it", async t => {
  const project = await fixture(t);
  assert.equal(inspectDesignSystemPack(project).status, "passed");
  const pptxFile = path.join(project.root, "selected.pptx");
  await buildPptx(project, pptxFile);
  const clean = await reviewProject(project, { render: false, pptxFile });
  assert.equal(clean.automated_checks.find(c => c.id === "design-system-pack").status, "passed");
  // Review must inspect the current selection even when an older build exists.
  project.designSystemPack.layouts[0].asset_ids = ["component-tag"];
  let qa = await inspectPresentation({ project, pptxFile, render: false });
  assert.equal(qa.status, "failed");
  assert.ok(qa.findings.some(f => f.code === "DESIGN_PACK_RESOURCE_INCOMPATIBLE"));
  project.designSystemPack = migrateLegacyTemplate({ id: "old", name: "Old", reference_image: "old.png" });
  for (const page of project.pages) delete page.design_system_layout_id;
  qa = await inspectPresentation({ project, pptxFile, render: false });
  assert.equal(qa.status, "review_required");
  assert.equal(qa.design_system_pack.status, "review_required");
  for (const options of [{ render: false }, { render: false, pptxFile }]) {
    const report = await reviewProject(project, options);
    const check = report.automated_checks.find(c => c.id === "design-system-pack");
    assert.equal(report.passed, false);
    assert.equal(report.required_failure_count, 0); // Pending human review is not a code failure.
    assert.equal(check.status, "pending");
    assert.equal(check.evidence.status, "review_required");
    assert.equal(check.evidence.findings[0].code, "DESIGN_PACK_MIGRATION_REVIEW_REQUIRED");
  }
});


test("CLI Review persists failure and migration gates from disk", async t => {
  const project = await fixture(t);
  const run = promisify(execFile);
  const review = async () => {
    await assert.rejects(run(process.execPath, ["src/cli.js", "review", project.root], {
      env: { ...process.env, PPT_OPS_RENDER_QA: "0" }
    }), error => {
      assert.equal(error.code, 1);
      assert.equal(JSON.parse(error.stdout).passed, false);
      return true;
    });
    return JSON.parse(await fs.readFile(path.join(project.root, "outputs/review-report.json"), "utf8"));
  };
  project.designSystemPack.layouts[0].component_ids = ["asset-mark"];
  await fs.writeFile(path.join(project.root, "pack.json"), JSON.stringify(project.designSystemPack));
  let report = await review();
  assert.equal(report.automated_checks.find(c => c.id === "design-system-pack").status, "failed");
  const pages = JSON.parse(await fs.readFile(path.join(project.root, "pages.json"), "utf8"));
  for (const page of pages) delete page.design_system_layout_id;
  await fs.writeFile(path.join(project.root, "pages.json"), JSON.stringify(pages));
  await fs.writeFile(path.join(project.root, "pack.json"), JSON.stringify(migrateLegacyTemplate({ id: "old", name: "Old", reference_image: "old.png" })));
  report = await review();
  const check = report.automated_checks.find(c => c.id === "design-system-pack");
  assert.equal(check.status, "pending");
  assert.equal(check.evidence.status, "review_required");
});
