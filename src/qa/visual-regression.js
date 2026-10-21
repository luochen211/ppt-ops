import crypto from "node:crypto";

export const VISUAL_FAILURE_CATEGORIES = Object.freeze(["layout", "hierarchy", "alignment", "clarity", "imagery", "repetition"]);
export const VISUAL_RULE_SCOPES = Object.freeze(["project", "template", "global"]);

export function createVisualFailureRecord(input) {
  required(input?.id, "VISUAL_FAILURE_ID_REQUIRED");
  required(input?.raw_feedback, "VISUAL_FAILURE_FEEDBACK_REQUIRED");
  required(input?.target?.page_id, "VISUAL_FAILURE_PAGE_REQUIRED");
  required(input?.target?.element_id, "VISUAL_FAILURE_ELEMENT_REQUIRED");
  required(input?.version?.id, "VISUAL_FAILURE_VERSION_REQUIRED");
  required(input?.version?.revision, "VISUAL_FAILURE_VERSION_REQUIRED");
  if (!isSha256(input?.evidence?.screenshot_sha256)) throw coded("VISUAL_FAILURE_EVIDENCE_INVALID", "screenshot_sha256 must be a SHA-256 digest");
  if (!VISUAL_FAILURE_CATEGORIES.includes(input?.classification?.category)) throw coded("VISUAL_FAILURE_CATEGORY_INVALID", "unsupported visual failure category");
  const confidence = input.classification.confidence;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw coded("VISUAL_FAILURE_CONFIDENCE_INVALID", "classification confidence must be between 0 and 1");
  return {
    schema_version: "1.0", kind: "visual_failure_record", id: input.id,
    raw_feedback: input.raw_feedback.trim(),
    target: { page_id: input.target.page_id, element_id: input.target.element_id, bounds: normalizeBounds(input.target.bounds) },
    version: { id: input.version.id, revision: input.version.revision },
    evidence: { screenshot_sha256: input.evidence.screenshot_sha256.toLowerCase(), locator: input.evidence.locator ?? null },
    classification: { category: input.classification.category, confidence, source: "system_inference" },
    status: "proposed", rule_activation: "none",
    record_sha256: digest({ id: input.id, raw_feedback: input.raw_feedback.trim(), target: input.target, version: input.version, evidence: input.evidence })
  };
}

export function bindVisualRepairEvidence(record, input) {
  if (record?.kind !== "visual_failure_record") throw coded("VISUAL_FAILURE_RECORD_INVALID", "a visual failure record is required");
  for (const key of ["before_artifact_sha256", "after_artifact_sha256", "before_page_sha256", "after_page_sha256"]) if (!isSha256(input?.[key])) throw coded("VISUAL_REPAIR_EVIDENCE_INVALID", `${key} must be a SHA-256 digest`);
  const changed = input.changed_targets ?? [];
  if (!Array.isArray(changed) || changed.length === 0) throw coded("VISUAL_REPAIR_CHANGE_REQUIRED", "at least one changed target is required");
  if (changed.some(({ page_id, element_id }) => page_id !== record.target.page_id || element_id !== record.target.element_id)) throw coded("VISUAL_REPAIR_SCOPE_VIOLATION", "repair evidence includes an unauthorized page or element");
  if (input.unrelated_pages_unchanged !== true || input.unrelated_fields_unchanged !== true) throw coded("VISUAL_REPAIR_SCOPE_VIOLATION", "unrelated pages and fields must remain unchanged");
  return {
    schema_version: "1.0", kind: "visual_repair_evidence", id: `${record.id}-repair`, failure_record_id: record.id,
    before: { artifact_sha256: input.before_artifact_sha256, page_sha256: input.before_page_sha256 },
    after: { artifact_sha256: input.after_artifact_sha256, page_sha256: input.after_page_sha256 },
    changed_targets: structuredClone(changed), unrelated_pages_unchanged: true, unrelated_fields_unchanged: true,
    acceptance_boundary: "Before/after evidence proves bounded change, not visual acceptance."
  };
}

function normalizeBounds(value) {
  if (!value) return null;
  for (const key of ["x", "y", "width", "height"]) if (!Number.isFinite(value[key]) || value[key] < 0) throw coded("VISUAL_FAILURE_BOUNDS_INVALID", `bounds.${key} must be non-negative`);
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}
function digest(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function isSha256(value) { return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value); }
function required(value, code) { if (typeof value !== "string" || !value.trim()) throw coded(code, `${code.toLowerCase()} is required`); }
function coded(code, message) { return Object.assign(new Error(message), { code }); }
