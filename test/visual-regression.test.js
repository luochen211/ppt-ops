import assert from "node:assert/strict";
import test from "node:test";
import { bindVisualRepairEvidence, createVisualFailureRecord, decideVisualRuleCandidate, evaluateVisualRegression, validateVisualRegressionCase, VISUAL_FAILURE_CATEGORIES } from "../src/qa/visual-regression.js";

const base = { id: "failure-001", raw_feedback: "The label is too quiet.", target: { page_id: "page-002", element_id: "label-risk", bounds: { x: 1, y: 2, width: 3, height: 1 } }, version: { id: "version-001", revision: "rev-a" }, evidence: { screenshot_sha256: "a".repeat(64), locator: "page-2.png" }, classification: { category: "hierarchy", confidence: 0.8 } };

test("Stage 1 records raw feedback separately from inferred visual classification", () => {
  const record = createVisualFailureRecord(base);
  assert.equal(record.raw_feedback, base.raw_feedback);
  assert.deepEqual(record.classification, { category: "hierarchy", confidence: 0.8, source: "system_inference" });
  assert.equal(record.rule_activation, "none");
  assert.deepEqual(VISUAL_FAILURE_CATEGORIES, ["layout", "hierarchy", "alignment", "clarity", "imagery", "repetition"]);
});

test("Stage 5 keeps a complete synthetic V1-V4 case separate from real acceptance", () => {
  const versions = ["v1", "v2", "v3", "v4"].map((id, index) => ({ id, artifact_sha256: String(index + 1).repeat(64), screenshot_sha256: "a".repeat(64) }));
  const failure_records = VISUAL_FAILURE_CATEGORIES.map((category) => ({ classification: { category } }));
  const synthetic = validateVisualRegressionCase({ id: "case-synthetic", case_kind: "synthetic_fixture", versions, failure_records });
  assert.equal(synthetic.parent_issue_ready_to_close, false);
  assert.throws(() => validateVisualRegressionCase({ id: "case-bad", case_kind: "synthetic_fixture", versions, failure_records, human_review: { actor: "user:syna", conclusion: "accepted" }, real_powerpoint: { status: "passed" } }), { code: "VISUAL_CASE_ACCEPTANCE_INCOMPLETE" });
  const real = validateVisualRegressionCase({ id: "case-real", case_kind: "authorized_real_case", versions, failure_records, human_review: { actor: "user:syna", conclusion: "accepted" }, real_powerpoint: { status: "passed" } });
  assert.equal(real.parent_issue_ready_to_close, true);
});

test("Stage 4 regression findings link the original feedback and accepted repair", () => {
  const rule = { id: "failure-001-rule", category: "hierarchy", scope: "project", source_failure_record_id: "failure-001", source_repair_evidence_id: "failure-001-repair" };
  const report = evaluateVisualRegression([rule], [{ rule_id: rule.id, page_id: "page-004", element_id: "label-risk", passed: false, evidence: { contrast_ratio: 2.1 } }]);
  assert.equal(report.status, "findings");
  assert.deepEqual(report.findings[0].failure_record_id, "failure-001");
  assert.equal(evaluateVisualRegression([], []).status, "not_assessed");
});

test("Stage 3 activates a scoped rule only after a named user decision", () => {
  const record = createVisualFailureRecord(base);
  const repair = bindVisualRepairEvidence(record, { before_artifact_sha256: "b".repeat(64), after_artifact_sha256: "c".repeat(64), before_page_sha256: "d".repeat(64), after_page_sha256: "e".repeat(64), changed_targets: [{ page_id: "page-002", element_id: "label-risk" }], unrelated_pages_unchanged: true, unrelated_fields_unchanged: true });
  const decision = decideVisualRuleCandidate(record, repair, { actor: "user:syna", decision: "accepted", raw_feedback: "Keep this rule for the project.", scope: "project", condition: "Risk labels must be visually prominent." });
  assert.equal(decision.active_rule.scope, "project");
  assert.equal(decision.active_rule.source_failure_record_id, record.id);
  assert.throws(() => decideVisualRuleCandidate(record, repair, { actor: "agent", decision: "accepted", raw_feedback: "auto", scope: "global", condition: "x" }), { code: "VISUAL_RULE_USER_REQUIRED" });
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
