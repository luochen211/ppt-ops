import assert from "node:assert/strict";
import test from "node:test";
import { normalizeScenarioPack, validateScenarioPack } from "../src/learning/scenario-pack.js";

test("normalizes a versioned reusable scenario pack", () => {
  const pack = normalizeScenarioPack(validPack());
  assert.equal(pack.contract_version, "1.0");
  assert.equal(pack.kind, "scenario_pack");
  assert.equal(pack.scenarios[0].decision_state, "proposed");
});

test("keeps sourced, regulatory and instructional claims separate", () => {
  const claims = validPack().scenarios[0].claims;
  assert.deepEqual(claims.map(({ evidence_kind }) => evidence_kind), ["sourced_fact", "regulatory_requirement", "instructional_fiction"]);
  assert.deepEqual(validateScenarioPack(validPack()), []);
});

test("regulatory requirements require jurisdiction, source and human confirmation", () => {
  const pack = validPack();
  const claim = pack.scenarios[0].claims[1];
  delete claim.jurisdiction; delete claim.source_id; delete claim.human_confirmation;
  assert.deepEqual(validateScenarioPack(pack), [
    "scenario-office-cable.claim.jurisdiction is required for regulatory requirements",
    "scenario-office-cable.claim.source_id is required for regulatory requirements",
    "scenario-office-cable.claim.human_confirmation must be required or confirmed"
  ]);
});

test("instructional fiction cannot masquerade as sourced authority", () => {
  const pack = validPack(); pack.scenarios[0].claims[2].source_id = "source-policy";
  assert.throws(() => normalizeScenarioPack(pack), (error) => error.code === "SCENARIO_PACK_INVALID" && error.errors.includes("scenario-office-cable.claim.instructional fiction must not claim a source or jurisdiction"));
});

function validPack() {
  return {
    kind: "scenario_pack", id: "scenario-pack-office-safety", name: "Office Safety", domain: "occupational-safety", workplace_context: "office",
    scenarios: [{
      id: "scenario-office-cable", title: "Cable across a shared walkway", learning_objective_id: "lo-identify-hazard",
      personas: [{ id: "persona-worker", role: "worker" }], observable_cues: ["Cable crosses a walking route"], decision_points: ["Choose the safest next action"], plausible_distractors: ["Step over it and continue"],
      expected_action: "Isolate and report the hazard", rationale: "The walking route should remain clear while the issue is addressed", facilitation_question: "What evidence makes this urgent?", difficulty: "introductory", ambiguity: "low",
      visual_brief: "A shared office walkway with one visible cable hazard", accessibility_description: "Office walkway with a cable crossing the path", decision_state: "proposed",
      claims: [
        { id: "claim-cue", text: "The cable crosses the walking route", evidence_kind: "sourced_fact", source_id: "source-photo-1" },
        { id: "claim-rule", text: "Apply the locally approved reporting procedure", evidence_kind: "regulatory_requirement", source_id: "source-policy", jurisdiction: "organization-policy", human_confirmation: "required" },
        { id: "claim-character", text: "The worker is arriving for a meeting", evidence_kind: "instructional_fiction" }
      ]
    }]
  };
}
