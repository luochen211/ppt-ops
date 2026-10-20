import crypto from "node:crypto";

export function createRefinementDecision({ candidate, diff, decision, actor, expectedRevision, current }) {
  if (!candidate || !diff?.passed || diff.candidate_sha256 !== candidate.candidate_sha256) throw coded("REFINEMENT_REVIEW_REQUIRED", "a passing scoped diff is required before decision");
  if (!['accept', 'reject'].includes(decision)) throw coded("REFINEMENT_DECISION_INVALID", "decision must be accept or reject");
  if (typeof actor !== "string" || !actor.trim()) throw coded("REFINEMENT_ACTOR_REQUIRED", "an explicit actor is required");
  const revision = current?.revision ?? 0;
  if (expectedRevision !== revision) throw coded("STALE_BASE_REVISION", "refinement decision revision is stale");
  if (current && current.state !== "review_pending") throw coded("REFINEMENT_ALREADY_DECIDED", "refinement Candidate already has a terminal decision");
  const decided = { contract_version: "1.0", kind: "pptx_refinement_decision", candidate_id: candidate.id, candidate_sha256: candidate.candidate_sha256, scope_id: candidate.scope_id, actor: actor.trim(), decision, state: decision === "accept" ? "accepted" : "rejected", revision: revision + 1 };
  return { ...decided, decision_sha256: hash(decided) };
}

export function createRefinementVersion(candidate, decision) {
  if (decision.state !== "accepted") return null;
  const id = `refined-${candidate.id.replace(/^refinement-/, "")}`;
  return { contract_version: "1.0", kind: "pptx_refinement_version", id, source: candidate.source, scope_id: candidate.scope_id, candidate_id: candidate.id, candidate_sha256: candidate.candidate_sha256, decision_sha256: decision.decision_sha256, delivery_state: "versioned", original_preserved: true };
}
function hash(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function coded(code, message) { return Object.assign(new Error(message), { code }); }
