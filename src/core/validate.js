import { validateV1Bundle } from "../contracts/v1.js";

const RELATIONS = new Set(["sequence", "parallel", "cause_effect", "before_after", "hierarchy", "process", "cycle", "comparison", "hero"]);
const STATUSES = new Set(["draft", "prototype", "approved", "built", "reviewed"]);
const ASSET_TYPES = new Set(["image", "icon", "video", "data"]);
const OUTPUTS = new Set(["html", "pptx", "pdf", "png"]);
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const SCHEMA_VERSIONS = new Set(["0.1", "1.0"]);

export function validatePage(page, assetIds = new Set()) {
  const errors = [];
  if (!page || typeof page !== "object" || Array.isArray(page)) return ["page spec must be an object"];
  if (!Number.isInteger(page.page) || page.page < 1) errors.push("page must be a positive integer");
  for (const field of ["task", "three_second_message", "visual_job"]) requireText(page, field, errors);
  if (page.source !== undefined && !hasText(page.source)) errors.push("source must be a non-empty string");
  if (!RELATIONS.has(page.relation)) errors.push(`relation is invalid: ${page.relation}`);
  if (!page.screen_text || typeof page.screen_text !== "object") {
    errors.push("screen_text.title is required");
  } else {
    if (!hasText(page.screen_text.title)) errors.push("screen_text.title is required");
    if (page.screen_text.body !== undefined && (!Array.isArray(page.screen_text.body) || page.screen_text.body.some((line) => !hasText(line)))) errors.push("screen_text.body must contain non-empty strings");
  }
  if (!Array.isArray(page.asset_slots)) {
    errors.push("asset_slots must be an array");
  } else {
    page.asset_slots.forEach((slot, index) => {
      if (!slot || typeof slot !== "object" || !hasText(slot.role)) errors.push(`asset_slots[${index}].role is required`);
      if (!slot || !hasText(slot.asset_id)) errors.push(`asset_slots[${index}].asset_id is required`);
      else if (!assetIds.has(slot.asset_id)) errors.push(`asset_slots[${index}].asset_id is unknown: ${slot.asset_id}`);
      if (slot?.fit !== undefined && !["cover", "contain"].includes(slot.fit)) errors.push(`asset_slots[${index}].fit is invalid: ${slot.fit}`);
    });
  }
  if (!STATUSES.has(page.status)) errors.push(`status is invalid: ${page.status}`);
  return errors;
}

export function validateProject(loaded) {
  const errors = [];
  if (loaded.contractModel === "v1") {
    for (const error of validateV1Bundle({ ...loaded.contracts, candidates: [], approvals: [], versions: [], builds: [], reviews: [], handoffs: [] })) errors.push(`v1: ${error}`);
  }
  const project = loaded.project;
  if (!project || typeof project !== "object") return ["project manifest is required"];
  if (!SCHEMA_VERSIONS.has(project.schema_version)) errors.push("project.schema_version must be 0.1 or 1.0");
  if (!hasText(project.name)) errors.push("project.name is required");
  else if (!ID_PATTERN.test(project.name)) errors.push("project.name must be a stable lowercase identifier");
  if (!hasText(project.title)) errors.push("project.title is required");
  if (project.format !== "16:9") errors.push("project.format must be 16:9");
  validateUniqueTextList(project.source_files, "project.source_files", errors, true);
  if (!hasText(project.theme_file)) errors.push("project.theme_file is required");
  if (!hasText(project.assets_file)) errors.push("project.assets_file is required");
  validateEnumList(project.outputs, "project.outputs", OUTPUTS, errors);

  for (const error of validateTheme(loaded.theme)) errors.push(`theme: ${error}`);
  const assetIds = validateAssets(loaded.assets, errors);
  if (!Array.isArray(loaded.pages) || loaded.pages.length === 0) errors.push("pages must not be empty");
  const numbers = new Set();
  let previousPage = 0;
  for (const page of loaded.pages ?? []) {
    for (const error of validatePage(page, assetIds)) errors.push(`page ${page?.page ?? "?"}: ${error}`);
    if (numbers.has(page?.page)) errors.push(`duplicate page number: ${page.page}`);
    numbers.add(page?.page);
    if (Number.isInteger(page?.page) && page.page < previousPage) errors.push(`pages must be ordered by page number: ${page.page} follows ${previousPage}`);
    if (Number.isInteger(page?.page)) previousPage = page.page;
    const sourceFile = typeof page?.source === "string" ? page.source.split("#", 1)[0] : undefined;
    if (sourceFile && !project.source_files?.includes(sourceFile)) errors.push(`page ${page.page ?? "?"}: source is not declared in project.source_files: ${sourceFile}`);
  }
  for (const reference of loaded.referencedFiles ?? []) if (!reference.exists) errors.push(`missing ${reference.kind} file${reference.id ? ` for ${reference.id}` : ""}: ${reference.file}`);
  return errors;
}

export function validateTheme(theme) {
  const errors = [];
  if (!theme || typeof theme !== "object" || Array.isArray(theme)) return ["theme object is required"];
  for (const field of ["width", "height"]) if (!(theme.dimensions?.[field] > 0)) errors.push(`dimensions.${field} must be positive`);
  for (const field of ["heading_font", "body_font"]) if (!hasText(theme.typography?.[field])) errors.push(`typography.${field} is required`);
  for (const field of ["background", "text", "accent"]) if (!COLOR_PATTERN.test(theme.colors?.[field] ?? "")) errors.push(`colors.${field} must be a six-digit hex color`);
  if (!(theme.spacing?.unit > 0)) errors.push("spacing.unit must be positive");
  if (!(typeof theme.spacing?.page_margin === "number" && theme.spacing.page_margin >= 0)) errors.push("spacing.page_margin must be non-negative");
  return errors;
}

function validateAssets(assets, errors) {
  const ids = new Set();
  if (!Array.isArray(assets)) { errors.push("assets must be an array"); return ids; }
  assets.forEach((asset, index) => {
    if (!hasText(asset?.id) || !ID_PATTERN.test(asset.id)) errors.push(`assets[${index}].id must be a stable lowercase identifier`);
    else if (ids.has(asset.id)) errors.push(`duplicate asset id: ${asset.id}`);
    else ids.add(asset.id);
    if (!ASSET_TYPES.has(asset?.type)) errors.push(`assets[${index}].type is invalid: ${asset?.type}`);
    if (!hasText(asset?.file)) errors.push(`assets[${index}].file is required`);
  });
  return ids;
}

function validateUniqueTextList(value, field, errors, requireItems = false) {
  if (!Array.isArray(value) || (requireItems && value.length === 0)) { errors.push(`${field} must be a non-empty array`); return; }
  if (value.some((item) => !hasText(item))) errors.push(`${field} must contain non-empty strings`);
  if (new Set(value).size !== value.length) errors.push(`${field} must not contain duplicates`);
}

function validateEnumList(value, field, allowed, errors) {
  validateUniqueTextList(value, field, errors, true);
  for (const item of Array.isArray(value) ? value : []) if (!allowed.has(item)) errors.push(`${field} contains invalid value: ${item}`);
}

function requireText(object, field, errors) { if (!hasText(object[field])) errors.push(`${field} is required`); }
function hasText(value) { return typeof value === "string" && value.trim() !== ""; }
