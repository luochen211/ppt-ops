import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { resolveProjectPath } from "../core/project.js";

const REQUIRED_PROVENANCE = ["brief_id", "generation_id", "prompt_sha256", "provider", "model", "decision_id"];
const REQUIRED_VISUAL_CHECKS = ["semantic_action", "subject_count", "identity_boundary", "visible_text_or_logo", "reference_invariants", "edge_integration", "copy_safe_space"];
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export class BoundaryImageError extends Error {
  constructor(result) {
    const summary = result.failures.map((failure) => `${failure.boundary} page ${failure.page_id}: ${failure.message}`).join("; ");
    super(`Mandatory ImageGen boundary check failed: ${summary}`);
    this.code = "BOUNDARY_IMAGE_REQUIRED";
    this.details = result;
  }
}

export async function assertBoundaryGeneratedImages(project) {
  const result = await inspectBoundaryGeneratedImages(project);
  if (!result.passed) throw new BoundaryImageError(result);
  return result;
}

export async function inspectBoundaryGeneratedImages(project) {
  if (project?.contractModel !== "v1" || !project.contracts) {
    const pageId = project?.pages?.[0]?.id ?? project?.pages?.[0]?.page ?? "unknown";
    return failedResult([failure(["first", "final"], pageId, "v1_project_required", "migrate the project to V1 and register accepted ImageGen visuals")]);
  }

  const pages = project.contracts.pages ?? [];
  if (pages.length === 0) return failedResult([failure(["first", "final"], "unknown", "page_missing", "add at least one canonical page")]);
  const boundaries = pages.length === 1
    ? [{ roles: ["first", "final"], page: pages[0] }]
    : [{ roles: ["first"], page: pages[0] }, { roles: ["final"], page: pages.at(-1) }];
  const results = [];
  for (const boundary of boundaries) results.push(await inspectBoundary(project, boundary));
  const failures = results.filter((result) => !result.passed).map((result) => result.failure);
  return { passed: failures.length === 0, boundaries: results.map(({ failure: omitted, ...result }) => result), failures };
}

async function inspectBoundary(project, { roles, page }) {
  const boundary = roles.join("+");
  const assets = new Map((project.contracts.assets ?? []).map((asset) => [asset.id, asset]));
  const generated = (page.asset_slots ?? []).map((slot) => ({ slot, asset: assets.get(slot.asset_id) }))
    .filter(({ asset }) => asset?.type === "generated_image");
  if (generated.length === 0) {
    return { passed: false, boundary, roles, page_id: page.id, failure: failure(roles, page.id, "generated_image_missing", "register an accepted ImageGen asset in this page's asset_slots") };
  }

  const rejected = [];
  for (const candidate of generated) {
    const result = await inspectCandidate(project, page, candidate);
    if (result.passed) return { passed: true, boundary, roles, page_id: page.id, asset_id: candidate.asset.id, generation_id: candidate.asset.provenance.generation_id, sha256: candidate.asset.sha256 };
    rejected.push(result);
  }
  const first = rejected[0];
  return {
    passed: false, boundary, roles, page_id: page.id,
    failure: failure(roles, page.id, first.code, first.message, first.asset_id)
  };
}

async function inspectCandidate(project, page, { slot, asset }) {
  const invalid = (code, message) => ({ passed: false, code, message, asset_id: asset.id });
  if (!project.contracts.project.asset_ids?.includes(asset.id)) return invalid("asset_not_registered", `add ${asset.id} to project.asset_ids through visual-asset-register`);
  for (const key of REQUIRED_PROVENANCE) {
    if (typeof asset.provenance?.[key] !== "string" || asset.provenance[key].trim() === "") return invalid("provenance_incomplete", `${asset.id} is missing provenance.${key}`);
  }
  for (const key of ["brief_id", "generation_id", "decision_id"]) {
    if (!ID_PATTERN.test(asset.provenance[key])) return invalid("provenance_invalid", `${asset.id} provenance.${key} is not a stable identifier`);
  }
  if (!SHA256_PATTERN.test(asset.provenance.prompt_sha256)) return invalid("provenance_invalid", `${asset.id} provenance.prompt_sha256 is not a SHA-256 digest`);

  const evidence = path.join(project.root, ".pptops", "visual-assets");
  const generation = await readEvidence(path.join(evidence, "generations", asset.provenance.generation_id, "manifest.json"));
  if (!generation.ok) return invalid("generation_evidence_missing", `${asset.id} generation manifest is ${generation.reason}`);
  const manifest = generation.value;
  if (manifest.kind !== "visual_asset_generation" || manifest.id !== asset.provenance.generation_id) return invalid("generation_evidence_mismatch", `${asset.id} generation identity does not match its provenance`);
  if (manifest.state !== "awaiting_visual_observation" || manifest.inspection?.passed !== true) return invalid("automated_inspection_not_passed", `${asset.id} generation does not have a passing automated raster inspection`);
  if (manifest.brief_id !== asset.provenance.brief_id || manifest.prompt_sha256 !== asset.provenance.prompt_sha256) return invalid("generation_evidence_mismatch", `${asset.id} generation brief or prompt hash does not match its provenance`);
  if (manifest.provider !== asset.provenance.provider || manifest.model !== asset.provenance.model) return invalid("provider_evidence_mismatch", `${asset.id} provider/model summary does not match its generation manifest`);

  const brief = await readEvidence(path.join(evidence, "briefs", `${asset.provenance.brief_id}.json`));
  if (!brief.ok) return invalid("brief_evidence_missing", `${asset.id} visual brief is ${brief.reason}`);
  if (brief.value.id !== asset.provenance.brief_id || brief.value.page_id !== page.id || brief.value.slot_role !== slot.role) return invalid("brief_evidence_mismatch", `${asset.id} brief does not target ${page.id}/${slot.role}`);

  const prompt = await readEvidence(path.join(evidence, "prompts", `${asset.provenance.brief_id}.json`));
  if (!prompt.ok) return invalid("prompt_evidence_missing", `${asset.id} compiled prompt record is ${prompt.reason}`);
  if (prompt.value.brief_id !== asset.provenance.brief_id || prompt.value.prompt_sha256 !== asset.provenance.prompt_sha256) return invalid("prompt_evidence_mismatch", `${asset.id} compiled prompt does not match its provenance`);
  if (typeof prompt.value.prompt !== "string" || sha256(prompt.value.prompt) !== prompt.value.prompt_sha256) return invalid("prompt_evidence_mismatch", `${asset.id} compiled prompt bytes do not match its recorded hash`);

  const inspectionFields = ["sha256", "bytes", "mime", "width", "height"];
  for (const key of inspectionFields) {
    if (manifest.inspection?.[key] !== asset[key]) return invalid("inspection_evidence_mismatch", `${asset.id} ${key} does not match the automated inspection`);
  }
  const candidateHash = await fileHash(project.root, manifest.output_file);
  if (!candidateHash.ok || candidateHash.sha256 !== manifest.inspection.sha256) return invalid("generated_candidate_changed", `${asset.id} immutable generated candidate is missing or changed`);
  const acceptedHash = await fileHash(project.root, asset.file);
  if (!acceptedHash.ok || acceptedHash.sha256 !== asset.sha256) return invalid("accepted_asset_changed", `${asset.id} accepted asset file is missing or changed`);

  const decision = await readEvidence(path.join(evidence, "decisions", manifest.id, `${asset.provenance.decision_id}.json`));
  if (!decision.ok) return invalid("user_decision_missing", `${asset.id} user decision is ${decision.reason}`);
  if (decision.value.id !== asset.provenance.decision_id || decision.value.generation_id !== manifest.id || decision.value.actor !== "user" || decision.value.decision !== "accept") {
    return invalid("user_acceptance_mismatch", `${asset.id} does not resolve to an explicit user accept decision`);
  }
  if (typeof decision.value.observation_id !== "string") return invalid("visual_observation_missing", `${asset.id} accepted decision does not reference a visual observation`);
  if (!ID_PATTERN.test(decision.value.observation_id)) return invalid("visual_observation_missing", `${asset.id} accepted decision references an invalid observation id`);
  const observation = await readEvidence(path.join(evidence, "observations", manifest.id, `${decision.value.observation_id}.json`));
  if (!observation.ok) return invalid("visual_observation_missing", `${asset.id} visual observation is ${observation.reason}`);
  if (observation.value.id !== decision.value.observation_id || observation.value.generation_id !== manifest.id || !["agent", "human"].includes(observation.value.actor) || observation.value.verdict !== "pass" || observation.value.candidate_sha256 !== asset.sha256 || REQUIRED_VISUAL_CHECKS.some((key) => observation.value.checks?.[key] !== true)) {
    return invalid("visual_observation_not_passed", `${asset.id} does not have a matching passing visual observation`);
  }

  const registration = await findRegistration(evidence, ({ value }) => value.asset_id === asset.id && value.generation_id === manifest.id && value.decision_id === decision.value.id);
  if (!registration.ok) return invalid("registration_evidence_missing", `${asset.id} immutable registration record is missing`);
  const record = registration.value;
  if (record.kind !== "visual_asset_registration" || record.page_id !== page.id || record.slot_role !== slot.role || record.file !== asset.file || record.sha256 !== asset.sha256) return invalid("registration_evidence_mismatch", `${asset.id} registration does not match the selected boundary slot and file`);
  return { passed: true };
}

async function readEvidence(file) {
  try { return { ok: true, value: JSON.parse(await fs.readFile(file, "utf8")) }; }
  catch (error) { return { ok: false, reason: error.code === "ENOENT" ? "missing" : "invalid" }; }
}

async function fileHash(root, relativeFile) {
  try {
    const bytes = await fs.readFile(resolveProjectPath(root, relativeFile));
    return { ok: true, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  } catch { return { ok: false }; }
}

async function findRegistration(evidenceRoot, predicate) {
  const directory = path.join(evidenceRoot, "registrations");
  let files;
  try { files = await fs.readdir(directory); } catch { return { ok: false }; }
  for (const file of files.filter((name) => name.endsWith(".json")).sort()) {
    const record = await readEvidence(path.join(directory, file));
    if (record.ok && predicate(record)) return record;
  }
  return { ok: false };
}

function failure(roles, pageId, code, message, assetId) {
  return { boundary: roles.join("+"), roles, page_id: String(pageId), code, message, ...(assetId ? { asset_id: assetId } : {}) };
}
function failedResult(failures) { return { passed: false, boundaries: [], failures }; }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
