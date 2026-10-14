import crypto from "node:crypto";

export function evidenceSha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function createComprehensionAcceptance({ report, build, review, caseEvidence, humanReview }) {
  required(build?.id, "COMPREHENSION_BUILD_REQUIRED", "an exact build id is required");
  required(review?.id, "COMPREHENSION_REVIEW_REQUIRED", "an exact review id is required");
  required(caseEvidence?.id, "COMPREHENSION_CASE_REQUIRED", "case evidence is required");
  required(humanReview?.actor, "COMPREHENSION_REVIEW_ACTOR_REQUIRED", "a named human reviewer is required");
  if (!["accepted", "changes_required", "inconclusive"].includes(humanReview.conclusion)) throw coded("COMPREHENSION_REVIEW_CONCLUSION_INVALID", "unsupported human conclusion");
  const evidence_hash = evidenceSha256(report);
  if (caseEvidence.report_sha256 !== evidence_hash) throw coded("COMPREHENSION_EVIDENCE_HASH_MISMATCH", "the human result is not bound to this report");
  if (humanReview.conclusion === "accepted" && caseEvidence.kind !== "authorized_real_case") throw coded("COMPREHENSION_REAL_CASE_REQUIRED", "formal acceptance requires an authorized real case");
  return {
    schema_version: "1.0", kind: "comprehension_acceptance", status: humanReview.conclusion,
    binding: { build_id: build.id, build_revision: build.revision ?? null, review_id: review.id, evidence_id: caseEvidence.id, evidence_sha256: evidence_hash },
    human_review: { actor: humanReview.actor, conclusion: humanReview.conclusion, notes: humanReview.notes ?? "" },
    case_kind: caseEvidence.kind, automated_heuristics_passed: report.status === "no_heuristic_findings",
    audience_comprehension_proven: false,
    claim_boundary: "A recorded reviewer decision is not an audience comprehension study."
  };
}

function required(value, code, message) { if (typeof value !== "string" || !value.trim()) throw coded(code, message); }
function coded(code, message) { return Object.assign(new Error(message), { code }); }
