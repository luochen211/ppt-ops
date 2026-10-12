import crypto from "node:crypto";
import { semanticEntity } from "./registry.js";

const LOCATORS = Object.freeze({ pptx: new Set(["slide"]), docx: new Set(["word_page", "section"]), pdf: new Set(["pdf_page"]), assessment: new Set(["assessment_item"]), alignment_report: new Set(["alignment_row"]) });
const ROLES = new Set(["presentation", "learner_guide", "assessment", "alignment_report"]);

export function validateSemanticBindings(registry, artifacts) {
  if (!Array.isArray(artifacts) || !artifacts.length) throw coded("SEMANTIC_ARTIFACTS_REQUIRED", "at least one semantic artifact is required");
  const artifactIds = new Set(), bindingIds = new Set();
  const normalized = artifacts.map((artifact, artifactIndex) => {
    if (!artifact?.id || artifactIds.has(artifact.id)) throw coded("SEMANTIC_ARTIFACT_INVALID", `artifact ${artifactIndex} requires a unique id`);
    artifactIds.add(artifact.id);
    if (!LOCATORS[artifact.format] || !ROLES.has(artifact.role)) throw coded("SEMANTIC_ARTIFACT_INVALID", `${artifact.id} has unsupported format or role`);
    if (!Array.isArray(artifact.bindings)) throw coded("SEMANTIC_BINDINGS_REQUIRED", `${artifact.id} requires bindings`);
    const bindings = artifact.bindings.map((binding, bindingIndex) => {
      const id = binding.id ?? `${artifact.id}:binding-${bindingIndex + 1}`;
      if (bindingIds.has(id)) throw coded("SEMANTIC_BINDING_DUPLICATE", `duplicate binding id: ${id}`);
      bindingIds.add(id);
      const entity = semanticEntity(registry, binding.entity_id);
      if (!entity) throw coded("SEMANTIC_ENTITY_UNKNOWN", `${artifact.id} references unknown semantic entity: ${binding.entity_id}`);
      if (!LOCATORS[artifact.format].has(binding.locator?.kind) || !positiveLocator(binding.locator)) throw coded("SEMANTIC_LOCATOR_INVALID", `${artifact.id} uses an invalid ${artifact.format} locator`);
      if (typeof binding.observed_text !== "string" || !binding.observed_text.trim()) throw coded("SEMANTIC_OBSERVED_TEXT_REQUIRED", `${id} requires an original-text snapshot`);
      if (!Number.isInteger(binding.entity_revision) || binding.entity_revision < 1) throw coded("SEMANTIC_BINDING_REVISION_INVALID", `${id} requires a semantic entity revision`);
      return { id, entity_id: binding.entity_id, entity_revision: binding.entity_revision, locator: structuredClone(binding.locator), observed_text: binding.observed_text.trim() };
    });
    return { id: artifact.id, role: artifact.role, format: artifact.format, file: String(artifact.file ?? ""), bindings };
  });
  const manifest = { contract_version: "1.0", kind: "semantic_binding_manifest", registry_sha256: registry.sha256, artifacts: normalized };
  return { ...manifest, sha256: crypto.createHash("sha256").update(JSON.stringify(manifest)).digest("hex") };
}
function positiveLocator(locator) { return Number.isInteger(locator?.number) ? locator.number > 0 : typeof locator?.id === "string" && locator.id.length > 0; }
function coded(code, message) { return Object.assign(new Error(message), { code }); }
