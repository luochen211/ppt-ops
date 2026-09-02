import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ApplicationService } from "../src/application/service.js";
import { initializeProject } from "../src/core/init.js";
import { readProject } from "../src/core/project.js";
import { assertBoundaryGeneratedImages, inspectBoundaryGeneratedImages } from "../src/visual-assets/boundary-policy.js";
import { seedAcceptedBoundaryImages } from "./support/accepted-boundaries.js";

test("multi-page boundary inspection reports both missing page ids", async (t) => {
  const projectRoot = await projectFixture(t, 2);
  const result = await inspectBoundaryGeneratedImages(await readProject(projectRoot));
  assert.equal(result.passed, false);
  assert.deepEqual(result.failures.map(({ boundary, page_id, code }) => ({ boundary, page_id, code })), [
    { boundary: "first", page_id: "page-001", code: "generated_image_missing" },
    { boundary: "final", page_id: "page-002", code: "generated_image_missing" }
  ]);
});

test("a static image and forged generated metadata cannot satisfy a boundary", async (t) => {
  const projectRoot = await projectFixture(t, 2);
  const projectFile = path.join(projectRoot, "project.json");
  const assetsFile = path.join(projectRoot, "assets.json");
  const pagesFile = path.join(projectRoot, "pages.json");
  const project = JSON.parse(await fs.readFile(projectFile, "utf8"));
  const pages = JSON.parse(await fs.readFile(pagesFile, "utf8"));
  const provenance = { brief_id: "forged-brief", generation_id: "forged-generation", prompt_sha256: "0".repeat(64), provider: "forged", model: "forged", decision_id: "forged-decision" };
  const assets = [
    { contract_version: "1.0", kind: "asset", id: "static-cover", type: "image", file: "assets/static.png", sha256: "0".repeat(64) },
    { contract_version: "1.0", kind: "asset", id: "forged-final", type: "generated_image", file: "assets/forged.png", sha256: "0".repeat(64), bytes: 1, mime: "image/png", width: 1, height: 1, provenance }
  ];
  project.asset_ids = assets.map(({ id }) => id);
  pages[0].asset_slots = [{ role: "hero", asset_id: "static-cover", fit: "cover" }];
  pages[1].asset_slots = [{ role: "hero", asset_id: "forged-final", fit: "cover" }];
  await Promise.all([
    fs.writeFile(projectFile, `${JSON.stringify(project, null, 2)}\n`),
    fs.writeFile(assetsFile, `${JSON.stringify(assets, null, 2)}\n`),
    fs.writeFile(pagesFile, `${JSON.stringify(pages, null, 2)}\n`)
  ]);
  const result = await inspectBoundaryGeneratedImages(await readProject(projectRoot));
  assert.deepEqual(result.failures.map(({ boundary, code }) => ({ boundary, code })), [
    { boundary: "first", code: "generated_image_missing" },
    { boundary: "final", code: "generation_evidence_missing" }
  ]);
});

test("multi-page projects pass only after first and final generated assets are independently accepted", async (t) => {
  const projectRoot = await projectFixture(t, 3);
  await seedAcceptedBoundaryImages(projectRoot, { pageIds: ["page-001"] });
  let result = await inspectBoundaryGeneratedImages(await readProject(projectRoot));
  assert.equal(result.passed, false);
  assert.deepEqual(result.failures.map(({ boundary, page_id }) => ({ boundary, page_id })), [{ boundary: "final", page_id: "page-003" }]);

  await seedAcceptedBoundaryImages(projectRoot, { pageIds: ["page-003"] });
  result = await assertBoundaryGeneratedImages(await readProject(projectRoot));
  assert.equal(result.passed, true);
  assert.deepEqual(result.boundaries.map(({ boundary, page_id }) => ({ boundary, page_id })), [
    { boundary: "first", page_id: "page-001" },
    { boundary: "final", page_id: "page-003" }
  ]);
});

test("one accepted generated image satisfies both boundaries of a one-page deck", async (t) => {
  const projectRoot = await projectFixture(t, 1);
  await seedAcceptedBoundaryImages(projectRoot);
  const result = await assertBoundaryGeneratedImages(await readProject(projectRoot));
  assert.deepEqual(result.boundaries.map(({ boundary, page_id }) => ({ boundary, page_id })), [{ boundary: "first+final", page_id: "page-001" }]);
});

test("boundary pages reject every visible text field except one title", async (t) => {
  const projectRoot = await projectFixture(t, 2);
  await seedAcceptedBoundaryImages(projectRoot);
  const pagesFile = path.join(projectRoot, "pages.json");
  const pages = JSON.parse(await fs.readFile(pagesFile, "utf8"));
  pages[0].screen_text = { title: "Only title", body: ["Forbidden subtitle copy"] };
  pages[1].screen_text = { title: "Only title", subtitle: "Forbidden kicker" };
  await fs.writeFile(pagesFile, `${JSON.stringify(pages, null, 2)}\n`);

  const result = await inspectBoundaryGeneratedImages(await readProject(projectRoot));
  assert.deepEqual(result.failures.map(({ boundary, code }) => ({ boundary, code })), [
    { boundary: "first", code: "boundary_text_not_title_only" },
    { boundary: "final", code: "boundary_text_not_title_only" }
  ]);
});

test("deleted or contradictory immutable evidence invalidates an earlier registration", async (t) => {
  const projectRoot = await projectFixture(t, 1);
  const [{ generation, observation }] = await seedAcceptedBoundaryImages(projectRoot);
  await fs.rm(path.join(projectRoot, ".pptops", "visual-assets", "observations", generation.id, `${observation.id}.json`));
  await assert.rejects(assertBoundaryGeneratedImages(await readProject(projectRoot)), (error) => {
    assert.equal(error.code, "BOUNDARY_IMAGE_REQUIRED");
    assert.equal(error.details.failures[0].code, "visual_observation_missing");
    assert.match(error.message, /first\+final page page-001/);
    return true;
  });
});

test("foundation projects fail formal boundary inspection instead of receiving a compatibility bypass", async () => {
  const result = await inspectBoundaryGeneratedImages(await readProject("examples/demo-project"));
  assert.equal(result.passed, false);
  assert.equal(result.failures[0].code, "v1_project_required");
});

test("freeze, build, review, and handoff recheck boundary evidence before formal mutation", async (t) => {
  const projectRoot = await projectFixture(t, 1);
  let service = await ApplicationService.open(projectRoot);
  await assert.rejects(service.freezeVersion(), { code: "BOUNDARY_IMAGE_REQUIRED" });
  assert.equal(service.store.listEntities(service.projectId, "version").length, 0);
  service.close();

  const [{ generation, observation }] = await seedAcceptedBoundaryImages(projectRoot);
  const observationFile = path.join(projectRoot, ".pptops", "visual-assets", "observations", generation.id, `${observation.id}.json`);
  const observationBytes = await fs.readFile(observationFile);
  service = await ApplicationService.open(projectRoot);
  t.after(() => service.close());
  const version = await service.freezeVersion();

  await fs.rm(observationFile);
  await assert.rejects(service.createBuild({ versionId: version.id, targets: ["pptx"] }), { code: "BOUNDARY_IMAGE_REQUIRED" });
  assert.equal(service.store.listBuilds(service.projectId).length, 0);
  await fs.writeFile(observationFile, observationBytes);

  const { build } = await service.createBuild({ versionId: version.id, targets: ["pptx"] });
  await fs.rm(observationFile);
  await assert.rejects(service.runReview(build.id), { code: "BOUNDARY_IMAGE_REQUIRED" });
  assert.equal(service.store.listEntities(service.projectId, "review").length, 0);
  await fs.writeFile(observationFile, observationBytes);

  const { review } = await service.runReview(build.id);
  const accepted = await service.recordReview(review.id, { decision: "accepted", expectedRevision: review.revision, evidence: { reviewer: "fixture" } });
  await fs.rm(observationFile);
  await assert.rejects(service.createHandoff(build.id, accepted.id), { code: "BOUNDARY_IMAGE_REQUIRED" });
  assert.equal(service.store.listEntities(service.projectId, "handoff").length, 0);
});

async function projectFixture(t, pageCount) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-boundaries-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const projectRoot = path.join(parent, "project");
  await initializeProject(projectRoot, { name: "boundary-test", title: "Boundary Test" });
  if (pageCount > 1) {
    const pagesFile = path.join(projectRoot, "pages.json");
    const outlineFile = path.join(projectRoot, "outline.json");
    const pages = JSON.parse(await fs.readFile(pagesFile, "utf8"));
    const outline = JSON.parse(await fs.readFile(outlineFile, "utf8"));
    for (let page = 2; page <= pageCount; page++) {
      const id = `page-${String(page).padStart(3, "0")}`;
      pages.push({ ...structuredClone(pages[0]), id, page, task: `Page ${page}`, three_second_message: `Message ${page}`, screen_text: { title: `Page ${page}` }, asset_slots: [] });
      outline.sections[0].page_ids.push(id);
    }
    await Promise.all([
      fs.writeFile(pagesFile, `${JSON.stringify(pages, null, 2)}\n`),
      fs.writeFile(outlineFile, `${JSON.stringify(outline, null, 2)}\n`)
    ]);
  }
  return projectRoot;
}
