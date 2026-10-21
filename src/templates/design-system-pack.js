const REQUIRED_GROUPS = ["colors", "typography", "spacing"];

export function normalizeDesignSystemPack(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw packError("DESIGN_PACK_INVALID", "pack must be an object");
  if (input.kind !== "design_system_pack") throw packError("DESIGN_PACK_INVALID", "kind must be design_system_pack");
  if (!hasText(input.id) || !hasText(input.name)) throw packError("DESIGN_PACK_INVALID", "id and name are required");
  const tokens = input.tokens ?? {};
  for (const group of REQUIRED_GROUPS) if (!tokens[group] || typeof tokens[group] !== "object") throw packError("DESIGN_PACK_INVALID", `tokens.${group} is required`);
  for (const field of ["components", "layouts", "assets"]) if (!Array.isArray(input[field])) throw packError("DESIGN_PACK_INVALID", `${field} must be an array`);
  return structuredClone({ contract_version: input.contract_version ?? "1.0", ...input });
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
      resources.set(entry.id, Object.freeze({ kind, ...structuredClone(entry) }));
    }
  }
  for (const relationship of pack.relationships ?? []) {
    for (const endpoint of [relationship.from, relationship.to]) if (!resources.has(endpoint)) throw packError("DESIGN_PACK_RESOURCE_MISSING", `relationship resource not found: ${endpoint}`);
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

