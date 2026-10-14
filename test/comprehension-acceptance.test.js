import assert from "node:assert/strict";
import test from "node:test";
import { createComprehensionAcceptance, evidenceSha256 } from "../src/qa/comprehension-acceptance.js";

const report = { status: "no_heuristic_findings", findings: [] };
const base = { report, build: { id: "build-17", revision: "abc123" }, review: { id: "review-9" }, caseEvidence: { id: "case-1", kind: "authorized_real_case", report_sha256: evidenceSha256(report) }, humanReview: { actor: "reviewer:syna", conclusion: "accepted" } };

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
