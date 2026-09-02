const REQUIRED_GATES = Object.freeze([
  "automated_release_candidate",
  "human_visual_acceptance",
  "manual_powerpoint_acceptance",
  "chrome_html_acceptance",
  "safari_html_acceptance",
  "delivery_package_acceptance"
]);

export function evaluateReleaseReadiness(matrix) {
  const errors = [];
  if (matrix?.schema_version !== "1.0") errors.push("matrix.schema_version must be 1.0");
  if (matrix?.release?.version !== "1.0.0") errors.push("matrix.release.version must be 1.0.0");
  const gates = new Map((matrix?.gates ?? []).map((gate) => [gate.id, gate]));
  for (const id of REQUIRED_GATES) {
    const gate = gates.get(id);
    if (!gate) errors.push(`missing required gate: ${id}`);
    else if (gate.status !== "passed") errors.push(`required gate is not passed: ${id}`);
    else if (!hasEvidence(gate.evidence)) errors.push(`required gate has no evidence: ${id}`);
  }

  const trials = matrix?.target_user_trials ?? [];
  if (trials.length !== 3) errors.push("exactly three target-user trials are required");
  const participants = new Set();
  for (const [index, trial] of trials.entries()) {
    const label = trial?.participant_id || `trial ${index + 1}`;
    if (!trial?.participant_id) errors.push(`trial ${index + 1} has no participant_id`);
    else if (participants.has(trial.participant_id)) errors.push(`target-user participant is duplicated: ${trial.participant_id}`);
    else participants.add(trial.participant_id);
    if (trial?.status !== "passed") errors.push(`${label} is not passed`);
    if (trial?.code_modified !== false) errors.push(`${label} must complete without modifying code`);
    if (!isIsoDate(trial?.completed_at)) errors.push(`${label} has no valid completed_at timestamp`);
    if (!hasEvidence(trial?.evidence)) errors.push(`${label} has no evidence`);
  }
  return { ready: errors.length === 0, version: matrix?.release?.version, errors };
}

function hasEvidence(value) {
  return typeof value === "string" ? value.trim().length > 0 : Array.isArray(value) ? value.length > 0 && value.every(hasEvidence) : false;
}
function isIsoDate(value) { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }
