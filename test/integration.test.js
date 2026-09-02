import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

process.env.PPT_OPS_RENDER_QA = "0";
import { validatePptx } from "../src/adapters/pptx.js";
import { writeMigratedProject } from "../src/migrations/foundation-to-v1.js";
import { seedAcceptedBoundaryImages } from "./support/accepted-boundaries.js";

const execFileAsync = promisify(execFile);
const cli = path.resolve("src/cli.js");
const demo = path.resolve("examples/demo-project");

test("a migrated deck with accepted boundary images builds both formats, reviews, and packages a handoff", async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-integration-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const project = path.join(temporary, "demo-project");
  await writeMigratedProject(demo, project);
  await seedAcceptedBoundaryImages(project);

  const cleanReview = JSON.parse((await runCli("review", project)).stdout);
  assert.equal(cleanReview.passed, true);
  assert.deepEqual(cleanReview.automated_checks[1].evidence.files, []);

  await runCli("build", project, "--format", "html");
  await runCli("build", project, "--format", "pptx");

  const htmlFile = path.join(project, "outputs", "slides.html");
  const pptxFile = path.join(project, "outputs", "slides.pptx");
  const html = await fs.readFile(htmlFile, "utf8");
  assert.match(html, /^<!doctype html>/);
  assert.equal((html.match(/<section class="slide /g) ?? []).length, 2);
  await validatePptx(pptxFile, 2);
  await assert.rejects(fs.access(path.join(project, "outputs", "html-build-plan.json")));
  await assert.rejects(fs.access(path.join(project, "outputs", "pptx-build-plan.json")));

  const review = JSON.parse((await runCli("review", project)).stdout);
  assert.equal(review.passed, true);
  assert.deepEqual(review.automated_checks[1].evidence.files, ["slides.html", "slides.pptx"]);

  const handoff = JSON.parse((await runCli("handoff", project)).stdout);
  assert.deepEqual(handoff.outputs.map(({ name }) => name), [
    "review-report.json",
    "slides.html",
    "slides.pptx"
  ]);
  assert.equal(handoff.acceptance.visual.pending, 1);
  assert.equal(handoff.acceptance.real_powerpoint.pending, 1);
  assert.deepEqual(handoff.boundary_images.map(({ boundary, page_id }) => ({ boundary, page_id })), [
    { boundary: "first", page_id: "page-001" },
    { boundary: "final", page_id: "page-002" }
  ]);
  await fs.access(handoff.manifest_file);
});

function runCli(...args) {
  return execFileAsync(process.execPath, [cli, ...args], { encoding: "utf8" });
}
