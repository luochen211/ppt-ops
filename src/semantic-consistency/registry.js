import crypto from "node:crypto";

const TYPES = new Set(["learning_objective", "glossary_term", "controlled_action", "risk_level", "numbering_definition"]);

export function validateSemanticRegistry(input) {
  if (!input || input.contract_version !== "1.0" || !Array.isArray(input.entities)) throw coded("SEMANTIC_REGISTRY_INVALID", "semantic registry contract_version 1.0 and entities are required");
  const seen = new Set(), findings = [];
  const entities = input.entities.map((entity, index) => {
    if (!entity || typeof entity.id !== "string" || !/^[a-z][a-z0-9._-]*$/.test(entity.id)) throw coded("SEMANTIC_ENTITY_ID_INVALID", `entities[${index}].id must be a stable lowercase identifier`);
    if (seen.has(entity.id)) throw coded("SEMANTIC_ENTITY_DUPLICATE", `duplicate semantic entity: ${entity.id}`);
    seen.add(entity.id);
    if (!TYPES.has(entity.type)) throw coded("SEMANTIC_ENTITY_TYPE_INVALID", `unsupported semantic entity type: ${entity.type}`);
    if (!Number.isInteger(entity.revision) || entity.revision < 1) throw coded("SEMANTIC_ENTITY_REVISION_INVALID", `${entity.id} requires a positive revision`);
    if (typeof entity.canonical_value !== "string" || !entity.canonical_value.trim()) throw coded("SEMANTIC_CANONICAL_VALUE_REQUIRED", `${entity.id} requires a canonical value`);
    if (!entity.authority || typeof entity.authority.source_id !== "string" || typeof entity.authority.locator !== "string" || !entity.authority.source_id || !entity.authority.locator) throw coded("SEMANTIC_AUTHORITY_REQUIRED", `${entity.id} requires source authority and locator`);
    const variants = [...new Set((entity.observed_variants ?? []).map((value) => String(value).trim()).filter(Boolean))].sort();
    for (const value of variants.filter((value) => value !== entity.canonical_value.trim())) findings.push({ code: "SEMANTIC_VARIANT_CONFLICT", severity: "blocking", entity_id: entity.id, observed: value, expected: entity.canonical_value.trim(), resolution: "human_required" });
    return { id: entity.id, type: entity.type, revision: entity.revision, canonical_value: entity.canonical_value.trim(), authority: { source_id: entity.authority.source_id, locator: entity.authority.locator }, variants };
  });
  const registry = { contract_version: "1.0", kind: "semantic_registry", entities: entities.sort((left, right) => left.id.localeCompare(right.id)) };
  return { registry: { ...registry, sha256: hash(registry) }, findings };
}

export function semanticEntity(registry, id) { return registry.entities.find((entity) => entity.id === id) ?? null; }
function hash(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function coded(code, message) { return Object.assign(new Error(message), { code }); }
