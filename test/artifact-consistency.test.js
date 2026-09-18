import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { buildHtml } from "../src/adapters/html.js";
import { buildPptx } from "../src/adapters/pptx.js";
import { readProject } from "../src/core/project.js";
import { inspectArtifactConsistency } from "../src/review/artifact-consistency.js";
import { reviewProject } from "../src/review/index.js";
import { writeMigratedProject } from "../src/migrations/foundation-to-v1.js";
import { seedAcceptedBoundaryImages } from "./support/accepted-boundaries.js";

test("compares generated artifacts and records their hashes and build identity", async (t) => {
  const { htmlFile, pptxFile } = await fixtures(t);
  const result = await inspectArtifactConsistency({ htmlFile, pptxFile, versionId: "version-001", buildId: "build-001" });
  assert.equal(result.status, "passed", JSON.stringify(result.evidence.differences));
  assert.equal(result.evidence.version_id, "version-001");
  assert.equal(result.evidence.build_id, "build-001");
  assert.match(result.evidence.artifacts.pptx.sha256, /^[a-f0-9]{64}$/);
  assert.ok(result.evidence.not_checked.includes("diagrams, charts and tables"));
});

test("flags a changed number in the actual PPTX slide", async (t) => {
  const { htmlFile, pptxFile } = await fixtures(t);
  const zip = await JSZip.loadAsync(await fs.readFile(pptxFile));
  const slide = zip.file("ppt/slides/slide2.xml");
  const xml = await slide.async("string");
  const changed = xml.replace("一份页面定义，两种交付载体", "一份页面定义，9 种交付载体");
  assert.notEqual(changed, xml);
  zip.file("ppt/slides/slide2.xml", changed);
  await fs.writeFile(pptxFile, await zip.generateAsync({ type: "nodebuffer" }));
  const result = await inspectArtifactConsistency({ htmlFile, pptxFile });
  assert.equal(result.status, "failed");
  assert.ok(result.evidence.differences.some((difference) => difference.type === "critical_content_mismatch"));
});

test("reports a missing PPTX page separately", async (t) => {
  const { htmlFile, pptxFile } = await fixtures(t);
  const zip = await JSZip.loadAsync(await fs.readFile(pptxFile));
  zip.remove("ppt/slides/slide2.xml");
  await fs.writeFile(pptxFile, await zip.generateAsync({ type: "nodebuffer" }));
  const result = await inspectArtifactConsistency({ htmlFile, pptxFile });
  assert.equal(result.status, "failed");
  assert.ok(result.evidence.differences.some((difference) => difference.type === "page_missing"));
});

test("detects a missing unit in visible body text but ignores layout whitespace", async (t) => {
  const { htmlFile, pptxFile } = await fixtures(t);
  const original = await fs.readFile(htmlFile, "utf8");
  assert.match(original, /HTML 预览 5 天/);
  await fs.writeFile(htmlFile, original.replace("HTML 预览 5 天", "HTML 预览 5"));
  let result = await inspectArtifactConsistency({ htmlFile, pptxFile });
  assert.equal(result.status, "failed");
  assert.ok(result.evidence.differences.some((difference) => difference.type === "critical_content_mismatch" && difference.field === "body"));
  await fs.writeFile(htmlFile, original.replace("HTML 预览 5 天", "HTML 预览\n 5 天"));
  result = await inspectArtifactConsistency({ htmlFile, pptxFile });
  assert.equal(result.status, "passed", JSON.stringify(result.evidence.differences));
});

test("treats an unreadable artifact as failed rather than consistent", async (t) => {
  const { htmlFile, pptxFile } = await fixtures(t);
  await fs.writeFile(pptxFile, "not a PPTX");
  const result = await inspectArtifactConsistency({ htmlFile, pptxFile });
  assert.equal(result.status, "failed");
  assert.ok(result.evidence.extraction_error);
});

test("Review blocks a dual-format build with a missing artifact", async (t) => {
  const { project, htmlFile, pptxFile } = await fixtures(t);
  await fs.rm(pptxFile);
  const report = await reviewProject(project, { htmlFile, pptxFile, htmlQa: false,
    requireArtifactConsistency: true, versionId: "version-001", buildId: "build-001", render: false });
  assert.equal(report.passed, false);
  assert.equal(report.automated_checks.find((check) => check.id === "html-pptx-content-consistency")?.status, "failed");
});

async function fixtures(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-consistency-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const projectDir = path.join(root, "project");
  await writeMigratedProject(path.resolve("examples/demo-project"), projectDir);
  await seedAcceptedBoundaryImages(projectDir);
  const project = await readProject(projectDir);
  project.pages[1].screen_text.body = ["HTML 预览 5 天", "PPTX 编辑"];
  project.pages.push({ ...project.pages[1], page: 3, screen_text: { title: "结束" } });
  const htmlFile = path.join(root, "slides.html");
  const pptxFile = path.join(root, "slides.pptx");
  await fs.writeFile(htmlFile, await buildHtml(project));
  await buildPptx(project, pptxFile);
  return { project, htmlFile, pptxFile };
}
