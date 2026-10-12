import assert from "node:assert/strict";
import test from "node:test";
import { validateSemanticRegistry } from "../src/semantic-consistency/registry.js";
import { validateSemanticBindings } from "../src/semantic-consistency/bindings.js";
import { checkSemanticConsistency } from "../src/semantic-consistency/check.js";

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

test("Stage 3 reports conflict, omission, location, original text, and expected value", () => {
  const { registry } = validateSemanticRegistry(registryInput());
  const manifest = validateSemanticBindings(registry, [
    { id: "deck", role: "presentation", format: "pptx", bindings: [{ entity_id: "risk.high", entity_revision: 2, locator: { kind: "slide", number: 5 }, observed_text: "Stop work and report immediately" }] },
    { id: "guide", role: "learner_guide", format: "docx", bindings: [{ entity_id: "risk.high", entity_revision: 1, locator: { kind: "section", id: "risk-table" }, observed_text: "Report when practical" }] }
  ]);
  const report = checkSemanticConsistency(registry, manifest, [{ entity_id: "risk.high", required_roles: ["presentation", "learner_guide", "assessment"] }]);
  assert.equal(report.passed, false);
  assert.equal(report.automated_resolution, false);
  assert.deepEqual(report.findings.map((item) => item.code), ["SEMANTIC_BINDING_MISSING", "SEMANTIC_BINDING_STALE", "SEMANTIC_ONE_TO_MANY_CONFLICT", "SEMANTIC_VALUE_MISMATCH"]);
  const mismatch = report.findings.find((item) => item.code === "SEMANTIC_VALUE_MISMATCH");
  assert.deepEqual(mismatch.locator, { kind: "section", id: "risk-table" });
  assert.equal(mismatch.observed, "Report when practical");
  assert.equal(mismatch.expected, "Stop work and report immediately");
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
