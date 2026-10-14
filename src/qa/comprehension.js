export const VISUAL_QA_DIMENSIONS = Object.freeze(["geometry", "legibility", "comprehension", "aesthetic_judgement"]);

const ELEMENT_KINDS = new Set(["label", "frame", "connector", "content", "image"]);
const SEMANTIC_ROLES = new Set(["title", "message", "supporting_content", "annotation", "relationship", "decoration", "interaction_cue"]);

export function unassessedComprehensionEvidence() {
  return { contract_version: "1.0", kind: "comprehension_qa", status: "not_assessed", dimensions: VISUAL_QA_DIMENSIONS, automated_scope: "none", audience_comprehension_proven: false, human_review: { status: "pending", actor: null, conclusion: null }, findings: [] };
}

/**
 * Produce advisory comprehension findings from declared renderer observations.
 * This never infers audience understanding or turns a heuristic into acceptance.
 */
export function analyzeComprehensionEvidence(project, observations = []) {
  if (!Array.isArray(observations)) throw coded("COMPREHENSION_OBSERVATIONS_INVALID", "comprehension observations must be an array");
  const pages = new Map((project.pages ?? []).map((page) => [page.page, page]));
  const findings = [];
  const byPage = new Map();
  for (const [index, raw] of observations.entries()) {
    const observation = validateObservation(raw, index, pages);
    const list = byPage.get(observation.page) ?? [];
    list.push(observation); byPage.set(observation.page, list);
    if (!observation.semantic_role && observation.kind !== "content") findings.push(finding(observation, "comprehension", "unassigned-semantic-role", "warning", "Assign an explicit information role or mark the element as decoration."));
    if (observation.kind === "label" && observation.semantic_role !== "decoration" && !observation.container_id && !observation.target_id) findings.push(finding(observation, "comprehension", "label-target-unresolved", "warning", "Bind the label to its container or target object."));
    if (observation.kind === "connector" && observation.semantic_role !== "decoration" && !observation.target_id) findings.push(finding(observation, "comprehension", "connector-target-unresolved", "warning", "Bind the connector to a declared semantic target."));
    if (observation.interaction_affordance === true && observation.semantic_role !== "interaction_cue") findings.push(finding(observation, "comprehension", "false-interaction-affordance", "warning", "Remove the interactive appearance or declare and implement the interaction cue."));
  }
  for (const page of project.pages ?? []) {
    const pageObservations = byPage.get(page.page) ?? [];
    const emphasized = pageObservations.filter((item) => item.semantic_role === "message" || item.emphasis === "primary");
    if (!page.three_second_message || emphasized.length === 0) findings.push(pageFinding(page.page, "comprehension", "three-second-message-unverified", "warning", { declared_message: page.three_second_message ?? null, emphasized_element_ids: emphasized.map((item) => item.element_id), evidence_source: "declared-renderer-observations" }, "Expose the declared three-second message through a primary semantic element."));
  }
  return {
    contract_version: "1.0", kind: "comprehension_qa", status: findings.length ? "human_review_required" : "no_heuristic_findings",
    dimensions: VISUAL_QA_DIMENSIONS, automated_scope: "declared-roles-and-renderer-observations", audience_comprehension_proven: false,
    human_review: { status: "pending", actor: null, conclusion: null }, findings: findings.sort(orderFinding)
  };
}

export function recordHumanComprehensionReview(report, { actor, conclusion, notes = "" }) {
  if (typeof actor !== "string" || !actor.trim()) throw coded("COMPREHENSION_REVIEW_ACTOR_REQUIRED", "a named human reviewer is required");
  if (!['accepted', 'changes_required', 'inconclusive'].includes(conclusion)) throw coded("COMPREHENSION_REVIEW_CONCLUSION_INVALID", "human conclusion must be accepted, changes_required, or inconclusive");
  return { ...structuredClone(report), human_review: { status: "recorded", actor: actor.trim(), conclusion, notes: String(notes).trim() }, audience_comprehension_proven: false };
}

function validateObservation(value, index, pages) {
  if (!value || !Number.isInteger(value.page) || !pages.has(value.page)) throw coded("COMPREHENSION_OBSERVATION_PAGE_INVALID", `observations[${index}] references an unknown page`);
  if (typeof value.element_id !== "string" || !value.element_id) throw coded("COMPREHENSION_ELEMENT_ID_REQUIRED", `observations[${index}].element_id is required`);
  if (!ELEMENT_KINDS.has(value.kind)) throw coded("COMPREHENSION_ELEMENT_KIND_INVALID", `unsupported element kind: ${value.kind}`);
  if (value.semantic_role != null && !SEMANTIC_ROLES.has(value.semantic_role)) throw coded("COMPREHENSION_SEMANTIC_ROLE_INVALID", `unsupported semantic role: ${value.semantic_role}`);
  if (value.confidence != null && (!Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1)) throw coded("COMPREHENSION_CONFIDENCE_INVALID", "confidence must be between 0 and 1");
  if (typeof value.evidence_source !== "string" || !value.evidence_source) throw coded("COMPREHENSION_EVIDENCE_SOURCE_REQUIRED", "each observation requires an evidence source");
  return { page: value.page, element_id: value.element_id, kind: value.kind, semantic_role: value.semantic_role ?? null, container_id: value.container_id ?? null, target_id: value.target_id ?? null, emphasis: value.emphasis ?? null, interaction_affordance: value.interaction_affordance === true, evidence_source: value.evidence_source, confidence: value.confidence ?? null };
}
function finding(observation, dimension, check, severity, suggestedFix) { return pageFinding(observation.page, dimension, check, severity, { element_id: observation.element_id, kind: observation.kind, semantic_role: observation.semantic_role, evidence_source: observation.evidence_source, confidence: { score: observation.confidence, basis: "declared-or-heuristic-observation" } }, suggestedFix, observation.element_id); }
function pageFinding(page, dimension, check, severity, evidence, suggestedFix, elementId = null) { return { page, element_id: elementId, dimension, check, severity, evidence, suggested_fix: suggestedFix, verification: "automated_heuristic", human_conclusion: "pending", claim_boundary: "This finding is an advisory signal, not proof of audience comprehension or aesthetic quality." }; }
function orderFinding(left, right) { return `${left.page}:${left.element_id ?? ""}:${left.check}`.localeCompare(`${right.page}:${right.element_id ?? ""}:${right.check}`); }
function coded(code, message) { return Object.assign(new Error(message), { code }); }
