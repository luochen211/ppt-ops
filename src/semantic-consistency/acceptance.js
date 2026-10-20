const REQUIRED_ROLES = ["presentation", "learner_guide", "assessment", "alignment_report"];

export function evaluateSemanticDeliveryAcceptance({ consistency, coverage, manifest, caseEvidence, humanAcceptance }) {
  const roles = new Set(manifest?.artifacts?.map((artifact) => artifact.role) ?? []);
  const missingRoles = REQUIRED_ROLES.filter((role) => !roles.has(role));
  if (missingRoles.length) throw coded("SEMANTIC_DELIVERY_INCOMPLETE", `missing deliverable roles: ${missingRoles.join(", ")}`);
  if (!consistency?.passed || !coverage?.passed) throw coded("SEMANTIC_AUTOMATED_CHECK_FAILED", "consistency and LO coverage must pass before acceptance");
  if (caseEvidence?.kind !== "authorized_real_case" || typeof caseEvidence.case_id !== "string" || !caseEvidence.case_id.trim() || !Array.isArray(caseEvidence.artifact_hashes) || caseEvidence.artifact_hashes.length !== manifest.artifacts.length || caseEvidence.artifact_hashes.some((item) => !/^[a-f0-9]{64}$/.test(item.sha256 ?? ""))) throw coded("SEMANTIC_REAL_CASE_REQUIRED", "an authorized real multi-file case with exact artifact hashes is required; synthetic fixtures do not count");
  const hashes = new Map(caseEvidence.artifact_hashes.map((item) => [item.artifact_id, item.sha256]));
  if (hashes.size !== manifest.artifacts.length || manifest.artifacts.some((artifact) => !/^[a-f0-9]{64}$/.test(artifact.sha256 ?? "") || hashes.get(artifact.id) !== artifact.sha256)) throw coded("SEMANTIC_ARTIFACT_HASH_MISMATCH", "real-case hashes must match each exact manifest artifact without duplicates");
  if (!manifest.sha256 || consistency.manifest_sha256 !== manifest.sha256 || coverage.manifest_sha256 !== manifest.sha256 || consistency.registry_sha256 !== manifest.registry_sha256 || coverage.registry_sha256 !== manifest.registry_sha256) throw coded("SEMANTIC_EVIDENCE_MISMATCH", "automated reports must belong to the selected manifest and registry");
  if (humanAcceptance?.decision !== "accepted" || typeof humanAcceptance.actor !== "string" || !humanAcceptance.actor.trim() || typeof humanAcceptance.role !== "string" || !humanAcceptance.role.trim()) throw coded("SEMANTIC_HUMAN_ACCEPTANCE_REQUIRED", "named instructional-design acceptance is required");
  return { contract_version: "1.0", kind: "semantic_delivery_acceptance", accepted: true, case_id: caseEvidence.case_id.trim(), artifact_hashes: structuredClone(caseEvidence.artifact_hashes), automated_consistency: "passed", automated_coverage: "passed", human_acceptance: { decision: "accepted", actor: humanAcceptance.actor.trim(), role: humanAcceptance.role.trim(), notes: String(humanAcceptance.notes ?? "").trim() }, automated_check_is_not_human_approval: true };
}
function coded(code, message) { return Object.assign(new Error(message), { code }); }
