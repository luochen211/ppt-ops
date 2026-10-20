import assert from "node:assert/strict";
import test from "node:test";
import { createComprehensionAcceptance, evidenceSha256 } from "../src/qa/comprehension-acceptance.js";

const report = { status: "no_heuristic_findings", findings: [] };
const base = { report, build: { id: "build-17", revision: "abc123" }, review: { id: "review-9", build_id: "build-17" }, caseEvidence: { id: "case-1", build_id: "build-17", review_id: "review-9", kind: "authorized_real_case", report_sha256: evidenceSha256(report) }, humanReview: { actor: "reviewer:syna", conclusion: "accepted" } };

test("Stage 5 binds a human conclusion to one exact real case", () => {
  const acceptance = createComprehensionAcceptance(base);
  assert.equal(acceptance.status, "accepted");
  assert.equal(acceptance.binding.build_revision, "abc123");
  assert.equal(acceptance.audience_comprehension_proven, false);
});

test("synthetic fixtures cannot become formal acceptance and stale evidence fails closed", () => {
  assert.throws(() => createComprehensionAcceptance({ ...base, caseEvidence: { ...base.caseEvidence, kind: "synthetic_fixture" } }), { code: "COMPREHENSION_REAL_CASE_REQUIRED" });
  assert.throws(() => createComprehensionAcceptance({ ...base, caseEvidence: { ...base.caseEvidence, report_sha256: "stale" } }), { code: "COMPREHENSION_EVIDENCE_HASH_MISMATCH" });
});


test("acceptance rejects a report rebound to an unrelated build or review", () => {
  assert.throws(() => createComprehensionAcceptance({ ...base, build: { ...base.build, id: "build-other" } }), { code: "COMPREHENSION_BINDING_MISMATCH" });
  assert.throws(() => createComprehensionAcceptance({ ...base, review: { ...base.review, build_id: "build-other" } }), { code: "COMPREHENSION_BINDING_MISMATCH" });
  const unassessed = { status: "not_assessed", findings: [] };
  assert.throws(() => createComprehensionAcceptance({ ...base, report: unassessed, caseEvidence: { ...base.caseEvidence, report_sha256: evidenceSha256(unassessed) } }), { code: "COMPREHENSION_REPORT_NOT_ASSESSED" });
});
