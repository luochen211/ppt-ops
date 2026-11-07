import assert from "node:assert/strict";
import test from "node:test";
import { createVisualFailureRecord, VISUAL_FAILURE_CATEGORIES } from "../src/qa/visual-regression.js";

const base = { id: "failure-001", raw_feedback: "The label is too quiet.", target: { page_id: "page-002", element_id: "label-risk", bounds: { x: 1, y: 2, width: 3, height: 1 } }, version: { id: "version-001", revision: "rev-a" }, evidence: { screenshot_sha256: "a".repeat(64), locator: "page-2.png" }, classification: { category: "hierarchy", confidence: 0.8 } };

test("Stage 1 records raw feedback separately from inferred visual classification", () => {
  const record = createVisualFailureRecord(base);
  assert.equal(record.raw_feedback, base.raw_feedback);
  assert.deepEqual(record.classification, { category: "hierarchy", confidence: 0.8, source: "system_inference" });
  assert.equal(record.rule_activation, "none");
  assert.deepEqual(VISUAL_FAILURE_CATEGORIES, ["layout", "hierarchy", "alignment", "clarity", "imagery", "repetition"]);
});

test("Stage 1 rejects missing evidence and unsupported categories", () => {
  assert.throws(() => createVisualFailureRecord({ ...base, evidence: { screenshot_sha256: "bad" } }), { code: "VISUAL_FAILURE_EVIDENCE_INVALID" });
  assert.throws(() => createVisualFailureRecord({ ...base, classification: { category: "taste", confidence: 1 } }), { code: "VISUAL_FAILURE_CATEGORY_INVALID" });
});

test("feedback retains formatting and whitespace remains part of record identity", () => {
  const raw_feedback = "  标签不够醒目。\r\n\t保留缩进。\n";
  const record = createVisualFailureRecord({ ...base, raw_feedback });
  assert.equal(record.raw_feedback, raw_feedback);
  assert.notEqual(record.record_sha256, createVisualFailureRecord({ ...base, raw_feedback: raw_feedback.trim() }).record_sha256);
  assert.throws(() => createVisualFailureRecord({ ...base, raw_feedback: " \t\r\n" }), { code: "VISUAL_FAILURE_FEEDBACK_REQUIRED" });
});

test("optional bounds accept absence and zero coordinates but reject malformed evidence", () => {
  for (const bounds of [undefined, null]) {
    assert.equal(createVisualFailureRecord({ ...base, target: { ...base.target, bounds } }).target.bounds, null);
  }
  const zeroBounds = { x: 0, y: 0, width: 0, height: 0 };
  assert.deepEqual(createVisualFailureRecord({ ...base, target: { ...base.target, bounds: zeroBounds } }).target.bounds, zeroBounds);
  for (const bounds of [false, true, 0, "", "bounds", [], {}, { x: 0, y: 0, width: -1, height: 1 }, { x: 0, y: 0, width: 1, height: NaN }]) {
    assert.throws(() => createVisualFailureRecord({ ...base, target: { ...base.target, bounds } }), { code: "VISUAL_FAILURE_BOUNDS_INVALID" }, `reject bounds ${JSON.stringify(bounds)}`);
  }
});
