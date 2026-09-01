import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cli = path.resolve("src/cli.js");

test("init creates a valid V1 project without overwriting an existing directory", async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-init-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const project = path.join(temporary, "launch-deck");

  const initialized = JSON.parse((await runCli("init", project, "--title", "Launch Deck")).stdout);
  assert.equal(initialized.name, "launch-deck");
  assert.equal(initialized.title, "Launch Deck");
  assert.equal(JSON.parse(await fs.readFile(path.join(project, "project.json"))).schema_version, "1.0");

  const validation = JSON.parse((await runCli("validate", project)).stdout);
  assert.deepEqual({ valid: validation.valid, page_count: validation.page_count }, { valid: true, page_count: 1 });
  await assert.rejects(runCli("init", project), /project directory is not empty/);
});

test("build all creates both renderers and deliver creates a complete package", async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-deliver-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const project = path.join(temporary, "client-deck");
  await runCli("init", project, "--title", "Client Deck");

  const build = JSON.parse((await runCli("build", project, "--format", "all")).stdout);
  assert.deepEqual(build.outputs.map(({ format }) => format), ["html", "pptx"]);
  await Promise.all(build.outputs.map(({ file }) => fs.access(file)));

  const delivery = JSON.parse((await runCli("deliver", project)).stdout);
  assert.equal(delivery.review.passed, true);
  assert.match(delivery.handoff.manifest_file, /package-001\/manifest\.json$/);
  const manifest = JSON.parse(await fs.readFile(delivery.handoff.manifest_file, "utf8"));
  assert.deepEqual(manifest.outputs.map(({ name }) => name), ["review-report.json", "slides.html", "slides.pptx"]);
});

test("V1 CLI rejects malformed page selections and unknown options", async () => {
  await assert.rejects(runCli("prototype", "examples/demo-project", "--pages", "1,nope"), /positive integers/);
  await assert.rejects(runCli("build", "examples/demo-project", "--unknown", "value"), /unknown option/);
});

test("version reports the stable package version", async () => {
  assert.equal((await runCli("--version")).stdout.trim(), "1.0.0");
});

function runCli(...args) {
  return execFileAsync(process.execPath, [cli, ...args], { encoding: "utf8" });
}
