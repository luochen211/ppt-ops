import { semanticEntity } from "./registry.js";

export function checkSemanticConsistency(registry, manifest, requirements = []) {
  const findings = [];
  const all = manifest.artifacts.flatMap((artifact) => artifact.bindings.map((binding) => ({ artifact, binding })));
  for (const { artifact, binding } of all) {
    const entity = semanticEntity(registry, binding.entity_id);
    if (!entity) {
      findings.push(finding("SEMANTIC_ENTITY_UNKNOWN", "blocking", artifact, binding, null));
      continue;
    }
    if (binding.entity_revision !== entity.revision) findings.push(finding("SEMANTIC_BINDING_STALE", "blocking", artifact, binding, entity, { observed_revision: binding.entity_revision, expected_revision: entity.revision }));
    if (normalize(binding.observed_text) !== normalize(entity.canonical_value)) findings.push(finding("SEMANTIC_VALUE_MISMATCH", "blocking", artifact, binding, entity));
  }
  for (const entity of registry.entities.filter((item) => ["controlled_action", "risk_level"].includes(item.type))) {
    const refs = all.filter(({ binding }) => binding.entity_id === entity.id), values = [...new Set(refs.map(({ binding }) => normalize(binding.observed_text)))];
    if (values.length > 1) findings.push({ code: "SEMANTIC_ONE_TO_MANY_CONFLICT", severity: "blocking", entity_id: entity.id, expected: entity.canonical_value, observed_values: values.sort(), locations: refs.map(({ artifact, binding }) => location(artifact, binding)), resolution: "human_required" });
  }
  for (const requirement of requirements) {
    const entity = semanticEntity(registry, requirement.entity_id);
    if (!entity) throw coded("SEMANTIC_REQUIREMENT_INVALID", `unknown required semantic entity: ${requirement.entity_id}`);
    for (const role of [...new Set(requirement.required_roles ?? [])].sort()) if (!all.some(({ artifact, binding }) => artifact.role === role && binding.entity_id === entity.id)) findings.push({ code: "SEMANTIC_BINDING_MISSING", severity: "blocking", entity_id: entity.id, artifact_role: role, observed: null, expected: entity.canonical_value, resolution: "human_required" });
  }
  return { contract_version: "1.0", kind: "semantic_consistency_report", registry_sha256: registry.sha256, manifest_sha256: manifest.sha256, passed: findings.length === 0, findings: findings.sort(orderFinding), automated_resolution: false };
}
function finding(code, severity, artifact, binding, entity, extra = {}) { return { code, severity, entity_id: binding.entity_id, artifact_id: artifact.id, artifact_role: artifact.role, format: artifact.format, locator: binding.locator, observed: binding.observed_text, expected: entity?.canonical_value ?? null, resolution: "human_required", ...extra }; }
function location(artifact, binding) { return { artifact_id: artifact.id, artifact_role: artifact.role, format: artifact.format, locator: binding.locator, original_text: binding.observed_text }; }
function normalize(value) { return String(value).trim().replace(/\s+/g, " ").toLocaleLowerCase("en"); }
function orderFinding(left, right) { return `${left.code}:${left.entity_id}:${left.artifact_id ?? left.artifact_role ?? ""}`.localeCompare(`${right.code}:${right.entity_id}:${right.artifact_id ?? right.artifact_role ?? ""}`); }
function coded(code, message) { return Object.assign(new Error(message), { code }); }
