import { validateDiagram } from "../layout/diagram.js";
import { DELIVERY_MODES, INTERACTION_KINDS } from "./delivery.js";
import { validateAccessibilityProfile } from "../accessibility/index.js";

export const CONTRACT_VERSION = "1.0";
export const EVAL_CATEGORIES = Object.freeze(["content_fidelity", "cognitive_clarity", "semantic_accuracy", "visual_hierarchy", "layout_composition", "aesthetic_brand", "powerpoint_fidelity", "editability", "cross_page_continuity", "evidence_provenance", "user_acceptance"]);
export const ROOT_CAUSES = Object.freeze(["content_truth", "page_task", "information_relationship", "visual_grammar", "powerpoint_implementation", "process"]);
export const FINDING_SEVERITIES = Object.freeze(["note", "minor", "major", "blocking"]);

export function createV1Entity(kind, id, fields = {}) { return { contract_version: CONTRACT_VERSION, kind, id, ...fields }; }
export function pageSpecId(page) { return `page-${String(page).padStart(3, "0")}`; }

export const ENTITY_KINDS = Object.freeze([
  "project", "source", "outline", "page_spec", "theme", "template", "asset",
  "candidate", "candidate_feedback", "powerpoint_observation", "visual_asset_brief", "visual_asset_generation",
  "visual_asset_observation", "visual_asset_decision", "approval", "version", "build", "review", "handoff"
]);

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const RELATIONS = ["sequence", "parallel", "cause_effect", "before_after", "hierarchy", "process", "cycle", "comparison", "hero"];
const CONTENT_STATES = ["draft", "prototype", "approved", "built", "reviewed"];
const SCREENSHOT_CONTENT_ROLES = ["contextual", "read_required"];
const SCREENSHOT_TREATMENTS = ["crop", "zoom", "callout", "annotation"];

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
    if (value.outputs !== undefined) requireEnumList(value.outputs, "outputs", ["html", "pptx", "pdf", "png"], errors);
    if (value.delivery_mode !== undefined) requireEnum(value, "delivery_mode", DELIVERY_MODES, errors);
    for (const error of validateAccessibilityProfile(value.accessibility_profile)) errors.push(error);
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
    for (const [index, slot] of (value.asset_slots ?? []).entries()) {
      if (slot?.evidence_purpose !== undefined && !hasText(slot.evidence_purpose)) errors.push(`asset_slots[${index}].evidence_purpose must be non-empty`);
    }

    errors.push(...validateDiagram(value.diagram));
    validateDeliveryFields(value, errors);
    validateAccessibilityFields(value, errors);
  },
  theme(value, errors) { if (!isObject(value.tokens)) errors.push("tokens must be an object"); },
  template(value, errors) { requireText(value, "name", errors); if (!isObject(value.slots)) errors.push("slots must be an object"); if (!isObject(value.renderers)) errors.push("renderers must be an object"); },
  asset(value, errors) {
    requireText(value, "file", errors); requireText(value, "type", errors); requireHash(value, errors);
    if (value.screenshot_evidence !== undefined) validateScreenshotEvidence(value.screenshot_evidence, "screenshot_evidence", errors);
  },
  visual_asset_brief(value, errors) {
    requireEnum(value, "role", ["character", "scene", "diagram", "background"], errors);
    requireEnum(value, "mode", ["fresh", "reference_edit"], errors);
    requireId(value, "page_id", errors); requireId(value, "slot_role", errors);
    for (const field of ["semantic_goal", "three_second_message", "action"]) requireText(value, field, errors);
    if (!(hasText(value.aspect_ratio) || (Number.isFinite(value.aspect_ratio) && value.aspect_ratio > 0))) errors.push("aspect_ratio must be a positive number or ratio string");
    requireEnum(value, "text_policy", ["none", "exact_only"], errors);
    if (!Number.isInteger(value.subject_count) || value.subject_count < 0) errors.push("subject_count must be a non-negative integer");
  },
  visual_asset_generation(value, errors) {
    requireId(value, "brief_id", errors);
    requireEnum(value, "mode", ["fresh", "reference_edit"], errors);
    requireEnum(value, "state", ["provider_failed", "validation_failed", "awaiting_visual_observation"], errors);
    requireHashField(value, "prompt_sha256", errors);
    requireText(value, "provider", errors); requireText(value, "model", errors);
  },
  visual_asset_observation(value, errors) {
    requireId(value, "generation_id", errors);
    requireEnum(value, "actor", ["agent", "human"], errors);
    requireEnum(value, "verdict", ["pass", "fail"], errors);
    requireHashField(value, "candidate_sha256", errors);
    if (!isObject(value.checks)) errors.push("checks must be an object");
  },
  visual_asset_decision(value, errors) {
    requireId(value, "generation_id", errors);
    requireEnum(value, "actor", ["user"], errors);
    requireEnum(value, "decision", ["accept", "continue_iteration", "reject"], errors);
    requireText(value, "raw_feedback", errors);
  },
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

function validateScreenshotEvidence(value, field, errors) {
  if (!isObject(value)) { errors.push(`${field} must be an object`); return; }
  if (!SCREENSHOT_CONTENT_ROLES.includes(value.content_role)) errors.push(`${field}.content_role is invalid: ${value.content_role}`);
  if (!hasText(value.evidence_purpose)) errors.push(`${field}.evidence_purpose is required`);
  validateNormalizedRegion(value.focal_region, `${field}.focal_region`, errors);
  if (value.presentation_treatments !== undefined && (!Array.isArray(value.presentation_treatments) || value.presentation_treatments.some((item) => !SCREENSHOT_TREATMENTS.includes(item)))) {
    errors.push(`${field}.presentation_treatments contains an invalid value`);
  }
  if (value.annotation_text !== undefined && (!hasText(value.annotation_text) || value.annotation_text.length > 80)) errors.push(`${field}.annotation_text must contain 1–80 characters`);
  if (value.human_review_required !== undefined && typeof value.human_review_required !== "boolean") errors.push(`${field}.human_review_required must be boolean`);
  if (value.content_role === "read_required" && (value.presentation_treatments?.length ?? 0) === 0 && value.human_review_required !== true) {
    errors.push(`${field} with read_required content needs a presentation treatment or human_review_required`);
  }
}

function validateNormalizedRegion(value, field, errors) {
  if (!isObject(value)) { errors.push(`${field} must be an object`); return; }
  for (const key of ["x", "y", "width", "height"]) if (!Number.isFinite(value[key])) errors.push(`${field}.${key} must be a finite number`);
  if (Number.isFinite(value.x) && (value.x < 0 || value.x > 1)) errors.push(`${field}.x must be between 0 and 1`);
  if (Number.isFinite(value.y) && (value.y < 0 || value.y > 1)) errors.push(`${field}.y must be between 0 and 1`);
  if (Number.isFinite(value.width) && (value.width <= 0 || value.width > 1)) errors.push(`${field}.width must be greater than 0 and at most 1`);
  if (Number.isFinite(value.height) && (value.height <= 0 || value.height > 1)) errors.push(`${field}.height must be greater than 0 and at most 1`);
  if (Number.isFinite(value.x) && Number.isFinite(value.width) && value.x + value.width > 1) errors.push(`${field}.x + width must not exceed 1`);
  if (Number.isFinite(value.y) && Number.isFinite(value.height) && value.y + value.height > 1) errors.push(`${field}.y + height must not exceed 1`);
}


function validateDeliveryFields(value, errors) {
  if (value.estimated_duration_seconds !== undefined && (!Number.isInteger(value.estimated_duration_seconds) || value.estimated_duration_seconds < 1)) {
    errors.push("estimated_duration_seconds must be a positive integer");
  }
  if (value.speaker_notes !== undefined && !hasText(value.speaker_notes)) errors.push("speaker_notes must be a non-empty string");
  if (value.speaker_note_intent !== undefined && !hasText(value.speaker_note_intent)) errors.push("speaker_note_intent must be a non-empty string");
  if (value.audience_interaction !== undefined) {
    if (!isObject(value.audience_interaction)) errors.push("audience_interaction must be an object");
    else {
      requireEnum(value.audience_interaction, "kind", INTERACTION_KINDS, errors);
      requireText(value.audience_interaction, "intent", errors, "audience_interaction.");
      if (value.audience_interaction.expected_response !== undefined && !hasText(value.audience_interaction.expected_response)) errors.push("audience_interaction.expected_response must be a non-empty string");
    }
  }
}

function validateAccessibilityFields(value, errors) {
  if (value.accessibility === undefined) return;
  if (!isObject(value.accessibility)) { errors.push("accessibility must be an object"); return; }
  if (value.accessibility.language !== undefined && !hasText(value.accessibility.language)) errors.push("accessibility.language must be a non-empty language tag");
  if (value.accessibility.reading_order !== undefined && (!Array.isArray(value.accessibility.reading_order) || value.accessibility.reading_order.some((item) => !hasText(item)))) errors.push("accessibility.reading_order must contain non-empty semantic item names");
  for (const field of ["links", "charts", "tables", "meaning_dependencies"]) if (value.accessibility[field] !== undefined && !Array.isArray(value.accessibility[field])) errors.push(`accessibility.${field} must be an array`);
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
