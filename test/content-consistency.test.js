import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { inspectContentConsistency } from "../src/qa/content-consistency.js";

test("content consistency compares actual HTML and PPTX artifacts and records hashes", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-content-consistency-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const html = path.join(root, "slides.html");
  const pptx = path.join(root, "slides.pptx");
  await fs.writeFile(html, '<section class="slide" data-page="1"><h1 data-reading-key="title">标题</h1><p data-reading-key="message">完成 3 个任务</p><footer data-reading-key="footer"><span>任务</span><span>视觉</span></footer></section>');
  const zip = new JSZip();
  zip.file("ppt/slides/slide1.xml", '<p:sld><a:t>标题</a:t><a:t>完成 3 个任务</a:t><a:t>任务</a:t><a:t>视觉</a:t></p>');
  await fs.writeFile(pptx, await zip.generateAsync({ type: "nodebuffer" }));
  const report = await inspectContentConsistency({ htmlFile: html, pptxFile: pptx, buildRevision: "build-1" });
  assert.equal(report.status, "passed");
  assert.equal(report.page_count.html, 1);
  assert.equal(report.page_count.pptx, 1);
  assert.equal(report.artifacts.html.length, 64);
  assert.equal(report.build_revision, "build-1");
});

test("content consistency blocks numeric and page mismatches", async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-content-consistency-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const html = path.join(root, "slides.html");
  const pptx = path.join(root, "slides.pptx");
  await fs.writeFile(html, '<section class="slide" data-page="1"><h1 data-reading-key="title">标题</h1><p data-reading-key="message">完成 3 个任务</p></section><section class="slide" data-page="2"><h1 data-reading-key="title">第二页</h1></section>');
  const zip = new JSZip();
  zip.file("ppt/slides/slide1.xml", '<p:sld><a:t>标题</a:t><a:t>完成 4 个任务</a:t></p>');
  await fs.writeFile(pptx, await zip.generateAsync({ type: "nodebuffer" }));
  const report = await inspectContentConsistency({ htmlFile: html, pptxFile: pptx });
  assert.equal(report.status, "failed");
  assert.ok(report.findings.some(item => item.rule === "sensitive-token-mismatch"));
  assert.ok(report.findings.some(item => item.rule === "page-missing"));
});
