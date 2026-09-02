import crypto from "node:crypto";

const ROLES = new Set(["character", "scene", "diagram", "background"]);
const MODES = new Set(["fresh", "reference_edit"]);
const TEXT_POLICIES = new Set(["none", "exact_only"]);
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

export const LOW_POLY_EDITORIAL_PRESET = Object.freeze({
  id: "low-poly-editorial",
  style: "Restrained faceted low-poly editorial illustration with a premium documentary-infographic tone and mature proportions",
  lighting: "Soft directional studio light, controlled contrast, calm and credible mood",
  palette: "Charcoal, graphite, warm ivory, and muted antique gold",
  avoid: Object.freeze([
    "stick figures", "childish cartoons", "toy-like 3D", "stock-photo poses",
    "glossy plastic skin", "presentation text", "pseudo-text", "logos", "watermarks", "fake UI"
  ])
});

export function normalizeVisualBrief(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("visual brief must be an object");
  const brief = {
    role: input.role,
    mode: input.mode ?? "fresh",
    page_id: input.page_id,
    slot_role: input.slot_role,
    semantic_goal: cleanText(input.semantic_goal),
    three_second_message: cleanText(input.three_second_message),
    subject_count: input.subject_count ?? 0,
    identity_boundary: cleanText(input.identity_boundary ?? "non-identifiable subjects"),
    action: cleanText(input.action),
    pose_and_props: cleanText(input.pose_and_props ?? "Natural purposeful posture and only semantically necessary props"),
    prohibited_interpretations: cleanList(input.prohibited_interpretations),
    backdrop: cleanText(input.backdrop ?? "Clean warm-ivory editorial backdrop"),
    composition: cleanText(input.composition ?? "Single clear focal action with generous negative space"),
    framing: cleanText(input.framing ?? "Presentation-ready framing; do not crop important subjects"),
    lighting: cleanText(input.lighting ?? LOW_POLY_EDITORIAL_PRESET.lighting),
    palette: cleanText(input.palette ?? LOW_POLY_EDITORIAL_PRESET.palette),
    style_preset: input.style_preset ?? LOW_POLY_EDITORIAL_PRESET.id,
    style: cleanText(input.style ?? LOW_POLY_EDITORIAL_PRESET.style),
    copy_safe_zones: cleanList(input.copy_safe_zones),
    aspect_ratio: input.aspect_ratio ?? "1:1",
    ratio_tolerance: input.ratio_tolerance ?? 0.03,
    width: input.width,
    height: input.height,
    text_policy: input.text_policy ?? "none",
    exact_text: cleanList(input.exact_text),
    transparency_required: input.transparency_required === true,
    evidence_policy: cleanText(input.evidence_policy ?? "Abstract editorial illustration only; do not imitate documentary evidence"),
    avoid: unique([...LOW_POLY_EDITORIAL_PRESET.avoid, ...cleanList(input.avoid)]),
    reference_asset_ids: cleanList(input.reference_asset_ids),
    parent_generation_id: input.parent_generation_id,
    change_scope: cleanText(input.change_scope ?? ""),
    invariants: cleanList(input.invariants)
  };
  validateBrief(brief);
  return Object.freeze(brief);
}

export function compileVisualPrompt(input) {
  const brief = normalizeVisualBrief(input);
  const text = brief.text_policy === "none"
    ? "No visible text, letters, numbers, labels, logos, watermarks, signatures, or pseudo-text."
    : `Render only this exact text, verbatim: ${brief.exact_text.join(" | ")}. Do not invent any other text.`;
  const editConstraint = brief.mode === "reference_edit"
    ? `Reference edit only. Change scope: ${brief.change_scope}. Preserve: ${brief.invariants.join("; ")}.`
    : "Fresh generation; do not imitate a real person or fabricate documentary evidence.";
  const sections = [
    ["Use case", `Presentation visual for ${brief.page_id}, asset slot ${brief.slot_role}. It must communicate within three seconds: ${brief.three_second_message}.`],
    ["Asset type", `${brief.role}; ${brief.transparency_required ? "true transparent PNG required" : "raster presentation asset"}; target aspect ratio ${brief.aspect_ratio}.`],
    ["Primary request", `${brief.action}. Semantic goal: ${brief.semantic_goal}. ${prohibitedSentence(brief.prohibited_interpretations)}`],
    ["Scene/backdrop", brief.backdrop],
    ["Subject", `${brief.subject_count} subject${brief.subject_count === 1 ? "" : "s"}; ${brief.identity_boundary}; ${brief.pose_and_props}.`],
    ["Style/medium", brief.style],
    ["Composition/framing", `${brief.composition}. ${brief.framing}. ${copySafeSentence(brief.copy_safe_zones)}`],
    ["Lighting/mood", brief.lighting],
    ["Color palette", brief.palette],
    ["Text", text],
    ["Constraints", `${editConstraint} ${brief.evidence_policy}. Keep all important content inside the frame.`],
    ["Avoid", brief.avoid.join(", ")]
  ];
  const prompt = sections.map(([heading, value]) => `${heading}:\n${value}`).join("\n\n");
  return Object.freeze({ brief, prompt, prompt_sha256: sha256(prompt), sections: Object.freeze(sections.map(([heading]) => heading)) });
}

export function visualBriefId(input) {
  const brief = normalizeVisualBrief(input);
  return `visual-brief-${sha256(stableJson(brief)).slice(0, 16)}`;
}

export function aspectRatioValue(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  const match = String(value).match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match || Number(match[2]) === 0) throw new TypeError("aspect_ratio must be a positive number or W:H");
  return Number(match[1]) / Number(match[2]);
}

function validateBrief(brief) {
  if (!ROLES.has(brief.role)) throw new TypeError(`unsupported visual role: ${brief.role}`);
  if (!MODES.has(brief.mode)) throw new TypeError(`unsupported generation mode: ${brief.mode}`);
  if (!ID_PATTERN.test(brief.page_id ?? "")) throw new TypeError("page_id must be a stable lowercase identifier");
  if (!ID_PATTERN.test(brief.slot_role ?? "")) throw new TypeError("slot_role must be a stable lowercase identifier");
  for (const field of ["semantic_goal", "three_second_message", "action", "style", "composition", "framing", "lighting", "palette", "backdrop"]) {
    if (!brief[field]) throw new TypeError(`${field} is required`);
  }
  if (!Number.isInteger(brief.subject_count) || brief.subject_count < 0) throw new TypeError("subject_count must be a non-negative integer");
  if (["character", "scene"].includes(brief.role) && brief.subject_count < 1) throw new TypeError(`${brief.role} requires at least one subject`);
  aspectRatioValue(brief.aspect_ratio);
  if (!Number.isFinite(brief.ratio_tolerance) || brief.ratio_tolerance < 0 || brief.ratio_tolerance > 0.25) throw new TypeError("ratio_tolerance must be between 0 and 0.25");
  if ((brief.width !== undefined && (!Number.isInteger(brief.width) || brief.width < 1)) || (brief.height !== undefined && (!Number.isInteger(brief.height) || brief.height < 1))) throw new TypeError("width and height must be positive integers when supplied");
  if (!TEXT_POLICIES.has(brief.text_policy)) throw new TypeError(`unsupported text_policy: ${brief.text_policy}`);
  if (brief.text_policy === "exact_only" && brief.exact_text.length === 0) throw new TypeError("exact_only text policy requires exact_text");
  if (brief.text_policy === "none" && brief.exact_text.length > 0) throw new TypeError("exact_text is forbidden when text_policy is none");
  if (brief.mode === "fresh" && (brief.reference_asset_ids.length > 0 || brief.parent_generation_id)) throw new TypeError("fresh generation cannot include references or a parent generation");
  if (brief.reference_asset_ids.some((id) => !ID_PATTERN.test(id))) throw new TypeError("reference_asset_ids must contain stable lowercase identifiers");
  if (brief.parent_generation_id !== undefined && !ID_PATTERN.test(brief.parent_generation_id)) throw new TypeError("parent_generation_id must be a stable lowercase identifier");
  if (brief.mode === "reference_edit") {
    if (brief.reference_asset_ids.length === 0) throw new TypeError("reference_edit requires reference_asset_ids");
    if (!brief.change_scope) throw new TypeError("reference_edit requires change_scope");
    if (brief.invariants.length === 0) throw new TypeError("reference_edit requires invariants");
  }
}

function cleanText(value) { return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : ""; }
function cleanList(value) { return Array.isArray(value) ? unique(value.map(cleanText).filter(Boolean)) : []; }
function unique(items) { return [...new Set(items)]; }
function prohibitedSentence(values) { return values.length ? `It must not read as: ${values.join("; ")}.` : ""; }
function copySafeSentence(values) { return values.length ? `Reserve copy-safe negative space at: ${values.join("; ")}.` : "No copy-safe zone is required."; }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
