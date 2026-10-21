import assert from "node:assert/strict";
import test from "node:test";
import { bindVisualRepairEvidence, createVisualFailureRecord, VISUAL_FAILURE_CATEGORIES } from "../src/qa/visual-regression.js";

const base = { id: "failure-001", raw_feedback: "The label is too quiet.", target: { page_id: "page-002", element_id: "label-risk", bounds: { x: 1, y: 2, width: 3, height: 1 } }, version: { id: "version-001", revision: "rev-a" }, evidence: { screenshot_sha256: "a".repeat(64), locator: "page-2.png" }, classification: { category: "hierarchy", confidence: 0.8 } };

test("Stage 1 records raw feedback separately from inferred visual classification", () => {
  const record = createVisualFailureRecord(base);
  assert.equal(record.raw_feedback, base.raw_feedback);
  assert.deepEqual(record.classification, { category: "hierarchy", confidence: 0.8, source: "system_inference" });
  assert.equal(record.rule_activation, "none");
  assert.deepEqual(VISUAL_FAILURE_CATEGORIES, ["layout", "hierarchy", "alignment", "clarity", "imagery", "repetition"]);
});

test("Stage 2 binds before/after hashes and rejects changes outside the target", () => {
  const record = createVisualFailureRecord(base);
  const hashes = { before_artifact_sha256: "b".repeat(64), after_artifact_sha256: "c".repeat(64), before_page_sha256: "d".repeat(64), after_page_sha256: "e".repeat(64), changed_targets: [{ page_id: "page-002", element_id: "label-risk", fields: ["font_size"] }], unrelated_pages_unchanged: true, unrelated_fields_unchanged: true };
  const evidence = bindVisualRepairEvidence(record, hashes);
  assert.equal(evidence.failure_record_id, record.id);
  assert.match(evidence.acceptance_boundary, /not visual acceptance/);
  assert.throws(() => bindVisualRepairEvidence(record, { ...hashes, changed_targets: [{ page_id: "page-003", element_id: "title" }] }), { code: "VISUAL_REPAIR_SCOPE_VIOLATION" });
});

test("Stage 1 rejects missing evidence and unsupported categories", () => {
  assert.throws(() => createVisualFailureRecord({ ...base, evidence: { screenshot_sha256: "bad" } }), { code: "VISUAL_FAILURE_EVIDENCE_INVALID" });
  assert.throws(() => createVisualFailureRecord({ ...base, classification: { category: "taste", confidence: 1 } }), { code: "VISUAL_FAILURE_CATEGORY_INVALID" });
});
