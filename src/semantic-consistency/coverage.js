import { semanticEntity } from "./registry.js";

const COVERAGE = Object.freeze({ slide_binding_ids: "presentation", guide_binding_ids: "learner_guide", assessment_binding_ids: "assessment", alignment_binding_ids: "alignment_report" });

export function analyzeLearningCoverage(registry, manifest, mappings) {
  if (!Array.isArray(mappings)) throw coded("SEMANTIC_COVERAGE_INVALID", "coverage mappings are required");
  const bindings = new Map(manifest.artifacts.flatMap((artifact) => artifact.bindings.map((binding) => [binding.id, { artifact, binding }]))), used = new Map(), findings = [];
  for (const mapping of mappings) {
    const objective = semanticEntity(registry, mapping.objective_id);
    if (!objective || objective.type !== "learning_objective") throw coded("SEMANTIC_OBJECTIVE_INVALID", `unknown learning objective: ${mapping.objective_id}`);
    for (const [field, role] of Object.entries(COVERAGE)) {
      const ids = [...new Set(mapping[field] ?? [])];
      if (!ids.length) findings.push({ code: "SEMANTIC_COVERAGE_MISSING", severity: "blocking", objective_id: objective.id, artifact_role: role, resolution: "human_required" });
      for (const id of ids) {
        const ref = bindings.get(id);
        if (!ref || ref.artifact.role !== role || ref.binding.entity_id !== objective.id) findings.push({ code: "SEMANTIC_COVERAGE_REFERENCE_INVALID", severity: "blocking", objective_id: objective.id, artifact_role: role, binding_id: id, resolution: "human_required" });
        const earlier = used.get(id);
        if (earlier && earlier !== objective.id) findings.push({ code: "SEMANTIC_COVERAGE_ONE_TO_MANY", severity: "blocking", binding_id: id, objective_ids: [earlier, objective.id].sort(), resolution: "human_required" });
        else used.set(id, objective.id);
      }
    }
  }
  return { contract_version: "1.0", kind: "learning_objective_coverage", passed: findings.length === 0, mappings: structuredClone(mappings), findings: findings.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))), human_acceptance: "pending" };
}

export function analyzeSemanticImpact(previousRegistry, currentRegistry, manifest) {
  const changes = [];
  for (const current of currentRegistry.entities) {
    const previous = semanticEntity(previousRegistry, current.id);
    if (!previous || previous.revision !== current.revision || previous.canonical_value !== current.canonical_value) changes.push({ entity_id: current.id, previous_revision: previous?.revision ?? null, current_revision: current.revision, previous_value: previous?.canonical_value ?? null, current_value: current.canonical_value });
  }
  const impacts = changes.flatMap((change) => manifest.artifacts.flatMap((artifact) => artifact.bindings.filter((binding) => binding.entity_id === change.entity_id).map((binding) => ({ entity_id: change.entity_id, artifact_id: artifact.id, artifact_role: artifact.role, format: artifact.format, locator: binding.locator, binding_revision: binding.entity_revision, current_revision: change.current_revision, status: binding.entity_revision === change.current_revision ? "current" : "stale" }))));
  return { contract_version: "1.0", kind: "semantic_change_impact", changes, impacts, mutation_performed: false };
}
function coded(code, message) { return Object.assign(new Error(message), { code }); }
