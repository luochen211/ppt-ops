import crypto from "node:crypto";

export function validatePowerPointAcceptance(candidate, input) {
  if (!candidate || input?.candidate_id !== candidate.id || input?.candidate_sha256 !== candidate.candidate_sha256) throw coded("REFINEMENT_ACCEPTANCE_MISMATCH", "PowerPoint acceptance must reference the exact Candidate and hash");
  if (input.application !== "Microsoft PowerPoint") throw coded("REFINEMENT_ACCEPTANCE_INVALID", "acceptance must name Microsoft PowerPoint");
  if (input.real_presentation !== true || typeof input.case_id !== "string" || !input.case_id.trim()) throw coded("REFINEMENT_REAL_CASE_REQUIRED", "a named real-presentation case is required; synthetic fixtures do not count");
  if (typeof input.actor !== "string" || !input.actor.trim()) throw coded("REFINEMENT_ACTOR_REQUIRED", "a named human actor is required");
  const required = ["opened", "edited", "saved", "reopened"];
  if (required.some((step) => input.steps?.[step] !== true)) throw coded("REFINEMENT_POWERPOINT_ROUNDTRIP_REQUIRED", "PowerPoint acceptance requires open, edit, save, and reopen evidence");
  const record = { contract_version: "1.0", kind: "pptx_refinement_powerpoint_acceptance", candidate_id: candidate.id, candidate_sha256: candidate.candidate_sha256, application: input.application, real_presentation: true, case_id: input.case_id.trim(), actor: input.actor.trim(), steps: Object.fromEntries(required.map((step) => [step, true])), notes: String(input.notes ?? "").trim(), accepted: true };
  return { ...record, acceptance_sha256: crypto.createHash("sha256").update(JSON.stringify(record)).digest("hex") };
}
function coded(code, message) { return Object.assign(new Error(message), { code }); }
