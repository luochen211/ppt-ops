import assert from "node:assert/strict";
import test from "node:test";
import { validateSemanticRegistry } from "../src/semantic-consistency/registry.js";

const registryInput = () => ({ contract_version: "1.0", entities: [
  { id: "lo.hazard-identification", type: "learning_objective", revision: 1, canonical_value: "Identify hazards before work begins", authority: { source_id: "curriculum-approved", locator: "LO-1" } },
  { id: "risk.high", type: "risk_level", revision: 2, canonical_value: "Stop work and report immediately", authority: { source_id: "policy-approved", locator: "risk-table:high" }, observed_variants: ["Report when practical"] }
] });

test("Stage 1 validates stable shared semantics without resolving conflicts", () => {
  const result = validateSemanticRegistry(registryInput());
  assert.deepEqual(result.registry.entities.map((entity) => entity.id), ["lo.hazard-identification", "risk.high"]);
  assert.match(result.registry.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.findings, [{ code: "SEMANTIC_VARIANT_CONFLICT", severity: "blocking", entity_id: "risk.high", observed: "Report when practical", expected: "Stop work and report immediately", resolution: "human_required" }]);
  assert.throws(() => validateSemanticRegistry({ contract_version: "1.0", entities: [{ ...registryInput().entities[0], authority: null }] }), { code: "SEMANTIC_AUTHORITY_REQUIRED" });
  assert.throws(() => validateSemanticRegistry({ contract_version: "1.0", entities: [registryInput().entities[0], registryInput().entities[0]] }), { code: "SEMANTIC_ENTITY_DUPLICATE" });
});
