import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { buildPptx, validatePptx } from "../src/adapters/pptx.js";
import { readProject } from "../src/core/project.js";

async function withDemoBuild(t) {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "ppt-ops-pptx-"));
  t.after(() => fs.rm(outputDir, { recursive: true, force: true }));
  const project = await readProject(path.resolve("examples/demo-project"));
  const outputFile = path.join(outputDir, "nested", "demo.pptx");
  const result = await buildPptx(project, outputFile);
  return { project, outputFile, result, zip: await JSZip.loadAsync(await fs.readFile(outputFile)) };
}

test("demo project builds a structurally valid editable 16:9 PPTX", async (t) => {
  const { outputFile, result, zip } = await withDemoBuild(t);
  assert.equal(result.outputFile, outputFile);
  assert.equal(result.slideCount, 2);
  assert.deepEqual(result.checks, {
    archiveStructure: true,
    slideCount: true,
    wideLayout: true,
    nonNegativeGeometry: true
  });

  const presentation = await zip.file("ppt/presentation.xml").async("string");
  const dimensions = presentation.match(/<p:sldSz\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/);
  assert.ok(dimensions);
  assert.ok(Math.abs((Number(dimensions[1]) / Number(dimensions[2])) - (16 / 9)) < 0.002);
  assert.ok(zip.file("ppt/slides/slide1.xml"));
  assert.ok(zip.file("ppt/slides/slide2.xml"));
});

test("boundary slides keep only one title while fonts and standard shapes stay native", async (t) => {
  const { project, zip } = await withDemoBuild(t);
  const slideXml = await Promise.all([1, 2].map((number) => zip.file(`ppt/slides/slide${number}.xml`).async("string")));
  const combined = slideXml.join("\n");

  for (const page of project.pages) {
    assert.match(combined, new RegExp(escapeRegExp(page.screen_text.title)));
    for (const line of page.screen_text.body ?? []) assert.doesNotMatch(combined, new RegExp(escapeRegExp(line)));
    assert.doesNotMatch(combined, new RegExp(escapeRegExp(page.three_second_message)));
    assert.doesNotMatch(combined, new RegExp(escapeRegExp(page.task)));
  }
  assert.match(combined, /<a:t>[^<]+<\/a:t>/);
  assert.match(combined, /<p:sp>/);
  assert.match(combined, new RegExp(`typeface="${escapeRegExp(project.theme.typography.heading_font)}"`));
  for (const color of [project.theme.colors.background, project.theme.colors.text]) {
    assert.match(combined, new RegExp(`<a:srgbClr val="${color.slice(1).toUpperCase()}"`));
  }
  assert.doesNotMatch(combined, /<(?:a|p):(?:off|ext|chOff|chExt)\b[^>]*\b(?:x|y|cx|cy)="-\d+"/);
});

test("structural validation rejects a mismatched slide count", async (t) => {
  const { outputFile } = await withDemoBuild(t);
  await assert.rejects(validatePptx(outputFile, 3), /expected 3 slides, found 2/);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
