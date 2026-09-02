export const CONTRACT_VERSION = "1.0";
export const EVAL_CATEGORIES = Object.freeze(["content_fidelity", "cognitive_clarity", "semantic_accuracy", "visual_hierarchy", "layout_composition", "aesthetic_brand", "powerpoint_fidelity", "editability", "cross_page_continuity", "evidence_provenance", "user_acceptance"]);
export const ROOT_CAUSES = Object.freeze(["content_truth", "page_task", "information_relationship", "visual_grammar", "powerpoint_implementation", "process"]);
export const FINDING_SEVERITIES = Object.freeze(["note", "minor", "major", "blocking"]);

export function createV1Entity(kind, id, fields = {}) { return { contract_version: CONTRACT_VERSION, kind, id, ...fields }; }
export function pageSpecId(page) { return `page-${String(page).padStart(3, "0")}`; }

export const ENTITY_KINDS = Object.freeze([
  "project", "source", "outline", "page_spec", "theme", "template", "asset",
  "candidate", "candidate_feedback", "powerpoint_observation", "approval", "version", "build", "review", "handoff"
]);

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RELATIONS = ["sequence", "parallel", "cause_effect", "before_after", "hierarchy", "process", "cycle", "comparison", "hero"];
const CONTENT_STATES = ["draft", "prototype", "approved", "built", "reviewed"];

export function validateV1Entity(entity, expectedKind) {
  const errors = [];
  if (!isObject(entity)) return ["entity must be an object"];
  if (entity.contract_version !== CONTRACT_VERSION) errors.push("contract_version must be 1.0");
  if (!ENTITY_KINDS.includes(entity.kind)) errors.push(`kind is invalid: ${entity.kind}`);
  if (expectedKind && entity.kind !== expectedKind) errors.push(`kind must be ${expectedKind}`);
  if (!isId(entity.id)) errors.push("id must be a stable lowercase identifier");

  const validate = validators[entity.kind];
  if (validate) validate(entity, errors);
  return errors;
}

export function validateV1Bundle(bundle) {
  if (!isObject(bundle)) return ["bundle must be an object"];
  const errors = [];
  const collections = ["sources", "pages", "assets", "templates", "candidates", "approvals", "versions", "builds", "reviews", "handoffs"];
  for (const key of collections) if (!Array.isArray(bundle[key])) errors.push(`${key} must be an array`);
  for (const [key, kind] of [["project", "project"], ["outline", "outline"], ["theme", "theme"]]) {
    for (const error of validateV1Entity(bundle[key], kind)) errors.push(`${key}: ${error}`);
  }
  for (const [key, kind] of [["sources", "source"], ["pages", "page_spec"], ["assets", "asset"], ["templates", "template"], ["candidates", "candidate"], ["approvals", "approval"], ["versions", "version"], ["builds", "build"], ["reviews", "review"], ["handoffs", "handoff"]]) {
    for (const [index, entity] of (bundle[key] ?? []).entries()) {
      for (const error of validateV1Entity(entity, kind)) errors.push(`${key}[${index}]: ${error}`);
    }
  }
  validateReferences(bundle, errors);
  return errors;
}

const validators = {
  project(value, errors) {
    requireText(value, "title", errors);
    if (value.format !== "16:9") errors.push("format must be 16:9");
    requireIdList(value.source_ids, "source_ids", errors);
    requireId(value, "outline_id", errors);
    requireId(value, "theme_id", errors);
    requireIdList(value.asset_ids, "asset_ids", errors, true);
    requireEnumList(value.outputs, "outputs", ["html", "pptx", "pdf", "png"], errors);
  },
  source(value, errors) {
    requireText(value, "file", errors); requireHash(value, errors);
    if (!Number.isInteger(value.bytes) || value.bytes < 0) errors.push("bytes must be a non-negative integer");
    requireText(value, "mime", errors);
  },
  outline(value, errors) {
    if (!Array.isArray(value.sections) || value.sections.length === 0) errors.push("sections must be a non-empty array");
    for (const [index, section] of (value.sections ?? []).entries()) {
      if (!isId(section?.id)) errors.push(`sections[${index}].id is invalid`);
      requireText(section ?? {}, "title", errors, `sections[${index}].`);
      requireIdList(section?.page_ids, `sections[${index}].page_ids`, errors);
    }
  },
  page_spec(value, errors) {
    if (!Number.isInteger(value.page) || value.page < 1) errors.push("page must be a positive integer");
    for (const field of ["task", "three_second_message", "visual_job"]) requireText(value, field, errors);
    requireEnum(value, "relation", RELATIONS, errors);
    requireEnum(value, "content_status", CONTENT_STATES, errors);
    if (!isObject(value.screen_text) || !hasText(value.screen_text.title)) errors.push("screen_text.title is required");
    if (!Array.isArray(value.source_refs)) errors.push("source_refs must be an array");
    for (const [index, ref] of (value.source_refs ?? []).entries()) if (!isId(ref?.source_id)) errors.push(`source_refs[${index}].source_id is invalid`);
    if (!Array.isArray(value.asset_slots)) errors.push("asset_slots must be an array");
  },
  theme(value, errors) { if (!isObject(value.tokens)) errors.push("tokens must be an object"); },
  template(value, errors) { requireText(value, "name", errors); if (!isObject(value.slots)) errors.push("slots must be an object"); if (!isObject(value.renderers)) errors.push("renderers must be an object"); },
  asset(value, errors) { requireText(value, "file", errors); requireText(value, "type", errors); requireHash(value, errors); },
  candidate(value, errors) {
    requireId(value, "target_id", errors); requireText(value, "target_kind", errors);
    requireEnum(value, "state", ["generated", "validating", "ready_for_review", "awaiting_powerpoint_observation", "awaiting_user_decision", "accepted", "continued", "rejected", "reconstruction_required", "applied_to_draft"], errors);
  },
  candidate_feedback(value, errors) {
    requireId(value, "candidate_id", errors); requireId(value, "target_id", errors);
    requireEnum(value, "decision", ["accept", "continue_iteration", "reject"], errors);
    requireEnum(value, "actor", ["user", "automated_qa"], errors);
    requireText(value, "raw_feedback", errors);
    const findings = Array.isArray(value.findings) ? value.findings : [];
    if (findings.length === 0) errors.push("findings must contain at least one atomic finding");
    for (const [index, finding] of findings.entries()) validateFeedbackFinding(finding, index, errors);
    const hasAcceptance = findings.some((finding) => finding?.eval_category === "user_acceptance");
    if (value.decision === "accept" && !hasAcceptance) errors.push("acceptance requires a user_acceptance finding");
    if (value.decision !== "accept" && hasAcceptance) errors.push("user_acceptance findings are only valid for acceptance decisions");
    if (value.actor === "automated_qa" && hasAcceptance) errors.push("automated QA cannot record user_acceptance");
    for (const field of ["eval_category", "root_cause", "root_cause_fingerprint", "classification_confidence", "corrected_root_cause"]) {
      if (field in value) errors.push(`${field} must be stored inside findings`);
    }
  },
  powerpoint_observation(value, errors) {
    requireId(value, "candidate_id", errors); requireId(value, "target_id", errors);
    requireEnum(value, "status", ["viewed", "not_viewed"], errors);
    if (!isObject(value.evidence)) errors.push("evidence must be an object");
  },
  approval(value, errors) { requireId(value, "subject_id", errors); requireHashField(value, "subject_hash", errors); requireEnum(value, "decision", ["accepted", "rejected"], errors); },
  version(value, errors) { requireEnum(value, "state", ["draft", "approval_pending", "approved", "changes_requested", "frozen"], errors); requireHashField(value, "snapshot_hash", errors); },
  build(value, errors) { requireId(value, "version_id", errors); requireEnum(value, "state", ["queued", "preparing", "rendering", "validating", "succeeded", "failed", "cancelled"], errors); requireEnumList(value.targets, "targets", ["html", "pptx", "pdf", "png"], errors); },
  review(value, errors) { requireId(value, "build_id", errors); requireEnum(value, "state", ["automated_pending", "automated_complete", "human_pending", "accepted", "rejected"], errors); },
  handoff(value, errors) { requireId(value, "build_id", errors); requireId(value, "review_id", errors); requireEnum(value, "state", ["preparing", "packaged", "verified", "delivered", "archived"], errors); }
};

function validateReferences(bundle, errors) {
  const ids = new Map();
  for (const entity of [bundle.project, bundle.outline, bundle.theme, ...Object.keys(bundle).flatMap((key) => Array.isArray(bundle[key]) ? bundle[key] : [])]) {
    if (!entity?.id) continue;
    if (ids.has(entity.id)) errors.push(`duplicate entity id: ${entity.id}`);
    ids.set(entity.id, entity.kind);
  }
  const expect = (id, kind, field) => { if (ids.get(id) !== kind) errors.push(`${field} references missing ${kind}: ${id}`); };
  if (bundle.project) {
    for (const id of bundle.project.source_ids ?? []) expect(id, "source", "project.source_ids");
    for (const id of bundle.project.asset_ids ?? []) expect(id, "asset", "project.asset_ids");
    expect(bundle.project.outline_id, "outline", "project.outline_id");
    expect(bundle.project.theme_id, "theme", "project.theme_id");
  }
  for (const section of bundle.outline?.sections ?? []) for (const id of section.page_ids ?? []) expect(id, "page_spec", "outline.sections.page_ids");
  for (const page of bundle.pages ?? []) {
    for (const ref of page.source_refs ?? []) expect(ref.source_id, "source", `${page.id}.source_refs`);
    for (const slot of page.asset_slots ?? []) expect(slot.asset_id, "asset", `${page.id}.asset_slots`);
  }
}

function validateFeedbackFinding(finding, index, errors) {
  const prefix = `findings[${index}]`;
  if (!isObject(finding)) { errors.push(`${prefix} must be an object`); return; }
  if (!EVAL_CATEGORIES.includes(finding.eval_category)) errors.push(`${prefix}.eval_category is invalid: ${finding.eval_category}`);
  if (!ROOT_CAUSES.includes(finding.root_cause)) errors.push(`${prefix}.root_cause is invalid: ${finding.root_cause}`);
  if (!hasText(finding.root_cause_fingerprint)) errors.push(`${prefix}.root_cause_fingerprint is required`);
  if (!FINDING_SEVERITIES.includes(finding.severity)) errors.push(`${prefix}.severity is invalid: ${finding.severity}`);
  if (!isObject(finding.target) || !hasText(finding.target.kind) || !isId(finding.target.id)) errors.push(`${prefix}.target requires a kind and stable lowercase id`);
  if (!isObject(finding.evidence)) errors.push(`${prefix}.evidence must be an object`);
  if (finding.classification_confidence !== undefined && (!Number.isFinite(finding.classification_confidence) || finding.classification_confidence < 0 || finding.classification_confidence > 1)) errors.push(`${prefix}.classification_confidence must be between 0 and 1`);
  if (finding.corrected_root_cause !== undefined && !ROOT_CAUSES.includes(finding.corrected_root_cause)) errors.push(`${prefix}.corrected_root_cause is invalid: ${finding.corrected_root_cause}`);
}

function requireText(value, field, errors, prefix = "") { if (!hasText(value?.[field])) errors.push(`${prefix}${field} is required`); }
function requireId(value, field, errors) { if (!isId(value?.[field])) errors.push(`${field} must be a stable lowercase identifier`); }
function requireIdList(value, field, errors, allowEmpty = false) { if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.some((item) => !isId(item))) errors.push(`${field} must contain stable identifiers`); }
function requireEnumList(value, field, allowed, errors) { if (!Array.isArray(value) || value.length === 0 || value.some((item) => !allowed.includes(item))) errors.push(`${field} contains an invalid value`); }
function requireEnum(value, field, allowed, errors) { if (!allowed.includes(value?.[field])) errors.push(`${field} is invalid: ${value?.[field]}`); }
function requireHash(value, errors) { requireHashField(value, "sha256", errors); }
function requireHashField(value, field, errors) { if (!SHA256_PATTERN.test(value?.[field] ?? "")) errors.push(`${field} must be a SHA-256 digest`); }
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function isId(value) { return typeof value === "string" && ID_PATTERN.test(value); }
function hasText(value) { return typeof value === "string" && value.trim() !== ""; }
