import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildPptx } from "../src/adapters/pptx.js";
import { readProject } from "../src/core/project.js";
import { inspectPptxStructure, renderPresentation } from "../src/qa/index.js";

test("structural QA emits page-addressable checks for a representative PPTX", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-qa-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const project = await readProject("examples/demo-project");
  const pptx = path.join(directory, "slides.pptx");
  await buildPptx(project, pptx);
  const result = await inspectPptxStructure(pptx, project);
  assert.equal(result.pages.length, project.pages.length);
  assert.ok(result.pages.every(({ page, checks }) => page > 0 && checks.includes("out-of-bounds") && checks.includes("font-substitution")));
  assert.ok(result.findings.every(({ page, check, severity }) => Number.isInteger(page) && check && severity));
});

test("rendering degrades explicitly when no local renderer exists", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-render-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const result = await renderPresentation({
    pptxFile: path.join(directory, "slides.pptx"),
    evidenceDir: path.join(directory, "evidence"),
    commands: { powerpoint: path.join(directory, "missing-powerpoint"), libreoffice: path.join(directory, "missing-libreoffice"), pdftoppm: path.join(directory, "missing-pdftoppm"), magick: path.join(directory, "missing-magick"), exec: async () => {} }
  });
  assert.deepEqual({ status: result.status, page_images: result.page_images }, { status: "degraded", page_images: [] });
  assert.match(result.reason, /unavailable/);
});
