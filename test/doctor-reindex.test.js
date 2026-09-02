import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { ApplicationService } from "../src/application/service.js";
import { initializeProject } from "../src/core/init.js";
import { reindexProject, runDoctor } from "../src/doctor/index.js";
import { InfrastructureStore } from "../src/infrastructure/store.js";

const execFileAsync = promisify(execFile);
const cli = path.resolve("src/cli.js");
process.env.PPT_OPS_RENDER_QA = "0";

test("doctor reports required failures separately from optional degraded tools", async (t) => {
  const project = await fixture(t);
  const before = await runDoctor(project);
  assert.equal(before.ok, false);
  assert.equal(before.checks.find(({ id }) => id === "portable-truth").status, "failed");

  const service = await ApplicationService.open(project);
  await service.freezeVersion();
  service.close();
  const after = await runDoctor(project);
  assert.equal(after.ok, true);
  assert.ok(["passed", "degraded"].includes(after.status));
  for (const optional of after.checks.filter(({ required }) => !required)) assert.notEqual(optional.status, "failed");
});

test("doctor CLI supports system-only diagnostics and structured project diagnostics", async (t) => {
  const system = JSON.parse((await execFileAsync(process.execPath, [cli, "doctor"], { encoding: "utf8" })).stdout);
  assert.equal(system.command, "doctor");
  assert.equal(system.ok, true);
  const project = await fixture(t);
  await assert.rejects(execFileAsync(process.execPath, [cli, "doctor", project], { encoding: "utf8" }), (error) => {
    const report = JSON.parse(error.stdout);
    assert.equal(report.checks.find(({ id }) => id === "portable-truth").status, "failed");
    return true;
  });
});

test("reindex restores portable Version, Build, Review, and Handoff truth deterministically", async (t) => {
  const project = await fixture(t);
  const service = await ApplicationService.open(project);
  const version = await service.freezeVersion();
  const { build } = await service.createBuild({ versionId: version.id, targets: ["pptx"] });
  const { review } = await service.runReview(build.id);
  const accepted = await service.recordReview(review.id, { decision: "accepted", expectedRevision: review.revision, evidence: { reviewer: "fixture" } });
  const { handoff } = await service.createHandoff(build.id, accepted.id);
  service.close();

  const database = path.join(project, ".pptops", "metadata.sqlite");
  await fs.rm(database, { force: true });
  const first = await reindexProject(project);
  const second = await reindexProject(project);
  assert.deepEqual(first.counts, { version: 1, build: 1, review: 1, handoff: 1 });
  assert.deepEqual(second, first);

  const store = new InfrastructureStore(database);
  t.after(() => store.close());
  assert.equal(store.getEntity("project", "version", version.id).state, "frozen");
  assert.equal(store.getEntity("project", "review", accepted.id).state, "accepted");
  assert.equal(store.getBuild(build.id).state, "succeeded");
  assert.equal(store.getEntity("project", "handoff", handoff.id).state, "verified");
});

async function fixture(t) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-doctor-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const project = path.join(parent, "project");
  await initializeProject(project, { title: "Doctor Fixture" });
  return project;
}
