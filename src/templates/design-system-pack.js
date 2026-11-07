import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";

const schema = JSON.parse(readFileSync(new URL("../../schemas/v1/design-system-pack.schema.json", import.meta.url), "utf8"));
const validatePack = new Ajv2020({ allErrors: true }).compile(schema);

export function normalizeDesignSystemPack(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw packError("DESIGN_PACK_INVALID", "pack must be an object");
  // Only an absent version receives the legacy default. Explicit invalid values
  // (including null and undefined) must not silently become a supported version.
  if (Object.hasOwn(input, "contract_version") && input.contract_version !== "1.0") throw packError("DESIGN_PACK_INVALID", "contract_version must be 1.0");
  const pack = { ...input, contract_version: "1.0" };
  if (!validatePack(pack)) {
    const details = validatePack.errors.map((error) => `${error.instancePath || "/"}: ${error.message}`).join("; ");
    throw packError("DESIGN_PACK_INVALID", details);
  }
  return structuredClone(pack);
}

export function migrateLegacyTemplate(template) {
  if (!template || typeof template !== "object") throw packError("LEGACY_TEMPLATE_INVALID", "legacy template must be an object");
  const reference = template.reference_image ?? template.reference ?? template.image;
  if (!hasText(template.id) || !hasText(template.name) || !hasText(reference)) throw packError("LEGACY_TEMPLATE_INVALID", "legacy id, name and reference image are required");
  return normalizeDesignSystemPack({
    contract_version: "1.0", kind: "design_system_pack", id: `design-pack-${template.id}`, name: template.name,
    tokens: { colors: {}, typography: {}, spacing: {} }, components: [], layouts: [],
    assets: [{ id: `asset-${template.id}-reference`, type: "reference", source: reference }],
    relationships: [], migration: { status: "legacy-reference-only", source_template_id: template.id, requires_review: true }
  });
}

export function indexDesignSystemPack(input) {
  const pack = normalizeDesignSystemPack(input);
  const resources = new Map();
  for (const [kind, entries] of [["component", pack.components], ["layout", pack.layouts], ["asset", pack.assets]]) {
    for (const entry of entries) {
      if (!hasText(entry.id)) throw packError("DESIGN_PACK_RESOURCE_ID_MISSING", `${kind} id is required`);
      if (resources.has(entry.id)) throw packError("DESIGN_PACK_RESOURCE_DUPLICATE", `duplicate resource id: ${entry.id}`);
      if (Object.hasOwn(entry, "kind") && entry.kind !== kind) throw packError("DESIGN_PACK_RESOURCE_INCOMPATIBLE", `${entry.id} belongs to ${kind}, not ${entry.kind}`);
      resources.set(entry.id, Object.freeze({ ...structuredClone(entry), kind }));
    }
  }
  for (const relationship of pack.relationships ?? []) {
    for (const endpoint of ["from", "to"]) {
      resolveDesignSystemResource({ resources }, relationship[endpoint], relationship[`${endpoint}_kind`]);
    }
  }
  const assetTypes = new Set(pack.assets.map(({ type }) => type));
  return Object.freeze({ pack: Object.freeze(pack), resources, metrics: Object.freeze({ layouts: pack.layouts.length, asset_types: assetTypes.size }) });
}

export function resolveDesignSystemResource(index, id, expectedKind) {
  const resource = index?.resources?.get(id);
  if (!resource) throw packError("DESIGN_PACK_RESOURCE_MISSING", `resource not found: ${id}`);
  if (expectedKind && resource.kind !== expectedKind) throw packError("DESIGN_PACK_RESOURCE_INCOMPATIBLE", `${id} is ${resource.kind}, expected ${expectedKind}`);
  return resource;
}

function hasText(value) { return typeof value === "string" && value.trim().length > 0; }
function packError(code, message) { return Object.assign(new Error(message), { code }); }
