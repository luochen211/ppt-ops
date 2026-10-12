import assert from "node:assert/strict";
import test from "node:test";
import { validateSemanticRegistry } from "../src/semantic-consistency/registry.js";
import { validateSemanticBindings } from "../src/semantic-consistency/bindings.js";
import { checkSemanticConsistency } from "../src/semantic-consistency/check.js";
import { analyzeLearningCoverage, analyzeSemanticImpact } from "../src/semantic-consistency/coverage.js";
import { evaluateSemanticDeliveryAcceptance } from "../src/semantic-consistency/acceptance.js";

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

test("Stage 5 keeps synthetic regression evidence separate from human acceptance", () => {
  const manifest = { artifacts: ["presentation", "learner_guide", "assessment", "alignment_report"].map((role, index) => ({ id: `artifact-${index}`, role })) };
  const input = { consistency: { passed: true }, coverage: { passed: true }, manifest, caseEvidence: { kind: "synthetic_fixture", case_id: "hazard-regression", artifact_hashes: [] }, humanAcceptance: { decision: "accepted", actor: "reviewer", role: "Instructional Designer" } };
  assert.throws(() => evaluateSemanticDeliveryAcceptance(input), { code: "SEMANTIC_REAL_CASE_REQUIRED" });
  const accepted = evaluateSemanticDeliveryAcceptance({ ...input, caseEvidence: { kind: "authorized_real_case", case_id: "authorized-hazard-delivery", artifact_hashes: manifest.artifacts.map((artifact, index) => ({ artifact_id: artifact.id, sha256: String(index + 1).repeat(64) })) } });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.automated_check_is_not_human_approval, true);
  assert.equal(accepted.human_acceptance.role, "Instructional Designer");
});

test("Stage 4 traces LO coverage and reports stale artifacts after a shared update", () => {
  const { registry: previous } = validateSemanticRegistry(registryInput());
  const manifest = validateSemanticBindings(previous, [
    { id: "deck", role: "presentation", format: "pptx", bindings: [{ id: "deck-lo", entity_id: "lo.hazard-identification", entity_revision: 1, locator: { kind: "slide", number: 3 }, observed_text: "Identify hazards before work begins" }] },
    { id: "guide", role: "learner_guide", format: "docx", bindings: [{ id: "guide-lo", entity_id: "lo.hazard-identification", entity_revision: 1, locator: { kind: "section", id: "objective-1" }, observed_text: "Identify hazards before work begins" }] },
    { id: "quiz", role: "assessment", format: "assessment", bindings: [{ id: "quiz-lo", entity_id: "lo.hazard-identification", entity_revision: 1, locator: { kind: "assessment_item", id: "q1" }, observed_text: "Identify hazards before work begins" }] },
    { id: "alignment", role: "alignment_report", format: "alignment_report", bindings: [{ id: "alignment-lo", entity_id: "lo.hazard-identification", entity_revision: 1, locator: { kind: "alignment_row", id: "row-1" }, observed_text: "Identify hazards before work begins" }] }
  ]);
  const coverage = analyzeLearningCoverage(previous, manifest, [{ objective_id: "lo.hazard-identification", slide_binding_ids: ["deck-lo"], guide_binding_ids: ["guide-lo"], assessment_binding_ids: ["quiz-lo"], alignment_binding_ids: ["alignment-lo"] }]);
  assert.equal(coverage.passed, true);
  assert.equal(coverage.human_acceptance, "pending");
  const changedInput = registryInput();
  changedInput.entities[0] = { ...changedInput.entities[0], revision: 2, canonical_value: "Identify and report hazards before work begins" };
  const { registry: current } = validateSemanticRegistry(changedInput);
  const impact = analyzeSemanticImpact(previous, current, manifest);
  assert.equal(impact.changes.length, 1);
  assert.deepEqual(impact.impacts.map((item) => item.artifact_id), ["deck", "guide", "quiz", "alignment"]);
  assert.ok(impact.impacts.every((item) => item.status === "stale"));
  assert.equal(impact.mutation_performed, false);
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
