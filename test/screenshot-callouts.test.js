import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { buildPptx } from "../src/adapters/pptx.js";
import { readProject } from "../src/core/project.js";
import { inspectPptxStructure } from "../src/qa/index.js";
import { screenshotPlacement, visibleScreenshotRegion } from "../src/layout/screenshot.js";

const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 500"><rect width="1000" height="500" fill="white"/><rect x="250" y="125" width="500" height="250" fill="green"/></svg>';
const semantics = { content_role: "read_required", evidence_purpose: "The green region confirms success", focal_region: { x: 0.25, y: 0.25, width: 0.5, height: 0.5 }, presentation_treatments: ["callout", "annotation"] };
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-screenshot-native-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(path.resolve("examples/demo-project"), root, { recursive: true });
  await fs.writeFile(path.join(root, "assets", "screen.svg"), svg);
  const project = await readProject(root);
  project.assets = [{ id: "screen", type: "image", file: "assets/screen.svg", screenshot_evidence: structuredClone(semantics) }];
  project.pages[0].asset_slots = [{ asset_id: "screen", role: "evidence", fit: "contain" }];
  project.pages[1].asset_slots = [];
  return { root, project };
}

test("callouts preserve original screenshot bytes and generate editable focus and caption shapes", async (t) => {
  const { root, project } = await fixture(t);
  const file = path.join(root, "native.pptx");
  await buildPptx(project, file);
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  const xml = await zip.file("ppt/slides/slide1.xml").async("string");
  const shapes = [...xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)].map(([shape]) => shape);
  assert.ok(shapes.some((shape) => shape.includes('name="Decorative Screenshot focus screen"') && shape.includes('<a:prstGeom prst="rect"')));
  assert.ok(shapes.some((shape) => shape.includes('name="Screenshot caption screen"') && shape.includes(semantics.evidence_purpose)));
  const images = await Promise.all(Object.keys(zip.files).filter((name) => name.endsWith(".svg")).map((name) => zip.file(name).async("string")));
  assert.ok(images.includes(svg));
  const qa = await inspectPptxStructure(file, project);
  assert.equal(qa.findings.some(({ check }) => ["screenshot-placement-unresolved", "out-of-bounds", "unintended-overlap"].includes(check)), false);
  assert.equal(qa.screenshot_evidence.human_readability_assessed, false);
});

test("same-byte screenshots with different IDs are detected from the actual PPTX media", async (t) => {
  const { root, project } = await fixture(t);
  project.assets.push({ ...project.assets[0], id: "duplicate" });
  project.pages[1].asset_slots = [{ asset_id: "duplicate", role: "evidence" }];
  const file = path.join(root, "repeated.pptx");
  await buildPptx(project, file);
  const qa = await inspectPptxStructure(file, project);
  const repeated = qa.findings.find(({ check }) => check === "screenshot-evidence-repetition");
  assert.equal(repeated.asset_id, "duplicate");
  assert.equal(repeated.evidence.screenshot_identity, "sha256");
  assert.deepEqual(repeated.evidence.repeated_from_pages, [1]);
});

test("focus mapping accounts for contain letterboxing and cover cropping", () => {
  const bounds = { x: 2, y: 1, w: 4, h: 4 };
  const contain = screenshotPlacement(1000, 500, bounds);
  assert.deepEqual(contain.placement, { x: 2, y: 2, width: 4, height: 2 });
  assert.deepEqual(visibleScreenshotRegion(semantics.focal_region, contain.placement), { x: 3, y: 2.5, width: 2, height: 1 });
  const cover = screenshotPlacement(1000, 500, bounds, "cover");
  assert.deepEqual(visibleScreenshotRegion(semantics.focal_region, cover.placement), { x: 2, y: 2, width: 4, height: 2 });
  assert.equal(visibleScreenshotRegion({ x: 0, y: 0, width: 0.1, height: 0.1 }, cover.placement).width, 0);
});

test("annotation-only treatment is editable and oversized caption fails explicitly", async (t) => {
  const { root, project } = await fixture(t);
  project.assets[0].screenshot_evidence.presentation_treatments = ["annotation"];
  project.assets[0].screenshot_evidence.annotation_text = "Approved";
  const file = path.join(root, "annotation.pptx");
  await buildPptx(project, file);
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  assert.match(await zip.file("ppt/slides/slide1.xml").async("string"), /<a:t>Approved<\/a:t>/);
  project.assets[0].screenshot_evidence.annotation_text = "x".repeat(81);
  await assert.rejects(buildPptx(project, path.join(root, "invalid.pptx")), /annotation_text of 1–80/);
});
