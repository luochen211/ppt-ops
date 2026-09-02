import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { ApplicationService } from "../src/application/service.js";
import { initializeProject } from "../src/core/init.js";

const execFileAsync = promisify(execFile);
const cli = path.resolve("src/cli.js");
process.env.PPT_OPS_RENDER_QA = "0";

test("candidate commands enforce base and object revisions before applying a local patch", async (t) => {
  const project = await fixture(t);
  const service = await ApplicationService.open(project);
  t.after(() => service.close());

  const candidate = await service.proposeCandidate({ targetKind: "page_spec", targetId: "page-001", baseRevision: 1, patch: { screen_text: { title: "Accepted title" } } });
  assert.equal(candidate.state, "ready_for_review");
  assert.equal(service.diffCandidate(candidate.id).stale, false);
  await assert.rejects(service.acceptCandidate(candidate.id, candidate.revision - 1), { code: "STALE_OBJECT_REVISION" });
  const accepted = await service.acceptCandidate(candidate.id, candidate.revision);
  assert.equal(accepted.candidate.state, "applied_to_draft");
  assert.equal(accepted.target.screen_text.title, "Accepted title");
  assert.equal(JSON.parse(await fs.readFile(path.join(project, "pages.json"), "utf8"))[0].screen_text.title, "Accepted title");
});

test("a changed target makes an outstanding candidate stale", async (t) => {
  const project = await fixture(t);
  const service = await ApplicationService.open(project);
  t.after(() => service.close());
  const first = await service.proposeCandidate({ targetKind: "page_spec", targetId: "page-001", baseRevision: 1, patch: { task: "First" } });
  const second = await service.proposeCandidate({ targetKind: "page_spec", targetId: "page-001", baseRevision: 1, patch: { task: "Second" } });
  await service.acceptCandidate(first.id, first.revision);
  assert.equal(service.diffCandidate(second.id).stale, true);
  await assert.rejects(service.acceptCandidate(second.id, second.revision), { code: "STALE_BASE_REVISION" });
});

test("formal build, review, and handoff commands require a frozen version and accepted review", async (t) => {
  const project = await fixture(t);
  const service = await ApplicationService.open(project);
  t.after(() => service.close());

  await assert.rejects(service.createBuild({ versionId: "missing", targets: ["pptx"] }), { code: "OBJECT_NOT_FOUND" });
  const version = await service.freezeVersion();
  assert.equal(version.state, "frozen");
  assert.equal((await service.freezeVersion()).reused, true);
  const { build, artifacts } = await service.createBuild({ versionId: version.id, targets: ["pptx"] });
  assert.equal(build.state, "succeeded");
  assert.equal(artifacts[0].file, `.pptops/builds/${build.id}/pptx/slides.pptx`);
  const { review, report } = await service.runReview(build.id);
  const qa = report.automated_checks.find(({ id }) => id === "pptx-visual-qa");
  assert.ok(["passed", "pending"].includes(qa.status));
  assert.ok(qa.evidence.pages.every(({ page }) => Number.isInteger(page) && page > 0));
  assert.ok(report.acceptance.every(({ status }) => status === "pending"));
  await assert.rejects(service.createHandoff(build.id, review.id), { code: "REVIEW_NOT_ACCEPTED" });
  const accepted = await service.recordReview(review.id, { decision: "accepted", expectedRevision: review.revision, evidence: { reviewer: "test" } });
  const handoff = await service.createHandoff(build.id, accepted.id);
  assert.equal(handoff.handoff.state, "verified");
  const manifest = JSON.parse(await fs.readFile(handoff.manifest_file, "utf8"));
  assert.deepEqual(manifest.outputs.map(({ name }) => name), ["review-report.json", "slides.pptx"]);
});

test("CLI application commands return stable success and error envelopes", async (t) => {
  const project = await fixture(t);
  const frozen = JSON.parse((await runCli("version-freeze", project)).stdout);
  assert.equal(frozen.ok, true);
  assert.equal(frozen.data.state, "frozen");

  await assert.rejects(
    runCli("candidate-accept", project, "--candidate", "missing", "--expected-revision", "1"),
    (error) => {
      const response = JSON.parse(error.stderr.trim().split("\n").at(-1));
      assert.deepEqual({ ok: response.ok, code: response.error.code }, { ok: false, code: "OBJECT_NOT_FOUND" });
      return true;
    }
  );
});

async function fixture(t) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-application-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const project = path.join(parent, "project");
  await initializeProject(project, { title: "Application Commands" });
  return project;
}
function runCli(...args) { return execFileAsync(process.execPath, [cli, ...args], { encoding: "utf8" }); }
