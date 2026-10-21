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

function hasText(value) { return typeof value === "string" && value.trim().length > 0; }
function packError(code, message) { return Object.assign(new Error(message), { code }); }

