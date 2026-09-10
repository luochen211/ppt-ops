import assert from "node:assert/strict";
import test from "node:test";
import { analyzeScreenshotEvidence } from "../src/qa/screenshot-evidence.js";
import { validateV1Entity } from "../src/contracts/v1.js";

const digest = "a".repeat(64);
const semantics = {
  content_role: "read_required",
  evidence_purpose: "Show the approval status",
  focal_region: { x: 0.8, y: 0.05, width: 0.1, height: 0.1 },
  presentation_treatments: ["zoom"]
};

test("screenshot evidence QA identifies page, asset, focal risk, and repeated purpose", () => {
  const project = {
    assets: [{ id: "approval-screen", sha256: digest, screenshot_evidence: semantics }],
    pages: [
      { page: 1, asset_slots: [{ asset_id: "approval-screen" }] },
      { page: 2, asset_slots: [{ asset_id: "approval-screen" }] },
      { page: 3, asset_slots: [{ asset_id: "approval-screen", evidence_purpose: "Show the audit timestamp" }] }
    ]
  };
  const placements = [1, 2, 3].map((page) => ({ page, asset_id: "approval-screen", width: 4000000, height: 3000000 }));
  const result = analyzeScreenshotEvidence(project, placements);

  assert.equal(result.scope, "declared-composition-only");
  assert.equal(result.human_readability_assessed, false);
  assert.equal(result.screenshot_usage_count, 3);
  assert.ok(result.findings.some((item) => item.page === 1 && item.asset_id === "approval-screen" && item.check === "screenshot-focal-coverage"));
  assert.ok(result.findings.some((item) => item.page === 2 && item.asset_id === "approval-screen" && item.check === "screenshot-evidence-repetition"));
  assert.equal(result.findings.some((item) => item.page === 3 && item.check === "screenshot-evidence-repetition"), false);
  assert.ok(result.findings.every((item) => /not assessed|detected/.test(item.evidence.automated_claim)));
});

test("contextual screenshots do not require a reading treatment", () => {
  const asset = {
    contract_version: "1.0", kind: "asset", id: "context-screen", type: "image", file: "screen.png", sha256: digest,
    screenshot_evidence: {
      content_role: "contextual",
      evidence_purpose: "Orient the audience to the product",
      focal_region: { x: 0, y: 0, width: 1, height: 1 }
    }
  };
  assert.deepEqual(validateV1Entity(asset, "asset"), []);
});

test("read-required screenshots require treatment or explicit human review", () => {
  const asset = {
    contract_version: "1.0", kind: "asset", id: "read-screen", type: "image", file: "screen.png", sha256: digest,
    screenshot_evidence: { ...semantics, presentation_treatments: [] }
  };
  assert.ok(validateV1Entity(asset, "asset").some((error) => /needs a presentation treatment or human_review_required/.test(error)));
  asset.screenshot_evidence.human_review_required = true;
  assert.deepEqual(validateV1Entity(asset, "asset"), []);
  const result = analyzeScreenshotEvidence({ assets: [asset], pages: [{ page: 4, asset_slots: [{ asset_id: asset.id }] }] }, [
    { page: 4, asset_id: asset.id, width: 8000000, height: 5000000 }
  ]);
  assert.ok(result.findings.some((item) => item.page === 4 && item.asset_id === asset.id && item.check === "screenshot-human-review-required"));
  assert.equal(result.human_readability_assessed, false);
});

test("unmapped screenshot placement stays an explicit composition finding", () => {
  const project = {
    assets: [{ id: "screen", sha256: digest, screenshot_evidence: { ...semantics, content_role: "contextual" } }],
    pages: [{ page: 7, asset_slots: [{ asset_id: "screen" }] }]
  };
  const result = analyzeScreenshotEvidence(project, []);
  assert.deepEqual(result.findings.map(({ page, asset_id, check }) => ({ page, asset_id, check })), [
    { page: 7, asset_id: "screen", check: "screenshot-placement-unresolved" }
  ]);
});
