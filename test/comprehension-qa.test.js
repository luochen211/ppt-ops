import assert from "node:assert/strict";
import test from "node:test";
import { analyzeComprehensionEvidence, recordHumanComprehensionReview, VISUAL_QA_DIMENSIONS } from "../src/qa/comprehension.js";

const project = { pages: [
  { page: 1, three_second_message: "Stop work and report the hazard" },
  { page: 2, three_second_message: "Match each note to the workplace" }
] };

test("Stage 1 keeps comprehension findings separate from geometry and aesthetic judgement", () => {
  const report = analyzeComprehensionEvidence(project, [
    { page: 1, element_id: "title", kind: "content", semantic_role: "title", evidence_source: "html-dom", confidence: 1 },
    { page: 1, element_id: "small-label", kind: "label", evidence_source: "html-dom", confidence: 0.72 },
    { page: 1, element_id: "decorative-control", kind: "frame", semantic_role: "decoration", interaction_affordance: true, evidence_source: "render-observation", confidence: 0.61 },
    { page: 2, element_id: "mapping-line", kind: "connector", semantic_role: "relationship", evidence_source: "html-dom", confidence: 0.83 },
    { page: 2, element_id: "message", kind: "content", semantic_role: "message", emphasis: "primary", evidence_source: "html-dom", confidence: 0.95 }
  ]);
  assert.deepEqual(report.dimensions, VISUAL_QA_DIMENSIONS);
  assert.equal(report.status, "human_review_required");
  assert.equal(report.audience_comprehension_proven, false);
  for (const check of ["unassigned-semantic-role", "label-target-unresolved", "false-interaction-affordance", "connector-target-unresolved", "three-second-message-unverified"]) assert.ok(report.findings.some((finding) => finding.check === check));
  assert.ok(report.findings.every((finding) => finding.verification === "automated_heuristic" && finding.human_conclusion === "pending" && finding.suggested_fix));
});

test("named human review is recorded without converting it into an audience-comprehension claim", () => {
  const report = analyzeComprehensionEvidence(project, []);
  const reviewed = recordHumanComprehensionReview(report, { actor: "reviewer:syna", conclusion: "changes_required", notes: "The label target is unclear." });
  assert.deepEqual(reviewed.human_review, { status: "recorded", actor: "reviewer:syna", conclusion: "changes_required", notes: "The label target is unclear." });
  assert.equal(reviewed.audience_comprehension_proven, false);
  assert.throws(() => recordHumanComprehensionReview(report, { actor: "", conclusion: "accepted" }), { code: "COMPREHENSION_REVIEW_ACTOR_REQUIRED" });
});

test("invalid renderer observations fail closed", () => {
  assert.throws(() => analyzeComprehensionEvidence(project, [{ page: 99, element_id: "x", kind: "label", evidence_source: "html-dom" }]), { code: "COMPREHENSION_OBSERVATION_PAGE_INVALID" });
  assert.throws(() => analyzeComprehensionEvidence(project, [{ page: 1, element_id: "x", kind: "label", evidence_source: "html-dom", confidence: 2 }]), { code: "COMPREHENSION_CONFIDENCE_INVALID" });
});
