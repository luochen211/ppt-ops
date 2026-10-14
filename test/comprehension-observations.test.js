import assert from "node:assert/strict";
import test from "node:test";
import { collectHtmlComprehensionObservations, collectPptxComprehensionObservations } from "../src/qa/comprehension-observations.js";

test("Stage 2 collects stable explicit renderer observations without pixel inference", () => {
  const html = collectHtmlComprehensionObservations([{ page: 1, elements: [{ element_id: "hero", kind: "content", semantic_role: "message", emphasis: "primary" }] }]);
  assert.deepEqual(html[0], { page: 1, element_id: "hero", kind: "content", semantic_role: "message", container_id: null, target_id: null, emphasis: "primary", interaction_affordance: false, evidence_source: "html-dom-contract", confidence: 1 });
  const pptx = collectPptxComprehensionObservations([{ page: 2, elements: [{ name: "Callout 1", kind: "label", target_id: "photo-1" }, { kind: "mystery" }] }]);
  assert.equal(pptx[0].element_id, "Callout 1");
  assert.equal(pptx[0].target_id, "photo-1");
  assert.equal(pptx[1].element_id, "page-2-element-2");
  assert.equal(pptx[1].semantic_role, null);
});
