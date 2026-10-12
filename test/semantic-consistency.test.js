import assert from "node:assert/strict";
import test from "node:test";
import { validateSemanticRegistry } from "../src/semantic-consistency/registry.js";
import { validateSemanticBindings } from "../src/semantic-consistency/bindings.js";

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

test("Stage 2 binds format-specific locators to stable semantic IDs", () => {
  const { registry } = validateSemanticRegistry(registryInput());
  const manifest = validateSemanticBindings(registry, [
    { id: "deck", role: "presentation", format: "pptx", file: "hazards.pptx", bindings: [{ id: "deck-lo1", entity_id: "lo.hazard-identification", entity_revision: 1, locator: { kind: "slide", number: 3 }, observed_text: "Identify hazards before work begins" }] },
    { id: "guide", role: "learner_guide", format: "docx", file: "guide.docx", bindings: [{ id: "guide-risk", entity_id: "risk.high", entity_revision: 2, locator: { kind: "word_page", number: 7 }, observed_text: "Stop work and report immediately" }] },
    { id: "alignment", role: "alignment_report", format: "pdf", file: "alignment.pdf", bindings: [{ id: "alignment-lo1", entity_id: "lo.hazard-identification", entity_revision: 1, locator: { kind: "pdf_page", number: 2 }, observed_text: "Identify hazards before work begins" }] }
  ]);
  assert.match(manifest.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(manifest.artifacts.map((artifact) => artifact.bindings[0].locator.kind), ["slide", "word_page", "pdf_page"]);
  assert.throws(() => validateSemanticBindings(registry, [{ id: "deck", role: "presentation", format: "pptx", bindings: [{ entity_id: "lo.hazard-identification", entity_revision: 1, locator: { kind: "pdf_page", number: 1 }, observed_text: "wrong locator" }] }]), { code: "SEMANTIC_LOCATOR_INVALID" });
  assert.throws(() => validateSemanticBindings(registry, [{ id: "deck", role: "presentation", format: "pptx", bindings: [{ entity_id: "missing", entity_revision: 1, locator: { kind: "slide", number: 1 }, observed_text: "unknown" }] }]), { code: "SEMANTIC_ENTITY_UNKNOWN" });
});
