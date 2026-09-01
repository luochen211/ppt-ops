import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ProjectFileStore } from "../src/infrastructure/file-store.js";
import { createLocalApi } from "../src/infrastructure/local-api.js";
import { InfrastructureStore } from "../src/infrastructure/store.js";

const digest = "a".repeat(64);
const entity = (kind, id, fields = {}) => ({ contract_version: "1.0", kind, id, ...fields });

test("durable queue preserves attempts across failure and retry", async (t) => {
  const fixture = await setup(t);
  const store = fixture.store;
  seedProjectAndVersion(store, fixture.root);
  store.enqueueBuild(build("build-001", { targets: ["html", "pptx"], config: { quality: "standard" } }));
  assert.equal(store.claimNextBuild().attempt, 1);
  store.transitionBuild("build-001", "rendering");
  store.transitionBuild("build-001", "failed", { error: { code: "RENDER_FAILED" } });
  store.retryBuild("build-001");
  assert.equal(store.claimNextBuild().attempt, 2);
  store.transitionBuild("build-001", "rendering");
  store.transitionBuild("build-001", "validating");
  store.transitionBuild("build-001", "succeeded");
  assert.deepEqual(store.listAttempts("build-001").map(({ attempt, state }) => ({ attempt, state })), [{ attempt: 1, state: "failed" }, { attempt: 2, state: "succeeded" }]);
  assert.deepEqual(store.getBuild("build-001").config, { quality: "standard" });
  assert.ok(store.listEvents("build-001").every((event, index) => event.sequence === index + 1));
});

test("opening the store recovers interrupted work without deleting evidence", async (t) => {
  const fixture = await setup(t);
  seedProjectAndVersion(fixture.store, fixture.root);
  fixture.store.enqueueBuild(build("build-recovery"));
  fixture.store.claimNextBuild();
  fixture.store.transitionBuild("build-recovery", "rendering");
  fixture.store.close();
  fixture.closed = true;

  const reopened = new InfrastructureStore(fixture.database);
  t.after(() => reopened.close());
  assert.equal(reopened.getBuild("build-recovery").state, "queued");
  assert.equal(reopened.listAttempts("build-recovery")[0].error.code, "PROCESS_INTERRUPTED");
  assert.equal(reopened.listEvents("build-recovery").at(-1).type, "build.recovered");
  assert.equal(reopened.claimNextBuild().attempt, 2);
});

test("cancellation is persisted and prevents queued work from being claimed", async (t) => {
  const { store, root } = await setup(t);
  seedProjectAndVersion(store, root);
  store.enqueueBuild(build("build-cancel"));
  assert.equal(store.requestCancellation("build-cancel").cancel_requested, true);
  assert.equal(store.claimNextBuild(), undefined);
  assert.equal(store.transitionBuild("build-cancel", "cancelled").state, "cancelled");
});

test("version snapshots and handoffs are immutable and handoff requires accepted review", async (t) => {
  const { store, root } = await setup(t);
  seedProjectAndVersion(store, root);
  assert.throws(() => store.saveEntity("demo", { ...version(), state: "draft", snapshot_hash: "b".repeat(64) }), /version snapshot is immutable/);
  store.enqueueBuild(build("build-final", { targets: ["pptx"] }));
  store.claimNextBuild();
  store.transitionBuild("build-final", "rendering"); store.transitionBuild("build-final", "validating"); store.transitionBuild("build-final", "succeeded");
  store.saveEntity("demo", entity("review", "review-001", { build_id: "build-final", state: "human_pending", automated: [], human: [] }));
  const handoff = entity("handoff", "handoff-001", { build_id: "build-final", review_id: "review-001", state: "verified", files: [] });
  assert.throws(() => store.createHandoff("demo", handoff), /accepted review/);
  store.saveEntity("demo", entity("review", "review-001", { build_id: "build-final", state: "accepted", automated: [], human: [{ status: "accepted" }] }));
  assert.equal(store.createHandoff("demo", handoff).revision, 1);
  assert.throws(() => store.createHandoff("demo", handoff), /invalid handoff transition/);
});

test("filesystem storage is contained, immutable, and separates concurrent builds", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-files-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const store = new ProjectFileStore(root);
  const first = await store.writeVersionSnapshot("version-001", { pages: [1], title: "Demo" });
  assert.equal(first.file, ".pptops/versions/version-001/snapshot.json");
  await assert.rejects(store.writeVersionSnapshot("version-001", { pages: [2] }), /already exists/);
  await store.writeVersionSnapshot("version-002", { pages: [1, 2], title: "Demo" });
  assert.deepEqual(await store.diffVersions("version-001", "version-002"), [{ path: "/pages/1", before: undefined, after: 2 }]);
  const [html, pptx] = await Promise.all([
    store.writeBuildArtifact("build-a", "html", "slides.html", "<html></html>"),
    store.writeBuildArtifact("build-b", "pptx", "slides.pptx", "pptx")
  ]);
  assert.notEqual(html.file, pptx.file);
  await assert.rejects(store.writeImmutable("../outside.txt", "no"), /escapes project root/);
});

test("loopback API exposes projects, builds, attempts, and replayable events", async (t) => {
  const { store, root } = await setup(t);
  seedProjectAndVersion(store, root);
  const api = createLocalApi(store);
  t.after(() => api.close());
  const listening = await api.listen();
  const health = await fetch(`${listening.url}/health`).then((response) => response.json());
  assert.equal(health.status, "ok");
  const created = await fetch(`${listening.url}/builds`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(build("build-api")) });
  assert.equal(created.status, 202);
  store.claimNextBuild();
  const details = await fetch(`${listening.url}/builds/build-api`).then((response) => response.json());
  assert.equal(details.attempts.length, 1);
  const events = await fetch(`${listening.url}/jobs/build-api/events?after=1`).then((response) => response.json());
  assert.ok(events.events.length >= 1);
  assert.ok(events.events.every(({ sequence }) => sequence > 1));
  assert.throws(() => createLocalApi(store, { host: "0.0.0.0" }), /loopback/);
});

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-infra-"));
  const database = path.join(root, "metadata.sqlite");
  const fixture = { root, database, store: new InfrastructureStore(database), closed: false };
  t.after(async () => { if (!fixture.closed) fixture.store.close(); await fs.rm(root, { recursive: true, force: true }); });
  return fixture;
}
function seedProjectAndVersion(store, root) { store.registerProject({ id: "demo", root, title: "Demo" }); store.saveEntity("demo", version()); }
function version() { return entity("version", "version-001", { state: "frozen", snapshot_hash: digest, component_hashes: {} }); }
function build(id, overrides = {}) { return entity("build", id, { project_id: "demo", version_id: "version-001", state: "queued", targets: ["html"], attempts: [], config: {}, ...overrides }); }
