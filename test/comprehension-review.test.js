import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";
import { analyzeComprehensionEvidence, unassessedComprehensionEvidence } from "../src/qa/comprehension.js";
import { comprehensionReviewCheck } from "../src/review/index.js";

const project = { pages: [{ page: 1, three_second_message: "Find the hazard" }] };

test("Stage 4 fixtures are deterministic and Review keeps human acceptance separate", async () => {
  const good = JSON.parse(await fs.readFile(new URL("./fixtures/comprehension/good.json", import.meta.url)));
  const bad = JSON.parse(await fs.readFile(new URL("./fixtures/comprehension/bad.json", import.meta.url)));
  const goodReport = analyzeComprehensionEvidence(project, good.pages.flatMap((page) => page.elements.map((element) => ({ ...element, page: page.page }))));
  const badReport = analyzeComprehensionEvidence(project, bad.pages.flatMap((page) => page.elements.map((element) => ({ ...element, page: page.page }))));
  assert.equal(comprehensionReviewCheck(goodReport).status, "passed");
  assert.equal(comprehensionReviewCheck(badReport).status, "pending");
  assert.equal(comprehensionReviewCheck(unassessedComprehensionEvidence()).required, false);
  assert.equal(goodReport.human_review.status, "pending");
});
