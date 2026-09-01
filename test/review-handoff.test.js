import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cli = path.resolve("src/cli.js");
const demo = path.resolve("examples/demo-project");

test("review writes machine-readable evidence with separate acceptance states", async (t) => {
  const project = await copyDemo(t);
  const { stdout } = await runCli("review", project);
  const report = JSON.parse(stdout);

  assert.equal(report.passed, true);
  assert.equal(report.required_failure_count, 0);
  assert.equal(report.automated_checks[0].kind, "automated");
  assert.equal(report.automated_checks[0].status, "passed");
  assert.deepEqual(report.acceptance.map(({ kind, status }) => ({ kind, status })), [
    { kind: "visual", status: "pending" },
    { kind: "real_powerpoint", status: "pending" }
  ]);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(project, "outputs/review-report.json"), "utf8")), stripReportFile(report));
});

test("review exits non-zero and records required validation failures", async (t) => {
  const project = await copyDemo(t);
  const pagesFile = path.join(project, "pages.json");
  const pages = JSON.parse(await fs.readFile(pagesFile, "utf8"));
  pages[0].three_second_message = "";
  await fs.writeFile(pagesFile, JSON.stringify(pages));

  await assert.rejects(runCli("review", project), (error) => {
    const report = JSON.parse(error.stdout);
    assert.equal(report.passed, false);
    assert.equal(report.required_failure_count, 1);
    assert.equal(report.automated_checks[0].status, "failed");
    return error.code === 1;
  });
  const saved = JSON.parse(await fs.readFile(path.join(project, "outputs/review-report.json"), "utf8"));
  assert.equal(saved.passed, false);
});

test("handoff packages available outputs and never overwrites sources", async (t) => {
  const project = await copyDemo(t);
  const outputs = path.join(project, "outputs");
  await fs.mkdir(outputs, { recursive: true });
  const source = path.join(outputs, "slides.html");
  await fs.writeFile(source, "original artifact");

  const first = JSON.parse((await runCli("handoff", project)).stdout);
  const second = JSON.parse((await runCli("handoff", project)).stdout);

  assert.equal(first.source_outputs_preserved, true);
  assert.equal(await fs.readFile(source, "utf8"), "original artifact");
  assert.match(first.manifest_file, /package-001\/manifest\.json$/);
  assert.match(second.manifest_file, /package-002\/manifest\.json$/);
  assert.ok(first.outputs.some((output) => output.name === "slides.html" && output.sha256.length === 64));
  assert.ok(first.outputs.some((output) => output.name === "review-report.json"));
  assert.equal(first.acceptance.visual.pending, 1);
  assert.equal(first.acceptance.real_powerpoint.pending, 1);
});

async function copyDemo(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-review-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const project = path.join(temporary, "project");
  await fs.cp(demo, project, { recursive: true });
  await fs.rm(path.join(project, "outputs"), { recursive: true, force: true });
  return project;
}

function runCli(command, project) {
  return execFileAsync(process.execPath, [cli, command, project], { encoding: "utf8" });
}

function stripReportFile(report) {
  const { report_file, ...saved } = report;
  return saved;
}
