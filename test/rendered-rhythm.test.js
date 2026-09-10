import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { analyzeRenderedRhythm } from "../src/qa/rhythm.js";

const fixtureRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "rhythm");
const fixture = async (name) => JSON.parse(await fs.readFile(path.join(fixtureRoot, `${name}.json`), "utf8"));

test("rendered rhythm flags a monotonous three-slide run with page-addressable geometry evidence", async () => {
  const pages = await fixture("monotonous-repetition");
  pages.forEach((page, index) => { page.templateId = `semantically-distinct-template-${index + 1}`; });
  const result = analyzeRenderedRhythm(pages);
  assert.equal(result.status, "attention");
  assert.match(result.acceptance_boundary, /human visual acceptance remains a separate/);
  const layout = result.findings.find(({ check }) => check === "rendered-layout-repetition");
  assert.deepEqual(layout.evidence.pages, [1, 2, 3]);
  assert.equal(layout.evidence.source, "browser-computed-geometry");
  assert.ok(layout.evidence.comparisons.every(({ similarity }) => similarity >= result.thresholds.layout_similarity));
  const asset = result.findings.find(({ check }) => check === "rendered-dominant-asset-repetition");
  assert.deepEqual({ page: asset.page, pages: asset.evidence.pages, asset: asset.evidence.asset }, { page: 1, pages: [1, 2], asset: "admin-dashboard" });
});

test("non-consecutive recurrence is acceptable", async () => {
  const result = analyzeRenderedRhythm(await fixture("acceptable-recurrence"));
  assert.equal(result.status, "passed");
  assert.equal(result.findings.length, 0);
});

test("a narrow, explained layout exception records deliberate continuity without hiding asset repetition", async () => {
  const pages = await fixture("intentional-consistency");
  const result = analyzeRenderedRhythm(pages);
  assert.equal(result.status, "passed");
  assert.equal(result.pages[1].exception.reason, "Three-step process intentionally preserves one frame while state changes");

  for (const page of pages) page.assets = [{ id: "shared-wireframe", rect: { x: 100, y: 150, width: 700, height: 300 } }];
  const withAsset = analyzeRenderedRhythm(pages);
  assert.equal(withAsset.findings.some(({ check }) => check === "rendered-layout-repetition"), false);
  assert.equal(withAsset.findings.some(({ check }) => check === "rendered-dominant-asset-repetition"), true);
});

test("invalid or unexplained exceptions remain visible as findings", async () => {
  const pages = await fixture("acceptable-recurrence");
  pages[0].rhythmException = "all";
  pages[1].rhythmException = "layout";
  const result = analyzeRenderedRhythm(pages);
  assert.deepEqual(result.findings.map(({ check, evidence }) => [check, evidence.reason]), [
    ["rendered-rhythm-exception", "rhythm exception must contain only layout or asset:<data-asset-id> scopes"],
    ["rendered-rhythm-exception", "rhythm exception requires data-qa-rhythm-reason"]
  ]);
});

test("threshold overrides are bounded and deterministic", async () => {
  const pages = await fixture("monotonous-repetition");
  assert.throws(() => analyzeRenderedRhythm(pages, { minimumRun: 2 }), /minimumRun/);
  assert.throws(() => analyzeRenderedRhythm(pages, { layoutSimilarity: 1.1 }), /layoutSimilarity/);
  const result = analyzeRenderedRhythm(pages, { minimumRun: 4 });
  assert.equal(result.findings.some(({ check }) => check === "rendered-layout-repetition"), false);
});
