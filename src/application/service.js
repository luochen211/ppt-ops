import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { buildHtml } from "../adapters/html.js";
import { buildPptx } from "../adapters/pptx.js";
import { createV1Entity } from "../contracts/v1.js";
import { normalizeFeedbackFindings, repeatedRootCauseFingerprints } from "../core/feedback.js";
import { readProject, resolveProjectPath } from "../core/project.js";
import { validateProject } from "../core/validate.js";
import { createHandoff } from "../handoff/index.js";
import { ProjectFileStore } from "../infrastructure/file-store.js";
import { InfrastructureStore } from "../infrastructure/store.js";
import { reviewProject, writeReviewReport } from "../review/index.js";
import { assertBoundaryGeneratedImages } from "../visual-assets/boundary-policy.js";

const CONTRACT_FILES = ["project.json", "sources.json", "outline.json", "pages.json", "theme.json", "assets.json", "templates.json"];
const COLLECTIONS = { source: "sources", page_spec: "pages", asset: "assets", template: "templates" };

export class ApplicationError extends Error {
  constructor(code, message, details) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export class ApplicationService {
  static async open(projectDir) {
    const project = await readProject(projectDir);
    if (project.contractModel !== "v1") throw new ApplicationError("V1_PROJECT_REQUIRED", "application commands require a V1 project");
    const store = new InfrastructureStore(path.join(project.root, ".pptops", "metadata.sqlite"));
    store.registerProject({ id: project.project.name, root: project.root, title: project.project.title });
    return new ApplicationService(project, store);
  }

  constructor(project, store) {
    this.project = project;
    this.store = store;
    this.files = new ProjectFileStore(project.root);
    this.projectId = project.project.name;
  }

  close() { this.store.close(); }

  async proposeCandidate({ targetKind, targetId, patch, baseRevision, parentCandidateId, hypothesis = "", reconstruction }) {
    if (!isPlainObject(patch)) throw new ApplicationError("PATCH_INVALID", "candidate patch must be a JSON object");
    const target = this.findTarget(targetKind, targetId);
    const current = this.ensureTracked(target);
    if (baseRevision !== current.revision) throw new ApplicationError("STALE_BASE_REVISION", "candidate base revision is stale", { expected: current.revision, received: baseRevision });
    let parent;
    if (parentCandidateId) {
      parent = this.requireEntity("candidate", parentCandidateId);
      if (parent.target_id !== targetId || parent.target_kind !== targetKind) throw new ApplicationError("PARENT_TARGET_MISMATCH", "parent candidate targets a different object");
      if (!["continued", "rejected", "reconstruction_required"].includes(parent.state)) throw new ApplicationError("PARENT_NOT_TERMINAL", `parent candidate cannot start another attempt: ${parent.state}`);
      if (parent.state === "reconstruction_required") validateReconstruction(reconstruction, patch);
    }
    const candidates = this.store.listEntities(this.projectId, "candidate");
    const id = nextId("candidate", candidates);
    const baseHash = hashJson(stripRevision(current));
    const targetAttempts = candidates.filter((candidate) => candidate.target_id === targetId && candidate.target_kind === targetKind);
    let candidate = createV1Entity("candidate", id, {
      target_id: targetId, target_kind: targetKind, state: "generated", base_revision: baseRevision, base_hash: baseHash, patch,
      attempt: targetAttempts.length + 1, parent_candidate_id: parentCandidateId ?? null, hypothesis: String(hypothesis),
      ...(reconstruction ? { reconstruction: structuredClone(reconstruction) } : {})
    });
    candidate = this.store.saveEntity(this.projectId, candidate);
    candidate = this.store.saveEntity(this.projectId, { ...stripRevision(candidate), state: "validating" });
    candidate = this.store.saveEntity(this.projectId, { ...stripRevision(candidate), state: "ready_for_review" });
    return candidate;
  }

  async renderCandidate(candidateId, expectedRevision) {
    const candidate = this.requireCurrentCandidate(candidateId, expectedRevision, "ready_for_review");
    this.assertCandidateBaseCurrent(candidate);
    if (candidate.target_kind !== "page_spec") throw new ApplicationError("CANDIDATE_PREVIEW_UNSUPPORTED", "PowerPoint candidate previews currently require a page_spec target");
    const target = this.findTarget(candidate.target_kind, candidate.target_id);
    const updated = deepMerge(target, candidate.patch);
    if (updated.id !== target.id || updated.kind !== target.kind) throw new ApplicationError("TARGET_IDENTITY_CHANGED", "candidate cannot change target kind or id");
    const previewProject = { ...this.project, pages: this.project.pages.map((page) => page.page === target.page ? deepMerge(page, candidate.patch) : page) };
    const relative = path.join(".pptops", "candidates", candidate.id, "preview.pptx");
    const output = resolveProjectPath(this.project.root, relative);
    try { await fs.access(output); throw new ApplicationError("CANDIDATE_PREVIEW_EXISTS", `candidate preview is immutable: ${candidate.id}`); }
    catch (error) { if (error instanceof ApplicationError) throw error; if (error.code !== "ENOENT") throw error; }
    await fs.mkdir(path.dirname(output), { recursive: true });
    const temporary = `${output}.tmp-${crypto.randomUUID()}.pptx`;
    try {
      await buildPptx(previewProject, temporary);
      const bytes = await fs.readFile(temporary);
      await fs.rename(temporary, output);
      const renderEvidence = { artifact: relative, sha256: crypto.createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, pages: [target.page] };
      const rendered = this.store.saveEntity(this.projectId, { ...stripRevision(candidate), state: "awaiting_powerpoint_observation", render_evidence: renderEvidence });
      return { candidate: rendered, render_evidence: renderEvidence };
    } catch (error) { await fs.rm(temporary, { force: true }); throw error; }
  }

  diffCandidate(candidateId) {
    const candidate = this.requireEntity("candidate", candidateId);
    const current = this.ensureTracked(this.findTarget(candidate.target_kind, candidate.target_id));
    return {
      candidate_id: candidate.id,
      candidate_revision: candidate.revision,
      target: { kind: candidate.target_kind, id: candidate.target_id, revision: current.revision },
      stale: candidate.base_revision !== current.revision || candidate.base_hash !== hashJson(stripRevision(current)),
      patch: candidate.patch
    };
  }

  async acceptCandidate(candidateId, expectedRevision, rawFeedback = "Explicit acceptance") {
    await this.decideCandidate(candidateId, {
      decision: "accept", expectedRevision, rawFeedback,
      findings: [{ eval_category: "user_acceptance", root_cause: "process", root_cause_fingerprint: "explicit-acceptance", severity: "note", evidence: {} }]
    });
    const candidate = this.requireEntity("candidate", candidateId);
    if (candidate.state !== "accepted") throw new ApplicationError("CANDIDATE_NOT_ACCEPTED", `candidate is not accepted: ${candidate.state}`);
    const target = this.findTarget(candidate.target_kind, candidate.target_id);
    const current = this.ensureTracked(target);
    if (candidate.base_revision !== current.revision || candidate.base_hash !== hashJson(stripRevision(current))) {
      throw new ApplicationError("STALE_BASE_REVISION", "candidate target changed after proposal");
    }
    const updated = deepMerge(target, candidate.patch);
    if (updated.id !== target.id || updated.kind !== target.kind) throw new ApplicationError("TARGET_IDENTITY_CHANGED", "candidate cannot change target kind or id");
    await this.writeTarget(updated);
    const savedTarget = this.store.saveEntity(this.projectId, updated);
    const accepted = this.store.saveEntity(this.projectId, { ...stripRevision(candidate), state: "applied_to_draft" });
    return { candidate: accepted, target: savedTarget };
  }

  recordPowerPointObservation(candidateId, { expectedRevision, status, evidence }) {
    const candidate = this.requireCurrentCandidate(candidateId, expectedRevision, "awaiting_powerpoint_observation");
    this.assertCandidateBaseCurrent(candidate);
    if (!["viewed", "not_viewed"].includes(status)) throw new ApplicationError("POWERPOINT_STATUS_INVALID", "PowerPoint observation status must be viewed or not_viewed");
    if (!isPlainObject(evidence)) throw new ApplicationError("EVIDENCE_INVALID", "PowerPoint observation evidence must be a JSON object");
    if (status === "viewed") validatePowerPointEvidence(evidence, candidate.render_evidence);
    const id = nextId("powerpoint-observation", this.store.listEntities(this.projectId, "powerpoint_observation"));
    const observation = this.store.saveEntity(this.projectId, createV1Entity("powerpoint_observation", id, {
      candidate_id: candidate.id, target_id: candidate.target_id, status, evidence, candidate_revision: candidate.revision, base_revision: candidate.base_revision
    }));
    if (status === "not_viewed") return { observation, candidate };
    const next = this.store.saveEntity(this.projectId, { ...stripRevision(candidate), state: "awaiting_user_decision", powerpoint_observation_id: observation.id });
    return { observation, candidate: next };
  }

  rejectCandidateByAutomatedQa(candidateId, { expectedRevision, rawFeedback, findings }) {
    const candidate = this.requireCurrentCandidate(candidateId, expectedRevision, "awaiting_powerpoint_observation");
    this.assertCandidateBaseCurrent(candidate);
    if (!hasText(rawFeedback)) throw new ApplicationError("QA_FEEDBACK_REQUIRED", "automated QA rejection requires raw feedback");
    const normalizedFindings = normalizeFeedbackFindings(findings, {
      targetKind: candidate.target_kind, targetId: candidate.target_id, decision: "reject", actor: "automated_qa"
    });
    const id = nextId("feedback", this.store.listEntities(this.projectId, "candidate_feedback"));
    const feedback = this.store.saveEntity(this.projectId, createV1Entity("candidate_feedback", id, {
      candidate_id: candidate.id, target_id: candidate.target_id, target_kind: candidate.target_kind, decision: "reject", actor: "automated_qa",
      raw_feedback: rawFeedback, findings: normalizedFindings, force_reconstruction: false, candidate_revision: candidate.revision, base_revision: candidate.base_revision
    }));
    const rejected = this.store.saveEntity(this.projectId, { ...stripRevision(candidate), state: "rejected", decision_feedback_id: feedback.id });
    return { candidate: rejected, feedback, force_reconstruction: false };
  }

  async decideCandidate(candidateId, { decision, expectedRevision, rawFeedback, findings }) {
    const candidate = this.requireCurrentCandidate(candidateId, expectedRevision, "awaiting_user_decision");
    if (!["accept", "continue_iteration", "reject"].includes(decision)) throw new ApplicationError("CANDIDATE_DECISION_INVALID", "candidate decision must be accept, continue_iteration, or reject");
    if (!hasText(rawFeedback)) throw new ApplicationError("FEEDBACK_REQUIRED", "raw user feedback is required");
    this.assertCandidateBaseCurrent(candidate);
    const normalizedFindings = normalizeFeedbackFindings(findings, {
      targetKind: candidate.target_kind, targetId: candidate.target_id, decision, actor: "user"
    });
    const repeatedFingerprints = decision === "reject"
      ? repeatedRootCauseFingerprints(this.store.listEntities(this.projectId, "candidate_feedback"), candidate.target_id, normalizedFindings)
      : [];
    const forceReconstruction = repeatedFingerprints.length > 0;
    const id = nextId("feedback", this.store.listEntities(this.projectId, "candidate_feedback"));
    const feedback = this.store.saveEntity(this.projectId, createV1Entity("candidate_feedback", id, {
      candidate_id: candidate.id, target_id: candidate.target_id, target_kind: candidate.target_kind, actor: "user",
      decision, raw_feedback: rawFeedback, findings: normalizedFindings,
      ...(repeatedFingerprints.length ? { reconstruction_fingerprints: repeatedFingerprints } : {}),
      force_reconstruction: forceReconstruction, candidate_revision: candidate.revision, base_revision: candidate.base_revision
    }));
    const state = decision === "accept" ? "accepted" : decision === "continue_iteration" ? "continued" : forceReconstruction ? "reconstruction_required" : "rejected";
    const updated = this.store.saveEntity(this.projectId, { ...stripRevision(candidate), state, decision_feedback_id: feedback.id });
    return { candidate: updated, feedback, force_reconstruction: forceReconstruction };
  }

  candidateFeedback(candidateId) {
    this.requireEntity("candidate", candidateId);
    return this.store.listEntities(this.projectId, "candidate_feedback").filter((feedback) => feedback.candidate_id === candidateId);
  }

  candidateAttempts({ targetKind, targetId }) {
    this.findTarget(targetKind, targetId);
    return this.store.listEntities(this.projectId, "candidate").filter((candidate) => candidate.target_kind === targetKind && candidate.target_id === targetId)
      .sort((left, right) => left.attempt - right.attempt);
  }

  compareCandidates(leftId, rightId) {
    const left = this.requireEntity("candidate", leftId); const right = this.requireEntity("candidate", rightId);
    if (left.target_id !== right.target_id || left.target_kind !== right.target_kind) throw new ApplicationError("CANDIDATE_TARGET_MISMATCH", "candidates must target the same object");
    return { target: { kind: left.target_kind, id: left.target_id }, left: summarizeCandidate(left), right: summarizeCandidate(right), patch_changed: hashJson(left.patch) !== hashJson(right.patch) };
  }

  async freezeVersion() {
    await this.refresh();
    const errors = validateProject(this.project);
    if (errors.length) throw new ApplicationError("PROJECT_INVALID", "project cannot be frozen", { errors });
    await assertBoundaryGeneratedImages(this.project);
    const snapshot = Object.fromEntries(await Promise.all(CONTRACT_FILES.map(async (file) => [file, JSON.parse(await fs.readFile(path.join(this.project.root, file), "utf8"))])));
    const componentHashes = Object.fromEntries(Object.entries(snapshot).map(([file, value]) => [file, hashJson(value)]));
    const snapshotHash = hashJson(snapshot);
    const existing = this.store.listEntities(this.projectId, "version").find((version) => version.snapshot_hash === snapshotHash && version.state === "frozen");
    if (existing) return { ...existing, reused: true };
    const id = nextId("version", this.store.listEntities(this.projectId, "version"));
    await this.files.writeVersionSnapshot(id, snapshot);
    let version = this.store.saveEntity(this.projectId, createV1Entity("version", id, { state: "draft", snapshot_hash: snapshotHash, component_hashes: componentHashes }));
    for (const state of ["approval_pending", "approved", "frozen"]) version = this.store.saveEntity(this.projectId, { ...stripRevision(version), state });
    await this.files.writeManifest("version", id, stripRevision(version));
    return version;
  }

  async createBuild({ versionId, targets }) {
    const version = this.requireEntity("version", versionId);
    if (version.state !== "frozen") throw new ApplicationError("VERSION_NOT_FROZEN", "build input must be a Frozen Version");
    await assertBoundaryGeneratedImages(await this.projectFromVersion(versionId));
    const id = nextId("build", this.store.listBuilds(this.projectId));
    this.store.enqueueBuild(createV1Entity("build", id, { project_id: this.projectId, version_id: versionId, state: "queued", targets, attempts: [], config: {} }));
    return this.runBuild(id);
  }

  async retryBuild(buildId) {
    this.store.retryBuild(buildId);
    return this.runBuild(buildId);
  }

  async runReview(buildId) {
    const build = this.requireBuild(buildId);
    if (build.state !== "succeeded") throw new ApplicationError("BUILD_NOT_SUCCEEDED", "review requires a succeeded build");
    const frozenProject = await this.projectFromVersion(build.version_id);
    await assertBoundaryGeneratedImages(frozenProject);
    const pptxFile = build.targets.includes("pptx") ? resolveProjectPath(this.project.root, path.join(".pptops", "builds", buildId, "pptx", "slides.pptx")) : undefined;
    const htmlFile = build.targets.includes("html") ? resolveProjectPath(this.project.root, path.join(".pptops", "builds", buildId, "html", "slides.html")) : undefined;
    const report = await reviewProject(frozenProject, { pptxFile, htmlFile, htmlQa: Boolean(htmlFile), evidenceDir: resolveProjectPath(this.project.root, path.join(".pptops", "reviews", `build-${buildId}`, "evidence")) });
    const reportFile = await writeReviewReport(frozenProject, report);
    const id = nextId("review", this.store.listEntities(this.projectId, "review"));
    let review = this.store.saveEntity(this.projectId, createV1Entity("review", id, { build_id: buildId, state: "automated_pending", automated: report.automated_checks, human: report.acceptance, report_file: path.relative(this.project.root, reportFile) }));
    review = this.store.saveEntity(this.projectId, { ...stripRevision(review), state: "automated_complete" });
    review = this.store.saveEntity(this.projectId, { ...stripRevision(review), state: "human_pending" });
    await this.files.writeManifest("review", id, stripRevision(review));
    return { review, report };
  }

  async recordReview(reviewId, { decision, expectedRevision, evidence = {} }) {
    const review = this.requireEntity("review", reviewId);
    if (review.revision !== expectedRevision) throw new ApplicationError("STALE_OBJECT_REVISION", "review revision is stale", { expected: review.revision, received: expectedRevision });
    if (review.state !== "human_pending") throw new ApplicationError("REVIEW_NOT_PENDING", `review is not awaiting a decision: ${review.state}`);
    if (!["accepted", "rejected"].includes(decision)) throw new ApplicationError("REVIEW_DECISION_INVALID", "review decision must be accepted or rejected");
    const recorded = this.store.saveEntity(this.projectId, { ...stripRevision(review), state: decision, human: [...(review.human ?? []), { status: decision, evidence }] });
    return this.replaceManifest("review", review.id, stripRevision(recorded));
  }

  async createHandoff(buildId, reviewId) {
    const review = this.requireEntity("review", reviewId);
    if (review.state !== "accepted" || review.build_id !== buildId) throw new ApplicationError("REVIEW_NOT_ACCEPTED", "handoff requires an accepted review for the selected build");
    const frozenProject = await this.projectFromVersion(this.requireBuild(buildId).version_id);
    const boundaryImages = await assertBoundaryGeneratedImages(frozenProject);
    const report = await reviewProject(frozenProject);
    const sourceFiles = await this.buildHandoffFiles(buildId, review);
    const packageResult = await createHandoff(frozenProject, report, { sourceFiles, boundaryImages });
    const id = nextId("handoff", this.store.listEntities(this.projectId, "handoff"));
    let handoff = this.store.createHandoff(this.projectId, createV1Entity("handoff", id, { build_id: buildId, review_id: reviewId, state: "preparing", files: packageResult.manifest.outputs }));
    for (const state of ["packaged", "verified"]) handoff = this.store.saveEntity(this.projectId, { ...stripRevision(handoff), state });
    await this.files.writeManifest("handoff", id, stripRevision(handoff));
    return { handoff, manifest_file: packageResult.manifestFile, package_dir: packageResult.packageDir };
  }

  async buildHandoffFiles(buildId, review) {
    const build = this.requireBuild(buildId);
    const files = [];
    for (const target of build.targets) {
      const directory = resolveProjectPath(this.project.root, path.join(".pptops", "builds", buildId, target));
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        if (entry.isFile()) files.push({ name: entry.name, path: path.join(directory, entry.name) });
      }
    }
    if (review.report_file) {
      const report = resolveProjectPath(this.project.root, review.report_file);
      files.push({ name: path.basename(report), path: report });
    }
    return files.sort((left, right) => left.name.localeCompare(right.name));
  }

  async runBuild(buildId) {
    const claimed = this.store.claimNextBuild();
    if (!claimed || claimed.id !== buildId) throw new ApplicationError("BUILD_NOT_CLAIMED", `build could not be claimed: ${buildId}`);
    try {
      const project = await this.projectFromVersion(claimed.version_id);
      await assertBoundaryGeneratedImages(project);
      this.store.transitionBuild(buildId, "rendering");
      const artifacts = [];
      for (const target of claimed.targets) {
        if (!["html", "pptx"].includes(target)) throw new ApplicationError("TARGET_UNSUPPORTED", `renderer is unavailable for target: ${target}`);
        if (target === "html") artifacts.push(await this.files.writeBuildArtifact(buildId, target, "slides.html", await buildHtml(project)));
        else {
          const temporary = path.join(this.project.root, ".pptops", `render-${buildId}-${crypto.randomUUID()}.pptx`);
          await fs.mkdir(path.dirname(temporary), { recursive: true });
          try {
            await buildPptx(project, temporary);
            artifacts.push(await this.files.writeBuildArtifact(buildId, target, "slides.pptx", await fs.readFile(temporary)));
          } finally { await fs.rm(temporary, { force: true }); }
        }
      }
      this.store.transitionBuild(buildId, "validating");
      const result = this.store.transitionBuild(buildId, "succeeded");
      await this.files.writeManifest("build", buildId, result);
      return { build: result, artifacts };
    } catch (error) {
      this.store.transitionBuild(buildId, "failed", { error: { code: error.code ?? "BUILD_FAILED", message: error.message } });
      throw error;
    }
  }

  async projectFromVersion(versionId) {
    const snapshot = await this.files.readVersionSnapshot(versionId);
    const contracts = {
      project: snapshot["project.json"], sources: snapshot["sources.json"], outline: snapshot["outline.json"],
      pages: snapshot["pages.json"], theme: snapshot["theme.json"], assets: snapshot["assets.json"], templates: snapshot["templates.json"]
    };
    const sourceById = new Map(contracts.sources.map((source) => [source.id, source]));
    return {
      root: this.project.root,
      project: { schema_version: "1.0", name: contracts.project.id, title: contracts.project.title, format: contracts.project.format, source_files: contracts.sources.map(({ file }) => file), theme_file: "theme.json", assets_file: "assets.json", outputs: contracts.project.outputs },
      pages: contracts.pages.map((page) => {
        const reference = page.source_refs?.[0]; const source = reference ? sourceById.get(reference.source_id) : undefined;
        return { ...page, source: source ? `${source.file}${reference.locator ?? ""}` : undefined, html: page.renderers?.html, pptx: page.renderers?.pptx, status: page.content_status };
      }),
      theme: contracts.theme.tokens,
      assets: contracts.assets.map(({ contract_version, kind, sha256, bytes, mime, provenance, ...asset }) => asset),
      contractModel: "v1", contracts
    };
  }

  findTarget(kind, id) {
    const collection = COLLECTIONS[kind];
    const value = collection ? this.project.contracts[collection].find((item) => item.id === id) : this.project.contracts[kind];
    if (!value || value.id !== id) throw new ApplicationError("TARGET_NOT_FOUND", `unknown ${kind}: ${id}`);
    return value;
  }

  ensureTracked(entity) {
    return this.store.getEntity(this.projectId, entity.kind, entity.id) ?? this.store.saveEntity(this.projectId, entity);
  }

  requireEntity(kind, id) {
    const entity = this.store.getEntity(this.projectId, kind, id);
    if (!entity) throw new ApplicationError("OBJECT_NOT_FOUND", `unknown ${kind}: ${id}`);
    return entity;
  }

  requireBuild(id) {
    const build = this.store.getBuild(id);
    if (!build) throw new ApplicationError("OBJECT_NOT_FOUND", `unknown build: ${id}`);
    return build;
  }

  requireCurrentCandidate(id, expectedRevision, state) {
    const candidate = this.requireEntity("candidate", id);
    if (candidate.revision !== expectedRevision) throw new ApplicationError("STALE_OBJECT_REVISION", "candidate revision is stale", { expected: candidate.revision, received: expectedRevision });
    if (candidate.state !== state) throw new ApplicationError("ILLEGAL_RESUME_EVENT", `candidate ${candidate.id} is ${candidate.state}; expected ${state}`);
    return candidate;
  }

  assertCandidateBaseCurrent(candidate) {
    const current = this.ensureTracked(this.findTarget(candidate.target_kind, candidate.target_id));
    if (candidate.base_revision !== current.revision || candidate.base_hash !== hashJson(stripRevision(current))) throw new ApplicationError("STALE_BASE_REVISION", "candidate target changed after proposal");
  }

  async writeTarget(entity) {
    const collection = COLLECTIONS[entity.kind];
    if (!collection) throw new ApplicationError("TARGET_KIND_UNSUPPORTED", `candidate target kind is unsupported: ${entity.kind}`);
    const entities = this.project.contracts[collection].map((item) => item.id === entity.id ? entity : item);
    const file = { source: "sources.json", page_spec: "pages.json", asset: "assets.json", template: "templates.json" }[entity.kind];
    await atomicWriteJson(resolveProjectPath(this.project.root, file), entities);
    await this.refresh();
  }

  async refresh() { this.project = await readProject(this.project.root); }

  async replaceManifest(kind, id, value) {
    const relative = path.join(".pptops", `${kind}s`, id, "manifest.json");
    const file = resolveProjectPath(this.project.root, relative);
    await atomicWriteJson(file, value);
    return { ...value, revision: this.store.getEntity(this.projectId, kind, id).revision };
  }
}

async function atomicWriteJson(file, value) {
  const temporary = `${file}.tmp-${crypto.randomUUID()}`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  await fs.rename(temporary, file);
}
function nextId(prefix, entities) { return `${prefix}-${String(entities.length + 1).padStart(3, "0")}`; }
function stripRevision({ revision, ...entity }) { return entity; }
function hashJson(value) { return crypto.createHash("sha256").update(stableJson(value)).digest("hex"); }
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isPlainObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function deepMerge(base, patch) {
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) result[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : structuredClone(value);
  return result;
}
function isPlainObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function hasText(value) { return typeof value === "string" && value.trim() !== ""; }
function summarizeCandidate(candidate) { return { id: candidate.id, attempt: candidate.attempt, state: candidate.state, parent_candidate_id: candidate.parent_candidate_id, hypothesis: candidate.hypothesis, patch: candidate.patch, reconstruction: candidate.reconstruction }; }
function validateReconstruction(value, patch) {
  if (!isPlainObject(value)) throw new ApplicationError("RECONSTRUCTION_REQUIRED", "a semantic reconstruction record is required after repeated rejection");
  for (const field of ["page_task", "semantic_roles", "information_relationship", "visual_mapping_hypothesis", "discarded_hypothesis"]) if (!(field in value) || value[field] === null || value[field] === "") throw new ApplicationError("RECONSTRUCTION_REQUIRED", `semantic reconstruction field is required: ${field}`);
  for (const field of ["task", "three_second_message", "relation"]) if (!(field in patch)) throw new ApplicationError("RECONSTRUCTION_PATCH_INCOMPLETE", `semantic reconstruction patch must update ${field}`);
}
function validatePowerPointEvidence(evidence, rendered) {
  if (!isPlainObject(rendered)) throw new ApplicationError("CANDIDATE_NOT_RENDERED", "PowerPoint observation requires Candidate render evidence");
  if (evidence.application !== "Microsoft PowerPoint") throw new ApplicationError("POWERPOINT_EVIDENCE_INVALID", "viewed evidence must name Microsoft PowerPoint");
  if (evidence.artifact !== rendered.artifact || evidence.sha256 !== rendered.sha256 || JSON.stringify(evidence.pages) !== JSON.stringify(rendered.pages)) throw new ApplicationError("POWERPOINT_EVIDENCE_MISMATCH", "PowerPoint observation must reference the rendered Candidate artifact, hash, and pages");
}
