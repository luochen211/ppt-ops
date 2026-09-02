import assert from "node:assert/strict";
import test from "node:test";
import { evaluateReleaseReadiness } from "../src/release/readiness.js";

test("GA readiness stays closed while human gates and real-user trials are pending", () => {
  const result = evaluateReleaseReadiness(matrix());
  assert.equal(result.ready, false);
  assert.ok(result.errors.includes("required gate is not passed: human_visual_acceptance"));
  assert.ok(result.errors.includes("target-user-1 is not passed"));
});

test("GA readiness requires six evidenced gates and three independent no-code trials", () => {
  const value = matrix();
  value.gates.forEach((gate) => { gate.status = "passed"; gate.evidence = "docs/evidence.md"; });
  value.target_user_trials.forEach((trial, index) => Object.assign(trial, { status: "passed", code_modified: false, completed_at: `2026-09-0${index + 2}T10:00:00Z`, evidence: `docs/trials/user-${index + 1}.md` }));
  assert.deepEqual(evaluateReleaseReadiness(value), { ready: true, version: "1.0.0", errors: [] });
  value.target_user_trials[2].participant_id = value.target_user_trials[1].participant_id;
  assert.equal(evaluateReleaseReadiness(value).ready, false);
});

function matrix() {
  return {
    schema_version: "1.0", release: { version: "1.0.0" },
    gates: ["automated_release_candidate", "human_visual_acceptance", "manual_powerpoint_acceptance", "chrome_html_acceptance", "safari_html_acceptance", "delivery_package_acceptance"].map((id, index) => ({ id, status: index === 0 ? "passed" : "pending", evidence: index === 0 ? "docs/acceptance/v1-release-candidate.md" : [] })),
    target_user_trials: [1, 2, 3].map((index) => ({ participant_id: `target-user-${index}`, status: "pending", code_modified: null, completed_at: null, evidence: [] }))
  };
}
