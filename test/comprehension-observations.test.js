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


test("renderer collection preserves declared signals needed by comprehension heuristics", async () => {
  const { analyzeComprehensionEvidence } = await import("../src/qa/comprehension.js");
  const observations = collectHtmlComprehensionObservations([{ page: 1, elements: [
    { element_id: "message", kind: "content", semantic_role: "message", message_alignment: "matches" },
    { element_id: "image", kind: "image", semantic_role: "supporting_content", declared_region_count: 3, mapped_region_count: 1 },
    { element_id: "decoration", kind: "frame", semantic_role: "decoration", decorative_area_ratio: 0.4, overlaps_primary_task: true }
  ] }]);
  const report = analyzeComprehensionEvidence({ pages: [{ page: 1, three_second_message: "One message" }] }, observations);
  assert.deepEqual(report.findings.map(({ check }) => check).sort(), ["decorative-interference-risk", "image-region-mapping-unverified"]);
});
