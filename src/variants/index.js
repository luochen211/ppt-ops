import fs from "node:fs/promises";
import path from "node:path";
import { DELIVERY_MODES } from "../contracts/delivery.js";
import { resolveProjectPath } from "../core/project.js";

export const AUDIENCE_VARIANT_VERSION = "1.0";
export const AUDIENCE_VARIANTS_FILE = "variants.json";

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const FORBIDDEN_PATCH_FIELDS = new Set(["contract_version", "kind", "id", "page"]);

export class AudienceVariantError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export async function loadAudienceVariants(projectRoot, base) {
  const file = resolveProjectPath(projectRoot, AUDIENCE_VARIANTS_FILE);
  try {
    const manifest = JSON.parse(await fs.readFile(file, "utf8"));
    assertAudienceVariantManifest(manifest, base);
    return { manifest, file, implicit: false };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return {
      manifest: { schema_version: AUDIENCE_VARIANT_VERSION, variants: [implicitDefaultVariant(base)] },
      file,
      implicit: true
    };
  }
}

export function implicitDefaultVariant(base, baseRevision = "current-draft") {
  assertBase(base);
  return {
    id: "default",
    title: base.project.title,
    audience: "existing project audience",
    purpose: "preserve existing single-deck behavior",
    base: { project_id: base.project.id, revision: baseRevision },
    page_ids: base.pages.map(({ id }) => id),
    page_overrides: [],
    section_overrides: []
  };
}

export function assertAudienceVariantManifest(manifest, base) {
  assertBase(base);
  const errors = validateAudienceVariantManifest(manifest, base);
  if (errors.length) throw new AudienceVariantError("AUDIENCE_VARIANTS_INVALID", "audience variant manifest is invalid", { errors });
  return manifest;
}

export function validateAudienceVariantManifest(manifest, base) {
  const errors = [];
  if (!isObject(manifest)) return ["manifest must be an object"];
  if (manifest.schema_version !== AUDIENCE_VARIANT_VERSION) errors.push("schema_version must be 1.0");
  if (!Array.isArray(manifest.variants) || manifest.variants.length === 0) return [...errors, "variants must be a non-empty array"];
  const basePageIds = new Set(base?.pages?.map(({ id }) => id) ?? []);
  const baseSectionIds = new Set(base?.outline?.sections?.map(({ id }) => id) ?? []);
  const ids = new Set();
  for (const [index, variant] of manifest.variants.entries()) {
    const prefix = `variants[${index}]`;
    if (!isObject(variant)) { errors.push(`${prefix} must be an object`); continue; }
    if (!isId(variant.id)) errors.push(`${prefix}.id must be a stable lowercase identifier`);
    else if (ids.has(variant.id)) errors.push(`${prefix}.id is duplicated: ${variant.id}`);
    else ids.add(variant.id);
    for (const field of ["title", "audience", "purpose"]) if (!hasText(variant[field])) errors.push(`${prefix}.${field} is required`);
    if (!isObject(variant.base) || variant.base.project_id !== base?.project?.id || !hasText(variant.base.revision)) errors.push(`${prefix}.base must reference this project and a revision`);
    if (variant.expected_duration_seconds !== undefined && (!Number.isInteger(variant.expected_duration_seconds) || variant.expected_duration_seconds < 1)) errors.push(`${prefix}.expected_duration_seconds must be a positive integer`);
    if (variant.delivery_mode !== undefined && !DELIVERY_MODES.includes(variant.delivery_mode)) errors.push(`${prefix}.delivery_mode is invalid: ${variant.delivery_mode}`);
    if (variant.archived !== undefined && typeof variant.archived !== "boolean") errors.push(`${prefix}.archived must be a boolean`);
    const pageIds = variant.page_ids;
    if (!Array.isArray(pageIds) || pageIds.length === 0) errors.push(`${prefix}.page_ids must be a non-empty array`);
    else {
      if (new Set(pageIds).size !== pageIds.length) errors.push(`${prefix}.page_ids must be unique`);
      for (const pageId of pageIds) if (!basePageIds.has(pageId)) errors.push(`${prefix}.page_ids references missing page: ${pageId}`);
    }
    validatePageOverrides(variant.page_overrides, pageIds ?? [], basePageIds, prefix, errors);
    validateSectionOverrides(variant.section_overrides, baseSectionIds, prefix, errors);
  }
  return errors;
}

export function resolveAudienceVariant(base, variant) {
  assertAudienceVariantManifest({ schema_version: AUDIENCE_VARIANT_VERSION, variants: [variant] }, base);
  const original = structuredClone(base);
  const overrides = new Map((variant.page_overrides ?? []).map(({ page_id, patch }) => [page_id, patch]));
  const basePages = new Map(base.pages.map((page) => [page.id, page]));
  const pages = variant.page_ids.map((pageId, index) => {
    const page = deepMerge(basePages.get(pageId), overrides.get(pageId) ?? {});
    return { ...page, page: index + 1 };
  });
  const selected = new Set(variant.page_ids);
  const order = new Map(variant.page_ids.map((id, index) => [id, index]));
  const sectionOverrides = new Map((variant.section_overrides ?? []).map((override) => [override.section_id, override]));
  const sections = base.outline.sections.map((section) => {
    const override = sectionOverrides.get(section.id);
    const pageIds = section.page_ids.filter((id) => selected.has(id)).sort((left, right) => order.get(left) - order.get(right));
    return { ...structuredClone(section), ...(override?.title ? { title: override.title } : {}), page_ids: pageIds };
  }).filter(({ page_ids }) => page_ids.length > 0)
    .sort((left, right) => order.get(left.page_ids[0]) - order.get(right.page_ids[0]));
  return {
    project: {
      ...structuredClone(base.project),
      ...(variant.delivery_mode ? { delivery_mode: variant.delivery_mode } : {}),
      variant_id: variant.id,
      variant_title: variant.title,
      audience: variant.audience,
      purpose: variant.purpose,
      ...(variant.expected_duration_seconds ? { expected_duration_seconds: variant.expected_duration_seconds } : {})
    },
    outline: { ...structuredClone(base.outline), sections },
    pages,
    inheritance: {
      variant_id: variant.id,
      base_project_id: variant.base.project_id,
      base_revision: variant.base.revision,
      inherited_page_ids: variant.page_ids.filter((id) => !overrides.has(id)),
      overridden_page_ids: [...overrides.keys()]
    },
    unchanged_base: stableJson(base) === stableJson(original)
  };
}

export function reportAudienceVariantImpact(before, after, manifest, options = {}) {
  assertBase(before); assertBase(after);
  if (before.project.id !== after.project.id) throw new AudienceVariantError("AUDIENCE_VARIANT_BASE_MISMATCH", "impact comparison requires the same base project");
  assertAudienceVariantManifest(manifest, before);
  const beforePages = new Map(before.pages.map((page) => [page.id, page]));
  const afterPages = new Map(after.pages.map((page) => [page.id, page]));
  const allIds = [...new Set([...beforePages.keys(), ...afterPages.keys()])];
  const changed = new Set(allIds.filter((id) => stableJson(beforePages.get(id)) !== stableJson(afterPages.get(id))));
  const frozen = new Set(options.frozen_variant_ids ?? []);
  return {
    base_project_id: before.project.id,
    changed_page_ids: [...changed],
    variants: manifest.variants.map((variant) => {
      const overrides = new Map((variant.page_overrides ?? []).map(({ page_id, patch }) => [page_id, patch]));
      const affected = variant.page_ids.filter((id) => changed.has(id));
      const pageImpacts = affected.map((pageId) => {
        const changedFields = changedLeafFields(beforePages.get(pageId), afterPages.get(pageId));
        const overrideFields = patchLeafFields(overrides.get(pageId) ?? {});
        const covered = field => overrideFields.some(override => field === override || field.startsWith(`${override}.`));
        return {
          page_id: pageId,
          changed_fields: changedFields,
          override_fields: overrideFields,
          inherited_changed_fields: changedFields.filter(field => !covered(field)),
          overridden_changed_fields: changedFields.filter(covered)
        };
      });
      return {
        variant_id: variant.id,
        affected_page_ids: affected,
        inherited_page_ids: pageImpacts.filter(({ inherited_changed_fields }) => inherited_changed_fields.length > 0).map(({ page_id }) => page_id),
        overridden_page_ids: affected.filter((id) => overrides.has(id)),
        page_impacts: pageImpacts,
        stale_frozen_output: frozen.has(variant.id) && affected.length > 0,
        requires_explicit_adoption: affected.length > 0
      };
    })
  };
}

export function compareAudienceVariants(base, left, right) {
  const a = resolveAudienceVariant(base, left);
  const b = resolveAudienceVariant(base, right);
  const aPages = new Map(a.pages.map((page) => [page.id, page]));
  const bPages = new Map(b.pages.map((page) => [page.id, page]));
  const common = [...aPages.keys()].filter((id) => bPages.has(id));
  return {
    left_variant_id: left.id,
    right_variant_id: right.id,
    added_page_ids: [...bPages.keys()].filter((id) => !aPages.has(id)),
    removed_page_ids: [...aPages.keys()].filter((id) => !bPages.has(id)),
    changed_page_ids: common.filter((id) => stableJson(aPages.get(id)) !== stableJson(bPages.get(id))),
    shared_page_ids: common.filter((id) => stableJson(aPages.get(id)) === stableJson(bPages.get(id)))
  };
}

function validatePageOverrides(value, pageIds, basePageIds, prefix, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value)) { errors.push(`${prefix}.page_overrides must be an array`); return; }
  const seen = new Set();
  for (const [index, override] of value.entries()) {
    const field = `${prefix}.page_overrides[${index}]`;
    if (!isObject(override) || !isId(override.page_id) || !isObject(override.patch)) { errors.push(`${field} requires page_id and patch`); continue; }
    if (seen.has(override.page_id)) errors.push(`${field}.page_id is duplicated: ${override.page_id}`);
    seen.add(override.page_id);
    if (!basePageIds.has(override.page_id) || !pageIds.includes(override.page_id)) errors.push(`${field}.page_id must reference a selected base page`);
    for (const key of Object.keys(override.patch)) if (FORBIDDEN_PATCH_FIELDS.has(key)) errors.push(`${field}.patch cannot change ${key}`);
  }
}

function validateSectionOverrides(value, baseSectionIds, prefix, errors) {
  if (value === undefined) return;
  if (!Array.isArray(value)) { errors.push(`${prefix}.section_overrides must be an array`); return; }
  const seen = new Set();
  for (const [index, override] of value.entries()) {
    const field = `${prefix}.section_overrides[${index}]`;
    if (!isObject(override) || !isId(override.section_id) || !hasText(override.title)) { errors.push(`${field} requires section_id and title`); continue; }
    if (!baseSectionIds.has(override.section_id)) errors.push(`${field}.section_id references a missing section`);
    if (seen.has(override.section_id)) errors.push(`${field}.section_id is duplicated: ${override.section_id}`);
    seen.add(override.section_id);
  }
}

function assertBase(base) {
  if (!isObject(base?.project) || !isId(base.project.id) || !isObject(base?.outline) || !Array.isArray(base?.outline?.sections) || !Array.isArray(base?.pages)) {
    throw new AudienceVariantError("AUDIENCE_VARIANT_BASE_INVALID", "base requires a V1 project, outline, and pages");
  }
}

function deepMerge(base, patch) {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(patch)) result[key] = isObject(value) && isObject(result[key]) ? deepMerge(result[key], value) : structuredClone(value);
  return result;
}
function changedLeafFields(before, after, prefix = "") {
  if (stableJson(before) === stableJson(after)) return [];
  if (!isObject(before) || !isObject(after)) return [prefix || (before === undefined ? "$added" : "$removed")];
  const fields = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return fields.flatMap(field => changedLeafFields(before[field], after[field], prefix ? `${prefix}.${field}` : field));
}
function patchLeafFields(patch, prefix = "") {
  if (!isObject(patch)) return [prefix];
  return Object.entries(patch).flatMap(([key, value]) => patchLeafFields(value, prefix ? `${prefix}.${key}` : key));
}
function stableJson(value) {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function isId(value) { return typeof value === "string" && ID_PATTERN.test(value); }
function hasText(value) { return typeof value === "string" && value.trim() !== ""; }
