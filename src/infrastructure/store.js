import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { validateV1Entity } from "../contracts/v1.js";
import { canTransition } from "../core/state-machines.js";

const APPEND_ONLY_KINDS = new Set(["approval"]);
const RUNNING_BUILD_STATES = ["preparing", "rendering", "validating"];

export class InfrastructureStore {
  constructor(databaseFile) {
    const file = path.resolve(databaseFile);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.databaseFile = file;
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    this.migrate();
    this.recoverInterruptedBuilds();
  }

  close() { this.db.close(); }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects(
        id TEXT PRIMARY KEY, root_path TEXT NOT NULL UNIQUE, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS entities(
        project_id TEXT NOT NULL REFERENCES projects(id), kind TEXT NOT NULL, id TEXT NOT NULL,
        revision INTEGER NOT NULL, payload_json TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY(project_id, kind, id, revision)
      );
      CREATE TABLE IF NOT EXISTS builds(
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), version_id TEXT NOT NULL,
        state TEXT NOT NULL, targets_json TEXT NOT NULL, config_json TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, cancel_requested INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS build_attempts(
        build_id TEXT NOT NULL REFERENCES builds(id), attempt INTEGER NOT NULL, state TEXT NOT NULL,
        started_at TEXT NOT NULL, finished_at TEXT, error_json TEXT, PRIMARY KEY(build_id, attempt)
      );
      CREATE TABLE IF NOT EXISTS events(
        event_id TEXT PRIMARY KEY, job_id TEXT NOT NULL, sequence INTEGER NOT NULL, type TEXT NOT NULL,
        timestamp TEXT NOT NULL, data_json TEXT NOT NULL, UNIQUE(job_id, sequence)
      );
      INSERT OR IGNORE INTO schema_migrations(version, applied_at) VALUES(1, datetime('now'));
    `);
  }

  registerProject(project) {
    const now = timestamp();
    const root = path.resolve(project.root);
    this.db.prepare(`INSERT INTO projects(id, root_path, title, created_at, updated_at) VALUES(?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET root_path=excluded.root_path, title=excluded.title, updated_at=excluded.updated_at`)
      .run(project.id, root, project.title, now, now);
    return this.getProject(project.id);
  }

  getProject(id) { return this.db.prepare("SELECT id, root_path, title, created_at, updated_at FROM projects WHERE id = ?").get(id); }
  listProjects() { return this.db.prepare("SELECT id, root_path, title, created_at, updated_at FROM projects ORDER BY updated_at DESC, id").all(); }

  saveEntity(projectId, entity) {
    if (!this.getProject(projectId)) throw new Error(`unknown project: ${projectId}`);
    assertValidEntity(entity);
    const latest = this.getEntity(projectId, entity.kind, entity.id);
    if (latest) assertRevisionAllowed(latest, entity);
    const revision = (latest?.revision ?? 0) + 1;
    this.db.prepare("INSERT INTO entities(project_id, kind, id, revision, payload_json, created_at) VALUES(?, ?, ?, ?, ?, ?)")
      .run(projectId, entity.kind, entity.id, revision, JSON.stringify(entity), timestamp());
    return { ...entity, revision };
  }

  getEntity(projectId, kind, id) {
    const row = this.db.prepare("SELECT revision, payload_json FROM entities WHERE project_id=? AND kind=? AND id=? ORDER BY revision DESC LIMIT 1").get(projectId, kind, id);
    return row ? { ...JSON.parse(row.payload_json), revision: row.revision } : undefined;
  }

  listEntities(projectId, kind) {
    return this.db.prepare(`SELECT e.revision, e.payload_json FROM entities e JOIN (
      SELECT id, MAX(revision) revision FROM entities WHERE project_id=? AND kind=? GROUP BY id
    ) latest ON latest.id=e.id AND latest.revision=e.revision WHERE e.project_id=? AND e.kind=? ORDER BY e.id`)
      .all(projectId, kind, projectId, kind).map((row) => ({ ...JSON.parse(row.payload_json), revision: row.revision }));
  }

  enqueueBuild(build) {
    assertValidEntity(build, "build");
    if (build.state !== "queued") throw new Error("new builds must be queued");
    if (!this.getEntity(build.project_id, "version", build.version_id)) throw new Error(`unknown version: ${build.version_id}`);
    const now = timestamp();
    this.db.prepare("INSERT INTO builds(id, project_id, version_id, state, targets_json, config_json, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)")
      .run(build.id, build.project_id, build.version_id, build.state, JSON.stringify(build.targets), JSON.stringify(build.config ?? {}), now, now);
    this.appendEvent(build.id, "build.queued", { state: "queued" });
    return this.getBuild(build.id);
  }

  claimNextBuild() {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const build = this.db.prepare("SELECT * FROM builds WHERE state='queued' AND cancel_requested=0 ORDER BY created_at, id LIMIT 1").get();
      if (!build) { this.db.exec("COMMIT"); return undefined; }
      const attempt = this.db.prepare("SELECT COALESCE(MAX(attempt), 0) + 1 next FROM build_attempts WHERE build_id=?").get(build.id).next;
      const now = timestamp();
      this.db.prepare("UPDATE builds SET state='preparing', updated_at=? WHERE id=? AND state='queued'").run(now, build.id);
      this.db.prepare("INSERT INTO build_attempts(build_id, attempt, state, started_at) VALUES(?, ?, 'running', ?)").run(build.id, attempt, now);
      this.appendEvent(build.id, "build.stage.started", { stage: "preparing", attempt });
      const claimed = { ...this.getBuild(build.id), attempt };
      this.db.exec("COMMIT");
      return claimed;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  transitionBuild(id, to, data = {}) {
    const build = this.getBuild(id);
    if (!build) throw new Error(`unknown build: ${id}`);
    if (!canTransition("build", build.state, to)) throw new Error(`invalid build transition: ${build.state} -> ${to}`);
    this.db.prepare("UPDATE builds SET state=?, updated_at=? WHERE id=?").run(to, timestamp(), id);
    if (["succeeded", "failed", "cancelled"].includes(to)) {
      this.db.prepare("UPDATE build_attempts SET state=?, finished_at=?, error_json=? WHERE build_id=? AND finished_at IS NULL")
        .run(to, timestamp(), data.error ? JSON.stringify(data.error) : null, id);
    }
    this.appendEvent(id, "build.state.changed", { from: build.state, to, ...data });
    return this.getBuild(id);
  }

  requestCancellation(id) {
    const build = this.getBuild(id);
    if (!build) throw new Error(`unknown build: ${id}`);
    if (["succeeded", "failed", "cancelled"].includes(build.state)) throw new Error(`cannot cancel terminal build: ${id}`);
    this.db.prepare("UPDATE builds SET cancel_requested=1, updated_at=? WHERE id=?").run(timestamp(), id);
    this.appendEvent(id, "build.cancel.requested", {});
    return this.getBuild(id);
  }

  retryBuild(id) {
    const build = this.getBuild(id);
    if (!build || !["failed", "cancelled"].includes(build.state)) throw new Error("only failed or cancelled builds can retry");
    this.db.prepare("UPDATE builds SET state='queued', cancel_requested=0, updated_at=? WHERE id=?").run(timestamp(), id);
    this.appendEvent(id, "build.retry.queued", { previous_state: build.state });
    return this.getBuild(id);
  }

  getBuild(id) {
    const row = this.db.prepare("SELECT * FROM builds WHERE id=?").get(id);
    return row ? decodeBuild(row) : undefined;
  }
  listBuilds(projectId) { return this.db.prepare("SELECT * FROM builds WHERE project_id=? ORDER BY created_at DESC, id").all(projectId).map(decodeBuild); }
  listAttempts(id) { return this.db.prepare("SELECT * FROM build_attempts WHERE build_id=? ORDER BY attempt").all(id).map((row) => ({ ...row, error: row.error_json ? JSON.parse(row.error_json) : null, error_json: undefined })); }
  listEvents(jobId, afterSequence = 0) { return this.db.prepare("SELECT * FROM events WHERE job_id=? AND sequence>? ORDER BY sequence").all(jobId, afterSequence).map(decodeEvent); }

  createHandoff(projectId, handoff) {
    const build = this.getBuild(handoff.build_id);
    if (!build || build.state !== "succeeded") throw new Error("handoff requires a succeeded build");
    const review = this.getEntity(projectId, "review", handoff.review_id);
    if (!review || review.state !== "accepted" || review.build_id !== build.id) throw new Error("handoff requires an accepted review for the selected build");
    return this.saveEntity(projectId, handoff);
  }

  recoverInterruptedBuilds() {
    const rows = this.db.prepare(`SELECT id, state FROM builds WHERE state IN (${RUNNING_BUILD_STATES.map(() => "?").join(",")})`).all(...RUNNING_BUILD_STATES);
    for (const row of rows) {
      const error = { code: "PROCESS_INTERRUPTED", stage: row.state };
      this.db.prepare("UPDATE build_attempts SET state='failed', finished_at=?, error_json=? WHERE build_id=? AND finished_at IS NULL").run(timestamp(), JSON.stringify(error), row.id);
      this.db.prepare("UPDATE builds SET state='queued', updated_at=? WHERE id=?").run(timestamp(), row.id);
      this.appendEvent(row.id, "build.recovered", error);
    }
    return rows.length;
  }

  appendEvent(jobId, type, data) {
    const sequence = this.db.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 next FROM events WHERE job_id=?").get(jobId).next;
    const event = { event_id: `evt_${jobId}_${String(sequence).padStart(6, "0")}`, job_id: jobId, sequence, type, timestamp: timestamp(), data };
    this.db.prepare("INSERT INTO events(event_id, job_id, sequence, type, timestamp, data_json) VALUES(?, ?, ?, ?, ?, ?)")
      .run(event.event_id, event.job_id, event.sequence, event.type, event.timestamp, JSON.stringify(data));
    return event;
  }
}

function decodeBuild(row) { return { contract_version: "1.0", kind: "build", id: row.id, project_id: row.project_id, version_id: row.version_id, state: row.state, targets: JSON.parse(row.targets_json), config: JSON.parse(row.config_json), cancel_requested: Boolean(row.cancel_requested), created_at: row.created_at, updated_at: row.updated_at }; }
function decodeEvent(row) { return { event_id: row.event_id, job_id: row.job_id, sequence: row.sequence, type: row.type, timestamp: row.timestamp, data: JSON.parse(row.data_json) }; }
function timestamp() { return new Date().toISOString(); }
function assertValidEntity(entity, expectedKind) { const errors = validateV1Entity(entity, expectedKind); if (errors.length) throw new Error(`invalid V1 entity:\n${errors.map((error) => `- ${error}`).join("\n")}`); }
function assertRevisionAllowed(previous, next) {
  if (APPEND_ONLY_KINDS.has(next.kind)) throw new Error(`${next.kind} is append-only: ${next.id}`);
  if (next.kind === "version") {
    if (previous.snapshot_hash !== next.snapshot_hash || JSON.stringify(previous.component_hashes) !== JSON.stringify(next.component_hashes)) throw new Error(`version snapshot is immutable: ${next.id}`);
    if (!canTransition("version", previous.state, next.state)) throw new Error(`invalid version transition: ${previous.state} -> ${next.state}`);
  }
  if (next.kind === "handoff" && (previous.build_id !== next.build_id || previous.review_id !== next.review_id || JSON.stringify(previous.files) !== JSON.stringify(next.files))) throw new Error(`handoff contents are immutable: ${next.id}`);
  if (["candidate", "review", "handoff"].includes(next.kind) && !canTransition(next.kind, previous.state, next.state)) throw new Error(`invalid ${next.kind} transition: ${previous.state} -> ${next.state}`);
}
