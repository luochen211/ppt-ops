import crypto from "node:crypto";
import { isDeepStrictEqual } from "node:util";

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
    raw_feedback: input.raw_feedback,
    target: { page_id: input.target.page_id, element_id: input.target.element_id, bounds: normalizeBounds(input.target.bounds) },
    version: { id: input.version.id, revision: input.version.revision },
    evidence: { screenshot_sha256: input.evidence.screenshot_sha256.toLowerCase(), locator: input.evidence.locator ?? null },
    classification: { category: input.classification.category, confidence, source: "system_inference" },
    status: "proposed", rule_activation: "none",
    record_sha256: digest({ id: input.id, raw_feedback: input.raw_feedback, target: input.target, version: input.version, evidence: input.evidence })
  };
}

// Artifacts are complete JSON snapshots: { pages: [{ id, elements: [{ id, fields }] }] }.
// Artifact hashes cover the supplied UTF-8 bytes; page hashes cover JSON.stringify(page).
// Each fields key is an atomic authorization unit (including nested values).
// Authorization is supplied separately from the observed changes.
// This verifies snapshot preservation only, not a rendered deck or visual acceptance.
export function bindVisualRepairEvidence(record, input, authorization) {
  const invalid = (message) => { throw coded("VISUAL_REPAIR_EVIDENCE_INVALID", message); };
  const scope = () => { throw coded("VISUAL_REPAIR_SCOPE_VIOLATION", "repair exceeds authorized page, element, or fields"); };
  if (record?.kind !== "visual_failure_record" || !record.target) throw coded("VISUAL_FAILURE_RECORD_INVALID", "a visual failure record is required");
  const validFields = (fields) => Array.isArray(fields) && fields.length > 0 && fields.every((field) => typeof field === "string" && field.trim()) && new Set(fields).size === fields.length;
  if (!authorization || authorization.failure_record_id !== record.id || authorization.page_id !== record.target.page_id || authorization.element_id !== record.target.element_id || !validFields(authorization.fields)) scope();
  const changed = input?.changed_targets;
  if (!Array.isArray(changed) || changed.length !== 1) throw coded("VISUAL_REPAIR_CHANGE_REQUIRED", "exactly one changed target is required");
  const target = changed[0];
  if (!target || target.page_id !== authorization.page_id || target.element_id !== authorization.element_id) scope();
  if (!validFields(target.fields)) invalid("changed fields must be a non-empty unique string array");
  if (target.fields.some((field) => !authorization.fields.includes(field))) scope();
  const snapshots = [];
  const elements = [];
  for (const side of ["before", "after"]) {
    const json = input[`${side}_artifact_json`];
    if (typeof json !== "string" || !isSha256(input[`${side}_artifact_sha256`]) || crypto.createHash("sha256").update(json).digest("hex") !== input[`${side}_artifact_sha256`].toLowerCase()) invalid("artifact bytes must match their SHA-256 digest");
    let snapshot;
    try { snapshot = JSON.parse(json); } catch { invalid("artifact must be valid JSON"); }
    if (!snapshot || !Array.isArray(snapshot.pages) || snapshot.pages.length === 0) invalid("complete page snapshots are required");
    const ids = new Set();
    for (const page of snapshot.pages) {
      if (!page || typeof page.id !== "string" || !page.id.trim() || ids.has(page.id) || !Array.isArray(page.elements)) invalid("pages require unique IDs and complete elements");
      ids.add(page.id);
      const elementIds = new Set();
      for (const element of page.elements) {
        if (!element || typeof element.id !== "string" || !element.id.trim() || elementIds.has(element.id) || !element.fields || typeof element.fields !== "object" || Array.isArray(element.fields)) invalid("elements require unique IDs and field objects");
        elementIds.add(element.id);
      }
    }
    const page = snapshot.pages.find((page) => page.id === authorization.page_id);
    const element = page?.elements.find((element) => element.id === authorization.element_id);
    if (!element) invalid("target must exist in both snapshots");
    if (!isSha256(input[`${side}_page_sha256`]) || digest(page) !== input[`${side}_page_sha256`].toLowerCase()) invalid("target page hash must match the bound snapshot");
    snapshots.push(snapshot); elements.push(element);
  }
  const actual = [...new Set([...Object.keys(elements[0].fields), ...Object.keys(elements[1].fields)])].filter((field) => Object.hasOwn(elements[0].fields, field) !== Object.hasOwn(elements[1].fields, field) || !isDeepStrictEqual(elements[0].fields[field], elements[1].fields[field]));
  if (!isDeepStrictEqual([...actual].sort(), [...target.fields].sort())) invalid("declared changed fields must exactly match snapshot changes");
  // Remove only the authorized deltas, then compare every remaining page/element/metadata field.
  for (const element of elements) for (const field of target.fields) delete element.fields[field];
  if (!isDeepStrictEqual(snapshots[0], snapshots[1])) scope();
  return {
    schema_version: "1.0", kind: "visual_repair_evidence", id: `${record.id}-repair`, failure_record_id: record.id, failure_record_sha256: record.record_sha256,
    before: { artifact_json: input.before_artifact_json, artifact_sha256: input.before_artifact_sha256.toLowerCase(), page_sha256: input.before_page_sha256.toLowerCase() },
    after: { artifact_json: input.after_artifact_json, artifact_sha256: input.after_artifact_sha256.toLowerCase(), page_sha256: input.after_page_sha256.toLowerCase() },
    authorization: structuredClone(authorization), changed_targets: structuredClone(changed),
    unrelated_pages_unchanged: true, unrelated_fields_unchanged: true,
    acceptance_boundary: "Bounded change verified for supplied JSON snapshots only; not rendered artifact or visual acceptance."
  };
}

function normalizeBounds(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw coded("VISUAL_FAILURE_BOUNDS_INVALID", "bounds must be an object");
  for (const key of ["x", "y", "width", "height"]) if (!Number.isFinite(value[key]) || value[key] < 0) throw coded("VISUAL_FAILURE_BOUNDS_INVALID", `bounds.${key} must be non-negative`);
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}
function digest(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function isSha256(value) { return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value); }
function required(value, code) { if (typeof value !== "string" || !value.trim()) throw coded(code, `${code.toLowerCase()} is required`); }
function coded(code, message) { return Object.assign(new Error(message), { code }); }
