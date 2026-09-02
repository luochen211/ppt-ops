import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { buildHtml } from "../adapters/html.js";
import { buildPptx } from "../adapters/pptx.js";
import { createV1Entity } from "../contracts/v1.js";
import { readProject, resolveProjectPath } from "../core/project.js";
import { validateProject } from "../core/validate.js";
import { createHandoff } from "../handoff/index.js";
import { ProjectFileStore } from "../infrastructure/file-store.js";
import { InfrastructureStore } from "../infrastructure/store.js";
import { reviewProject, writeReviewReport } from "../review/index.js";

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

  async proposeCandidate({ targetKind, targetId, patch, baseRevision }) {
    if (!isPlainObject(patch)) throw new ApplicationError("PATCH_INVALID", "candidate patch must be a JSON object");
    const target = this.findTarget(targetKind, targetId);
    const current = this.ensureTracked(target);
    if (baseRevision !== current.revision) throw new ApplicationError("STALE_BASE_REVISION", "candidate base revision is stale", { expected: current.revision, received: baseRevision });
    const id = nextId("candidate", this.store.listEntities(this.projectId, "candidate"));
    const baseHash = hashJson(stripRevision(current));
    let candidate = createV1Entity("candidate", id, { target_id: targetId, target_kind: targetKind, state: "generated", base_revision: baseRevision, base_hash: baseHash, patch });
    candidate = this.store.saveEntity(this.projectId, candidate);
    candidate = this.store.saveEntity(this.projectId, { ...stripRevision(candidate), state: "validating" });
    candidate = this.store.saveEntity(this.projectId, { ...stripRevision(candidate), state: "ready_for_review" });
    return candidate;
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

  async acceptCandidate(candidateId, expectedRevision) {
    const candidate = this.requireEntity("candidate", candidateId);
    if (candidate.revision !== expectedRevision) throw new ApplicationError("STALE_OBJECT_REVISION", "candidate revision is stale", { expected: candidate.revision, received: expectedRevision });
    if (candidate.state !== "ready_for_review") throw new ApplicationError("CANDIDATE_NOT_REVIEWABLE", `candidate is not ready for review: ${candidate.state}`);
    const target = this.findTarget(candidate.target_kind, candidate.target_id);
    const current = this.ensureTracked(target);
    if (candidate.base_revision !== current.revision || candidate.base_hash !== hashJson(stripRevision(current))) {
      throw new ApplicationError("STALE_BASE_REVISION", "candidate target changed after proposal");
    }
    const updated = deepMerge(target, candidate.patch);
    if (updated.id !== target.id || updated.kind !== target.kind) throw new ApplicationError("TARGET_IDENTITY_CHANGED", "candidate cannot change target kind or id");
    await this.writeTarget(updated);
    const savedTarget = this.store.saveEntity(this.projectId, updated);
    let accepted = this.store.saveEntity(this.projectId, { ...stripRevision(candidate), state: "accepted" });
    accepted = this.store.saveEntity(this.projectId, { ...stripRevision(accepted), state: "applied_to_draft" });
    return { candidate: accepted, target: savedTarget };
  }

  async freezeVersion() {
    await this.refresh();
    const errors = validateProject(this.project);
    if (errors.length) throw new ApplicationError("PROJECT_INVALID", "project cannot be frozen", { errors });
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
    const report = await reviewProject(frozenProject);
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
    const report = await reviewProject(frozenProject);
    const sourceFiles = await this.buildHandoffFiles(buildId, review);
    const packageResult = await createHandoff(frozenProject, report, { sourceFiles });
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
      this.store.transitionBuild(buildId, "rendering");
      const project = await this.projectFromVersion(claimed.version_id);
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
      project: { schema_version: "1.0", name: contracts.project.id, title: contracts.project.title, format: contracts.project.format, source_files: contracts.sources.map(({ file }) => file), outputs: contracts.project.outputs },
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
