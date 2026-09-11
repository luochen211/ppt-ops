import crypto from "node:crypto";
import { resolveTheme, templateForRelation } from "../layout/catalog.js";

export const ACCESSIBILITY_INTENTS = Object.freeze(["create_accessible", "audit_only", "remediate"]);
export const ACCESSIBILITY_EVIDENCE_KINDS = Object.freeze([
  "automated", "human_accessibility_review", "assistive_technology",
  "powerpoint_accessibility_checker", "organization_approval", "legal_policy_conformance"
]);

const FORMAT_CAPABILITIES = Object.freeze({
  html: Object.freeze({
    status: "partial",
    supported: ["editable_dom", "keyboard_navigation", "visible_focus", "landmarks_and_headings", "reduced_motion", "accessible_control_names", "document_and_page_language", "declared_direction", "text_scaling", "image_descriptions", "semantic_alternatives"],
    limitations: ["authored reading order is compared with rendered DOM order; incompatible layouts require a reviewed change", "media caption/transcript playback must be verified in the actual artifact", "screen-reader behavior requires assistive-technology testing"]
  }),
  pptx: Object.freeze({
    status: "partial",
    supported: ["editable_objects", "image_alt_text", "document_and_page_language", "declared_direction", "text_scaling", "object_order_inspection"],
    limitations: ["object order is drawing order; independent assistive reading-order metadata is unsupported", "decorative flags, semantic tables/charts and media alternatives require real PowerPoint checking", "real Microsoft PowerPoint Accessibility Checker and assistive-technology testing remain external evidence"]
  }),
  pdf: Object.freeze({ status: "unavailable", supported: [], limitations: ["no tagged-PDF exporter is available"] }),
  png: Object.freeze({ status: "degraded", supported: [], limitations: ["a raster image does not preserve presentation semantics, links, reading order, or editable text"] })
});

export function validateAccessibilityProfile(profile) {
  if (profile === undefined) return [];
  const errors = [];
  if (!isObject(profile)) return ["accessibility_profile must be an object"];
  if (profile.enabled !== true) errors.push("accessibility_profile.enabled must be true when a profile is declared");
  if (!ACCESSIBILITY_INTENTS.includes(profile.intent)) errors.push(`accessibility_profile.intent is invalid: ${profile.intent}`);
  if (!hasText(profile.document_language) || !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(profile.document_language)) errors.push("accessibility_profile.document_language must be a language tag");
  if (!["ltr", "rtl"].includes(profile.reading_direction)) errors.push(`accessibility_profile.reading_direction is invalid: ${profile.reading_direction}`);
  if (!Array.isArray(profile.target_formats) || profile.target_formats.length === 0 || profile.target_formats.some((format) => !Object.hasOwn(FORMAT_CAPABILITIES, format))) errors.push("accessibility_profile.target_formats must contain html, pptx, pdf, or png");
  if (profile.text_scale !== undefined && (!Number.isFinite(profile.text_scale) || profile.text_scale < 1)) errors.push("accessibility_profile.text_scale must be a number greater than or equal to 1");
  if (profile.standard_target !== undefined && (!isObject(profile.standard_target) || !hasText(profile.standard_target.name) || !hasText(profile.standard_target.version))) errors.push("accessibility_profile.standard_target requires an exact name and version");
  for (const field of ["audience_needs", "organization_policies", "required_evidence", "assumptions", "exceptions", "unresolved_risks"]) {
    if (profile[field] !== undefined && (!Array.isArray(profile[field]) || profile[field].some((item) => !hasText(item)))) errors.push(`accessibility_profile.${field} must contain non-empty strings`);
  }
  if (Array.isArray(profile.required_evidence) && profile.required_evidence.some((kind) => !ACCESSIBILITY_EVIDENCE_KINDS.includes(kind) || ["automated", "legal_policy_conformance"].includes(kind))) errors.push("accessibility_profile.required_evidence contains an invalid human evidence kind");
  return errors;
}

/** Pure, read-only inspection tied to the exact semantic source hash. */
export function auditAccessibility(project, options = {}) {
  const profile = project?.project?.accessibility_profile;
  const profileErrors = validateAccessibilityProfile(profile);
  if (!profile) return disabledReport(project);
  if (profileErrors.length) throw new TypeError(`invalid accessibility profile:\n${profileErrors.map((error) => `- ${error}`).join("\n")}`);

  const findings = [];
  const titles = new Map();
  for (const page of project.pages ?? []) {
    const pageId = page.id ?? `page-${String(page.page).padStart(3, "0")}`;
    const title = page.screen_text?.title?.trim();
    if (!isMeaningfulTitle(title)) add(findings, page, pageId, "meaningful-title", "blocking", "Page has no meaningful title.");
    else {
      const normalized = title.toLocaleLowerCase();
      if (titles.has(normalized)) add(findings, page, pageId, "unique-title", "major", `Title duplicates ${titles.get(normalized)}.`);
      else titles.set(normalized, pageId);
    }

    const semantics = page.accessibility ?? {};
    if (!hasText(semantics.language) && !hasText(profile.document_language)) add(findings, page, pageId, "page-language", "major", "No document or page language is declared.");
    validateReadingOrder(findings, page, pageId, semantics);
    validateAssets(findings, page, pageId, project.assets ?? []);
    validateLinks(findings, page, pageId, semantics.links);
    validateCharts(findings, page, pageId, semantics.charts);
    validateTables(findings, page, pageId, semantics.tables);
    validateNonColorCues(findings, page, pageId, semantics);
    validateMedia(findings, page, pageId, project.assets ?? []);
    validateTextCapacity(findings, page, pageId, profile.text_scale ?? 1);
    validateContrast(findings, page, pageId, project);
  }

  const capabilities = capabilityMatrix(profile.target_formats);
  for (const [format, capability] of Object.entries(capabilities)) {
    if (capability.status === "unavailable" || capability.status === "degraded") findings.push(finding("format-capability", capability.status === "unavailable" ? "blocking" : "major", { kind: "format", id: format }, `${format.toUpperCase()} accessibility preservation is ${capability.status}.`, { limitations: capability.limitations }));
  }
  const status = findings.some(({ severity }) => severity === "blocking") ? "failed" : findings.length ? "needs_review" : "passed";
  return Object.freeze({
    schema_version: "1.0", kind: "accessibility_audit", intent: "audit_only", mutation_performed: false,
    project: project.project.name, source_revision: sourceHash(project), build_revision: options.buildRevision ?? null, declared_profile: Object.freeze(structuredClone(profile)),
    status, finding_count: findings.length, findings: Object.freeze(findings), format_capabilities: capabilities,
    evidence: evidenceStates(profile, findings),
    claims: Object.freeze({ automated_conformance: false, legal_or_policy_conformance: "not_claimed", separate_accessible_variant_created: false })
  });
}

export function capabilityMatrix(formats) {
  return Object.freeze(Object.fromEntries((formats ?? []).map((format) => [format, Object.freeze({ format, ...FORMAT_CAPABILITIES[format] })])));
}

function disabledReport(project) {
  return Object.freeze({ schema_version: "1.0", kind: "accessibility_audit", intent: "audit_only", mutation_performed: false, project: project?.project?.name,
    status: "not_requested", source_revision: sourceHash(project), build_revision: null, finding_count: 0, findings: Object.freeze([]), format_capabilities: Object.freeze({}), evidence: Object.freeze([]),
    claims: Object.freeze({ automated_conformance: false, legal_or_policy_conformance: "not_claimed", separate_accessible_variant_created: false }) });
}

function validateReadingOrder(findings, page, pageId, semantics) {
  const order = semantics.reading_order;
  if (!Array.isArray(order) || order.length === 0) return add(findings, page, pageId, "semantic-reading-order", "major", "Intended semantic reading order is not declared.");
  if (order.some((item) => !hasText(item)) || new Set(order).size !== order.length) add(findings, page, pageId, "semantic-reading-order", "major", "Reading order must contain unique, named items.");
}

function validateAssets(findings, page, pageId, assets) {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  for (const slot of page.asset_slots ?? []) {
    const asset = byId.get(slot.asset_id) ?? {};
    const explicitlyDecorative = asset.decorative === true || slot.decorative === true;
    const described = hasText(asset.alt) || hasText(slot.alt) || hasText(asset.long_description) || hasText(slot.long_description);
    if (!explicitlyDecorative && !described) add(findings, page, pageId, "asset-description", "blocking", `Asset ${slot.asset_id} needs alternative text, a long-description strategy, or an explicit decorative state.`, { asset_id: slot.asset_id });
    if (explicitlyDecorative && described) add(findings, page, pageId, "decorative-state", "minor", `Asset ${slot.asset_id} is decorative but also has a description; resolve the conflicting intent.`, { asset_id: slot.asset_id });
  }
}

function validateLinks(findings, page, pageId, links) {
  for (const [index, link] of (Array.isArray(links) ? links : []).entries()) {
    if (!hasText(link?.label) || !hasText(link?.destination)) add(findings, page, pageId, "meaningful-link", "major", `Link ${index + 1} needs a meaningful label and destination.`);
    else if (!/^(https?:\/\/|mailto:)/i.test(link.destination)) add(findings, page, pageId, "meaningful-link", "major", `Link ${index + 1} has an unsupported destination.`, { destination: link.destination });
    else if (/^https?:\/\//i.test(link.label.trim())) add(findings, page, pageId, "meaningful-link", "major", `Link ${index + 1} uses a raw URL as its label.`, { destination: link.destination });
  }
}

function validateCharts(findings, page, pageId, charts) {
  for (const [index, chart] of (Array.isArray(charts) ? charts : []).entries()) {
    if (!hasText(chart?.conclusion)) add(findings, page, pageId, "chart-conclusion", "major", `Chart ${index + 1} does not expose its conclusion.`);
    if (![chart?.data_table_ref, chart?.long_description, chart?.accessible_data].some(hasText)) add(findings, page, pageId, "chart-alternative", "major", `Chart ${index + 1} needs accessible data or a description alternative.`);
  }
}

function validateTables(findings, page, pageId, tables) {
  for (const [index, table] of (Array.isArray(tables) ? tables : []).entries()) {
    if (!Array.isArray(table?.headers) || table.headers.length === 0 || table.headers.some((header) => !hasText(header))) add(findings, page, pageId, "table-headers", "major", `Table ${index + 1} does not identify headers.`);
    if (table?.simple_structure !== true) add(findings, page, pageId, "table-structure", "major", `Table ${index + 1} needs human review because its structure is not declared simple.`, {}, "human_required");
  }
}

function validateNonColorCues(findings, page, pageId, semantics) {
  const forbidden = new Set(["color_only", "position_only", "animation_only", "hover_only", "speaker_notes_only", "image_of_text"]);
  for (const dependency of semantics.meaning_dependencies ?? []) if (forbidden.has(dependency)) add(findings, page, pageId, "single-channel-meaning", "major", `Meaning depends on ${dependency.replaceAll("_", " ")}.`, { dependency });
  if (semantics.text_on_image === true) add(findings, page, pageId, "text-on-image-contrast", "major", "Text-on-image contrast is uncertain and requires human review.", {}, "human_required");
}

function validateMedia(findings, page, pageId, assets) {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  for (const slot of page.asset_slots ?? []) {
    const asset = byId.get(slot.asset_id);
    if (!["video", "audio"].includes(asset?.type) && !asset?.mime?.startsWith("video/") && !asset?.mime?.startsWith("audio/")) continue;
    if (!hasText(asset.caption_file)) add(findings, page, pageId, "media-captions", "major", `Media ${asset.id} has no caption file.`);
    if (!hasText(asset.transcript_file)) add(findings, page, pageId, "media-transcript", "major", `Media ${asset.id} has no transcript.`);
    if (asset.autoplay === true || asset.flashing === true) add(findings, page, pageId, "media-motion-risk", "blocking", `Media ${asset.id} declares autoplay or flashing behavior.`);
  }
}

function validateTextCapacity(findings, page, pageId, scale) {
  if (scale <= 1) return;
  const capacity = templateForRelation(page.relation).capacity;
  const effective = Object.fromEntries(Object.entries(capacity).map(([key, value]) => [key, Math.max(1, Math.floor(value / scale))]));
  const body = page.screen_text?.body ?? [];
  const failures = [];
  if ((page.screen_text?.title?.length ?? 0) > effective.title_chars) failures.push(`title exceeds scaled capacity ${effective.title_chars}`);
  if ((page.three_second_message?.length ?? 0) > effective.message_chars) failures.push(`message exceeds scaled capacity ${effective.message_chars}`);
  if (body.length > effective.body_items) failures.push(`body count exceeds scaled capacity ${effective.body_items}`);
  if (body.some((line) => line.length > effective.body_item_chars)) failures.push(`a body item exceeds scaled capacity ${effective.body_item_chars}`);
  if (body.reduce((sum, line) => sum + line.length, 0) > effective.total_body_chars) failures.push(`body text exceeds scaled total capacity ${effective.total_body_chars}`);
  if (failures.length) add(findings, page, pageId, "scaled-text-capacity", "blocking", `Text does not fit the declared ${scale}x scale profile; content or layout must be reviewed without automatic shrinking.`, { failures, scale });
}

function evidenceStates(profile, findings) {
  const humanKinds = new Set(["human_accessibility_review", "assistive_technology", "organization_approval"]);
  if (profile.target_formats.includes("pptx")) humanKinds.add("powerpoint_accessibility_checker");
  for (const kind of profile.required_evidence ?? []) humanKinds.add(kind);
  return Object.freeze([
    Object.freeze({ kind: "automated", status: findings.some(({ severity }) => severity === "blocking") ? "failed" : "completed", finding_count: findings.length }),
    ...[...humanKinds].map((kind) => Object.freeze({ kind, status: "pending" })),
    Object.freeze({ kind: "legal_policy_conformance", status: "not_claimed", target: profile.standard_target ?? null })
  ]);
}

function add(findings, page, pageId, rule, severity, message, evidence = {}, verification = "automated") { findings.push(finding(rule, severity, { kind: "page", id: pageId, page: page.page }, message, evidence, verification)); }
function finding(rule, severity, target, message, evidence = {}, verification = "automated") { return Object.freeze({ id: `${rule}-${target.id}`, rule, severity, target: Object.freeze(target), message, verification, evidence: Object.freeze(evidence), remediation: Object.freeze({ kind: "candidate_required", automatically_applied: false }) }); }
function sourceHash(project) {
  const source = { ...(project?.contracts ? { contracts: project.contracts } : {}), project: project?.project, pages: project?.pages, theme: project?.theme, assets: project?.assets };
  return crypto.createHash("sha256").update(stableJson(source)).digest("hex");
}
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function hasText(value) { return typeof value === "string" && value.trim() !== ""; }
function isMeaningfulTitle(value) { return hasText(value) && !/^(untitled|slide|page)(\s+\d+)?$/i.test(value.trim()); }


// Conservative design checks using the WCAG 2.2 sRGB relative-luminance formula.
// A passed pair is evidence for that pair only, never a conformance assertion.
export function contrastRatio(foreground, background) {
  const a = rgb(foreground), b = rgb(background);
  if (!a || !b) return null;
  const luminance = channels => channels.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
function rgb(value) {
  if (typeof value !== "string") return null;
  let hex = value.trim().replace(/^#/, "");
  if (/^[a-f0-9]{3}$/i.test(hex)) hex = hex.split("").map(c => c + c).join("");
  if (/^[a-f0-9]{6}$/i.test(hex)) return [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
  const match = value.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
  return match && match.slice(1).every(value => +value <= 255) ? match.slice(1).map(Number) : null;
}
function validateContrast(findings, page, pageId, project) {
  const colors = resolveTheme(project.theme, project.project.theme_override, page.theme_override).colors;
  const pairs = [{ foreground: colors.text, background: colors.background, role: "theme-text", minimum: 4.5 }];
  if (page.screen_text?.subtitle || page.diagram) pairs.push({ foreground: colors.accent, background: colors.background, role: "accent-text-or-diagram", minimum: 4.5 });
  for (const pair of [...pairs, ...(page.accessibility?.contrast_samples ?? [])]) {
    const ratio = contrastRatio(pair.foreground, pair.background);
    const minimum = pair.minimum ?? 4.5;
    if (ratio === null) add(findings, page, pageId, "contrast-unresolved", "major", "A color expression cannot be resolved automatically.", pair, "human_required");
    else if (ratio < minimum) add(findings, page, pageId, "resolved-theme-contrast", "major", `${pair.role ?? "Declared region"} contrast is ${ratio.toFixed(2)}:1; review against the ${minimum}:1 design threshold.`, { ...pair, ratio });
  }
}

export function assertAccessibleTextCapacity(project) {
  const profile = project.project?.accessibility_profile;
  if (!profile) return;
  const errors = validateAccessibilityProfile(profile);
  for (const page of project.pages) if (page.accessibility?.language !== undefined && !/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(page.accessibility.language)) errors.push(`page ${page.page} has an invalid language tag`);
  if (errors.length) throw Object.assign(new Error(errors.join("; ")), { code: "ACCESSIBILITY_PROFILE_INVALID" });
  if ((profile.text_scale ?? 1) <= 1) return;
  const findings = [];
  for (const page of project.pages) validateTextCapacity(findings, page, page.id ?? String(page.page), profile.text_scale);
  if (findings.length) throw Object.assign(new Error("Text exceeds the declared accessibility scale; revise content or layout before building."), { code: "ACCESSIBILITY_TEXT_OVERFLOW", findings });
}
