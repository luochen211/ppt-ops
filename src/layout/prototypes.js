const CAPACITY_FIELDS = ["title_chars", "body_items", "body_item_chars", "asset_slots"];
const CONTENT_MODES = new Set(["text-led", "image-led", "interaction", "comparison"]);

export const PAGE_PROTOTYPE_CATALOG = Object.freeze([
  prototype("situation-risk-action", "Move from context to consequence and response", ["process", "sequence", "cause_effect"], "text-led", { body_items: 3, asset_slots: 1 }, ["optional-context-image"]),
  prototype("find-the-hazard", "Inspect a scene and identify a concrete risk", ["cause_effect", "comparison"], "image-led", { body_items: 4, asset_slots: 1 }, ["required-review-image", "optional-callouts"]),
  prototype("before-after", "Contrast an initial state with an improved state", ["before_after", "comparison"], "comparison", { body_items: 4, asset_slots: 2 }, ["paired-evidence"]),
  prototype("compare-workplaces", "Compare two environments against shared criteria", ["comparison", "parallel"], "comparison", { body_items: 6, asset_slots: 2 }, ["paired-workplace-images"]),
  prototype("worked-example", "Demonstrate a method through ordered evidence and reasoning", ["sequence", "process"], "text-led", { body_items: 6, asset_slots: 1 }, ["optional-example-artifact"]),
  prototype("scenario-decision", "Ask the audience to choose an action in context", ["process", "cause_effect"], "interaction", { body_items: 4, asset_slots: 1 }, ["scenario-context"]),
  prototype("practice-reveal", "Separate an audience attempt from the explained answer", ["sequence", "parallel"], "interaction", { body_items: 4, asset_slots: 1 }, ["reveal-state"]),
  prototype("evidence-judgement-report", "Turn evidence into a judgement and reportable action", ["process", "sequence", "cause_effect"], "text-led", { body_items: 5, asset_slots: 2 }, ["evidence-items"]),
  prototype("image-led-debrief", "Use a dominant visual as the anchor for reflection", ["parallel", "cause_effect"], "image-led", { body_items: 3, asset_slots: 1 }, ["required-debrief-image"]),
  prototype("assessment-checkpoint", "Check understanding with a bounded response and rationale", ["comparison", "sequence"], "interaction", { body_items: 5, asset_slots: 1 }, ["response-options"])
]);

export function validatePagePrototype(value) {
  const errors = [];
  if (value?.kind !== "page_prototype") errors.push("kind must be page_prototype");
  for (const field of ["id", "name", "purpose"]) if (!hasText(value?.[field])) errors.push(`${field} is required`);
  if (!Array.isArray(value?.relations) || value.relations.length === 0 || value.relations.some((item) => !hasText(item))) errors.push("relations must contain at least one relation");
  if (!CONTENT_MODES.has(value?.content_mode)) errors.push("content_mode is unsupported");
  for (const field of CAPACITY_FIELDS) if (!Number.isInteger(value?.capacity?.[field]) || value.capacity[field] < 0) errors.push(`capacity.${field} must be a non-negative integer`);
  if (!Array.isArray(value?.material_requirements) || value.material_requirements.some((item) => !hasText(item))) errors.push("material_requirements must be text entries");
  if (!hasText(value?.renderers?.html) || !hasText(value?.renderers?.pptx)) errors.push("independent html and pptx renderer mappings are required");
  return errors;
}

export function prototypesForRelation(relation, catalog = PAGE_PROTOTYPE_CATALOG) {
  return catalog.filter((entry) => entry.relations.includes(relation));
}

function prototype(id, purpose, relations, contentMode, capacity, materialRequirements) {
  return Object.freeze({
    contract_version: "1.0", kind: "page_prototype", id: `prototype-${id}`, name: id,
    purpose, relations: Object.freeze(relations), content_mode: contentMode,
    capacity: Object.freeze({ title_chars: 90, body_items: 6, body_item_chars: 180, asset_slots: 2, ...capacity }),
    material_requirements: Object.freeze(materialRequirements),
    renderers: Object.freeze({ html: `prototype-${id}-html`, pptx: `prototype-${id}-pptx` })
  });
}

function hasText(value) { return typeof value === "string" && value.trim().length > 0; }

