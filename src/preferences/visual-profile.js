import fs from "node:fs/promises";
import path from "node:path";

export const VISUAL_PREFERENCE_PROFILE_VERSION = "1.0";
export const VISUAL_PREFERENCE_FILE = "config/visual-preferences.json";
export const VISUAL_PREFERENCE_DIMENSIONS = Object.freeze([
  "density", "whitespace", "hierarchy", "imagery", "rhythm", "motif"
]);

const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const KINDS = new Set(["preferred_pattern", "anti_pattern"]);
const DECISIONS = new Set(["accept", "reject"]);

export function createVisualPreferenceProfile() {
  return {
    schema_version: VISUAL_PREFERENCE_PROFILE_VERSION,
    references: [],
    candidates: [],
    history: []
  };
}

export function visualPreferenceProfileFile(repositoryRoot) {
  if (typeof repositoryRoot !== "string" || repositoryRoot.trim() === "") throw new TypeError("repositoryRoot is required");
  return path.resolve(repositoryRoot, VISUAL_PREFERENCE_FILE);
}

export class VisualPreferenceProfileStore {
  constructor({ repositoryRoot, now = () => new Date().toISOString() }) {
    this.file = visualPreferenceProfileFile(repositoryRoot);
    this.now = now;
  }

  async load() {
    try {
      const profile = JSON.parse(await fs.readFile(this.file, "utf8"));
      assertProfile(profile);
      return profile;
    } catch (error) {
      if (error.code === "ENOENT") return createVisualPreferenceProfile();
      throw error;
    }
  }

  async nominateReference({ id, file, sha256, title, actor }) {
    requireUser(actor);
    requireId(id, "reference id");
    requireSafeRelativePath(file, "reference file");
    requireHash(sha256, "reference sha256");
    if (title !== undefined) requireText(title, "reference title");
    return this.update((profile) => {
      if (profile.references.some((reference) => reference.id === id)) throw new Error(`reference already exists: ${id}`);
      profile.references.push({ id, file, sha256, ...(title ? { title: title.trim() } : {}), nominated_by: "user", nominated_at: this.now() });
      profile.history.push(event("reference.nominated", id, actor, this.now()));
      return profile.references.at(-1);
    });
  }

  async proposeFromReference({ id, kind, dimension, statement, observed_properties, reference_ids }) {
    return this.update((profile) => {
      requireCandidateFields({ id, kind, dimension, statement, observed_properties });
      requireIdList(reference_ids, "reference_ids");
      for (const referenceId of reference_ids) {
        if (!profile.references.some((reference) => reference.id === referenceId)) throw new Error(`unknown nominated reference: ${referenceId}`);
      }
      const candidate = createCandidate({ id, kind, dimension, statement, observed_properties, evidence: { source_type: "reference_deck", source_ids: reference_ids }, created_at: this.now() });
      insertCandidate(profile, candidate);
      profile.history.push(event("candidate.proposed", id, "agent", this.now()));
      return candidate;
    });
  }

  async proposeFromRepeatedFeedback({ id, kind, dimension, statement, observed_properties, feedback, root_cause_fingerprint }) {
    const supporting = supportingFeedback(feedback, root_cause_fingerprint);
    if (supporting.length < 2) throw new Error("at least two distinct user rejections with the same aesthetic root-cause fingerprint are required");
    return this.update((profile) => {
      requireCandidateFields({ id, kind, dimension, statement, observed_properties });
      const candidate = createCandidate({ id, kind, dimension, statement, observed_properties, evidence: { source_type: "candidate_feedback", source_ids: supporting.map(({ id: feedbackId }) => feedbackId), root_cause_fingerprint }, created_at: this.now() });
      insertCandidate(profile, candidate);
      profile.history.push(event("candidate.proposed", id, "agent", this.now()));
      return candidate;
    });
  }

  async decide(candidateId, { decision, actor, raw_feedback }) {
    requireUser(actor);
    if (!DECISIONS.has(decision)) throw new Error(`invalid preference decision: ${decision}`);
    requireText(raw_feedback, "raw_feedback");
    return this.update((profile) => {
      const candidate = currentCandidate(profile, candidateId);
      if (candidate.status !== "proposed") throw new Error(`preference candidate is not awaiting a decision: ${candidateId}`);
      candidate.status = decision === "accept" ? "accepted" : "rejected";
      candidate.decided_at = this.now();
      candidate.raw_feedback = raw_feedback.trim();
      profile.history.push(event(`candidate.${candidate.status}`, candidateId, actor, this.now(), { raw_feedback: raw_feedback.trim() }));
      return candidate;
    });
  }

  async revise(candidateId, { id, statement, actor, raw_feedback }) {
    requireUser(actor);
    requireId(id, "revised candidate id");
    requireText(statement, "preference statement");
    requireText(raw_feedback, "raw_feedback");
    return this.update((profile) => {
      const previous = currentCandidate(profile, candidateId);
      if (previous.status === "removed" || previous.status === "superseded") throw new Error(`preference candidate cannot be revised: ${candidateId}`);
      const revised = createCandidate({
        id,
        kind: previous.kind,
        dimension: previous.dimension,
        statement,
        observed_properties: previous.observed_properties,
        evidence: previous.evidence,
        created_at: this.now(),
        supersedes: previous.id
      });
      insertCandidate(profile, revised);
      previous.status = "superseded";
      previous.superseded_by = id;
      profile.history.push(event("candidate.revised", id, actor, this.now(), { previous_id: candidateId, raw_feedback: raw_feedback.trim() }));
      return revised;
    });
  }

  async remove(candidateId, { actor, raw_feedback }) {
    requireUser(actor);
    requireText(raw_feedback, "raw_feedback");
    return this.update((profile) => {
      const candidate = currentCandidate(profile, candidateId);
      if (candidate.status !== "accepted") throw new Error(`only an accepted preference can be removed: ${candidateId}`);
      candidate.status = "removed";
      candidate.removed_at = this.now();
      profile.history.push(event("candidate.removed", candidateId, actor, this.now(), { raw_feedback: raw_feedback.trim() }));
      return candidate;
    });
  }

  async accepted() {
    const profile = await this.load();
    return profile.candidates.filter((candidate) => candidate.status === "accepted").map(({ id, kind, dimension, statement, evidence }) => ({ id, kind, dimension, statement, evidence }));
  }

  async update(change) {
    const profile = await this.load();
    const result = change(profile);
    assertProfile(profile);
    await writeAtomic(this.file, profile);
    return structuredClone(result);
  }
}

function createCandidate({ id, kind, dimension, statement, observed_properties, evidence, created_at, supersedes }) {
  return {
    id,
    kind,
    dimension,
    statement: statement.trim(),
    observed_properties: structuredClone(observed_properties),
    evidence: structuredClone(evidence),
    status: "proposed",
    created_at,
    ...(supersedes ? { supersedes } : {})
  };
}

function supportingFeedback(feedback, fingerprint) {
  requireText(fingerprint, "root_cause_fingerprint");
  if (!Array.isArray(feedback)) throw new TypeError("feedback must be an array");
  const matches = feedback.filter((record) => record?.actor === "user" && record?.decision === "reject" && Array.isArray(record.findings) && record.findings.some((finding) => finding?.eval_category === "aesthetic_brand" && finding?.root_cause_fingerprint === fingerprint));
  const unique = new Map(matches.filter((record) => ID_PATTERN.test(record?.id ?? "")).map((record) => [record.id, record]));
  return [...unique.values()];
}

function insertCandidate(profile, candidate) {
  if (profile.candidates.some(({ id }) => id === candidate.id)) throw new Error(`preference candidate already exists: ${candidate.id}`);
  profile.candidates.push(candidate);
}

function currentCandidate(profile, id) {
  requireId(id, "candidate id");
  const candidate = profile.candidates.find((item) => item.id === id);
  if (!candidate) throw new Error(`unknown preference candidate: ${id}`);
  return candidate;
}

function requireCandidateFields({ id, kind, dimension, statement, observed_properties }) {
  requireId(id, "candidate id");
  if (!KINDS.has(kind)) throw new Error(`invalid preference kind: ${kind}`);
  if (!VISUAL_PREFERENCE_DIMENSIONS.includes(dimension)) throw new Error(`invalid preference dimension: ${dimension}`);
  requireText(statement, "preference statement");
  if (!Array.isArray(observed_properties) || observed_properties.length === 0) throw new Error("observed_properties must contain at least one observation");
  for (const [index, observation] of observed_properties.entries()) {
    if (!observation || typeof observation !== "object" || Array.isArray(observation)) throw new Error(`observed_properties[${index}] must be an object`);
    requireText(observation.property, `observed_properties[${index}].property`);
    requireText(observation.value, `observed_properties[${index}].value`);
  }
}

function assertProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) throw new Error("visual preference profile must be an object");
  if (profile.schema_version !== VISUAL_PREFERENCE_PROFILE_VERSION) throw new Error(`unsupported visual preference profile version: ${profile.schema_version}`);
  for (const key of ["references", "candidates", "history"]) if (!Array.isArray(profile[key])) throw new Error(`${key} must be an array`);
  const ids = new Set();
  for (const candidate of profile.candidates) {
    requireCandidateFields(candidate);
    if (ids.has(candidate.id)) throw new Error(`duplicate preference candidate: ${candidate.id}`);
    ids.add(candidate.id);
    if (!["proposed", "accepted", "rejected", "removed", "superseded"].includes(candidate.status)) throw new Error(`invalid preference status: ${candidate.status}`);
    if (!candidate.evidence || typeof candidate.evidence !== "object" || Array.isArray(candidate.evidence)) throw new Error(`candidate evidence is required: ${candidate.id}`);
  }
}

function event(type, subject_id, actor, created_at, detail = {}) {
  return { type, subject_id, actor, created_at, ...detail };
}

async function writeAtomic(file, profile) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
  await fs.rename(temporary, file);
}

function requireUser(actor) {
  if (actor !== "user") throw new Error("explicit user action is required");
}

function requireId(value, label) {
  if (!ID_PATTERN.test(value ?? "")) throw new Error(`${label} must be a stable lowercase identifier`);
}

function requireIdList(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => !ID_PATTERN.test(item))) throw new Error(`${label} must contain stable identifiers`);
}

function requireHash(value, label) {
  if (!SHA256_PATTERN.test(value ?? "")) throw new Error(`${label} must be a SHA-256 digest`);
}

function requireText(value, label) {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} is required`);
}

function requireSafeRelativePath(value, label) {
  requireText(value, label);
  if (path.isAbsolute(value) || value.split(/[\\/]+/).includes("..")) throw new Error(`${label} must be a safe relative path`);
}
