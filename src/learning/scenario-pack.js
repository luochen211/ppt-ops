const EVIDENCE_KINDS = new Set(["sourced_fact", "regulatory_requirement", "instructional_fiction"]);
const DECISION_STATES = new Set(["proposed", "accepted", "rejected"]);

export function validateScenarioPack(pack) {
  const errors = [];
  if (pack?.kind !== "scenario_pack") errors.push("kind must be scenario_pack");
  for (const field of ["id", "name", "domain", "workplace_context"]) requireText(pack, field, errors);
  if (!Array.isArray(pack?.scenarios) || pack.scenarios.length === 0) errors.push("scenarios must contain at least one scenario");
  const ids = new Set();
  for (const scenario of pack?.scenarios ?? []) {
    const prefix = hasText(scenario?.id) ? scenario.id : "scenario";
    for (const field of ["id", "title", "learning_objective_id", "expected_action", "rationale", "facilitation_question", "difficulty", "ambiguity", "visual_brief", "accessibility_description"]) requireText(scenario, field, errors, prefix);
    if (ids.has(scenario?.id)) errors.push(`${prefix}.id must be unique`); else ids.add(scenario?.id);
    for (const field of ["personas", "observable_cues", "decision_points", "plausible_distractors", "claims"]) requireArray(scenario, field, errors, prefix);
    if (!DECISION_STATES.has(scenario?.decision_state)) errors.push(`${prefix}.decision_state must be proposed, accepted or rejected`);
    for (const claim of scenario?.claims ?? []) validateClaim(claim, errors, prefix);
  }
  return errors;
}

export function normalizeScenarioPack(pack) {
  const errors = validateScenarioPack(pack);
  if (errors.length) throw Object.assign(new Error(`invalid scenario pack:\n${errors.map((error) => `- ${error}`).join("\n")}`), { code: "SCENARIO_PACK_INVALID", errors });
  return structuredClone({ contract_version: pack.contract_version ?? "1.0", ...pack });
}

function validateClaim(claim, errors, scenarioId) {
  const prefix = `${scenarioId}.claim`;
  for (const field of ["id", "text", "evidence_kind"]) requireText(claim, field, errors, prefix);
  if (!EVIDENCE_KINDS.has(claim?.evidence_kind)) errors.push(`${prefix}.evidence_kind is unsupported`);
  if (claim?.evidence_kind === "sourced_fact" && !hasText(claim.source_id)) errors.push(`${prefix}.source_id is required for sourced facts`);
  if (claim?.evidence_kind === "regulatory_requirement") {
    if (!hasText(claim.jurisdiction)) errors.push(`${prefix}.jurisdiction is required for regulatory requirements`);
    if (!hasText(claim.source_id)) errors.push(`${prefix}.source_id is required for regulatory requirements`);
    if (claim.human_confirmation !== "required" && claim.human_confirmation !== "confirmed") errors.push(`${prefix}.human_confirmation must be required or confirmed`);
  }
  if (claim?.evidence_kind === "instructional_fiction" && (claim.source_id || claim.jurisdiction)) errors.push(`${prefix}.instructional fiction must not claim a source or jurisdiction`);
}

function requireText(value, field, errors, prefix) { if (!hasText(value?.[field])) errors.push(`${prefix ? `${prefix}.` : ""}${field} is required`); }
function requireArray(value, field, errors, prefix) { if (!Array.isArray(value?.[field]) || value[field].length === 0) errors.push(`${prefix}.${field} must contain at least one entry`); }
function hasText(value) { return typeof value === "string" && value.trim().length > 0; }

