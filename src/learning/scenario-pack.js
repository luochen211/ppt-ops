const EVIDENCE_KINDS = new Set(["sourced_fact", "regulatory_requirement", "instructional_fiction"]);
const DECISION_STATES = new Set(["proposed", "accepted", "rejected"]);

export function validateScenarioPack(pack) {
  const errors = [];
  if (pack?.contract_version !== "1.0") errors.push("contract_version must be 1.0");
  if (pack?.kind !== "scenario_pack") errors.push("kind must be scenario_pack");
  for (const field of ["id", "name", "domain", "workplace_context"]) requireText(pack, field, errors);
  if (!Array.isArray(pack?.scenarios) || pack.scenarios.length === 0) errors.push("scenarios must contain at least one scenario");
  if (!/^scenario-pack-[a-z0-9-]+$/.test(pack?.id ?? "")) errors.push("id must be a stable scenario-pack identifier");
  const ids = new Set();
  for (const scenario of Array.isArray(pack?.scenarios) ? pack.scenarios : []) {
    const prefix = hasText(scenario?.id) ? scenario.id : "scenario";
    for (const field of ["id", "title", "learning_objective_id", "expected_action", "rationale", "facilitation_question", "difficulty", "ambiguity", "visual_brief", "accessibility_description"]) requireText(scenario, field, errors, prefix);
    if (!/^scenario-[a-z0-9-]+$/.test(scenario?.id ?? "")) errors.push(`${prefix}.id must be a stable scenario identifier`);
    if (ids.has(scenario?.id)) errors.push(`${prefix}.id must be unique`); else ids.add(scenario?.id);
    for (const field of ["personas", "observable_cues", "decision_points", "plausible_distractors", "claims"]) requireArray(scenario, field, errors, prefix);
    if (!DECISION_STATES.has(scenario?.decision_state)) errors.push(`${prefix}.decision_state must be proposed, accepted or rejected`);
    for (const claim of Array.isArray(scenario?.claims) ? scenario.claims : []) validateClaim(claim, errors, prefix);
  }
  return errors;
}

export function normalizeScenarioPack(pack) {
  const errors = validateScenarioPack(pack);
  if (errors.length) throw Object.assign(new Error(`invalid scenario pack:\n${errors.map((error) => `- ${error}`).join("\n")}`), { code: "SCENARIO_PACK_INVALID", errors });
  return structuredClone(pack);
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
  for (const field of ["source_id", "jurisdiction"]) {
    if (claim && Object.hasOwn(claim, field) && !hasText(claim[field])) errors.push(`${prefix}.${field} must be non-empty text`);
  }
  if (claim && Object.hasOwn(claim, "human_confirmation") && !["required", "confirmed"].includes(claim.human_confirmation) && claim.evidence_kind !== "regulatory_requirement") errors.push(`${prefix}.human_confirmation must be required or confirmed`);
  if (claim?.evidence_kind === "instructional_fiction" && (Object.hasOwn(claim, "source_id") || Object.hasOwn(claim, "jurisdiction"))) errors.push(`${prefix}.instructional fiction must not claim a source or jurisdiction`);
}

function requireText(value, field, errors, prefix) { if (!hasText(value?.[field])) errors.push(`${prefix ? `${prefix}.` : ""}${field} is required`); }
function requireArray(value, field, errors, prefix) { if (!Array.isArray(value?.[field]) || value[field].length === 0) errors.push(`${prefix}.${field} must contain at least one entry`); }
function hasText(value) { return typeof value === "string" && value.trim().length > 0; }

