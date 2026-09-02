import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { buildHtml } from "../src/adapters/html.js";
import { buildPptx } from "../src/adapters/pptx.js";
import { initializeProject } from "../src/core/init.js";
import { readProject } from "../src/core/project.js";
import { VisualAssetPipeline } from "../src/visual-assets/pipeline.js";
import { compileVisualPrompt } from "../src/visual-assets/prompt.js";

const ALPHA_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X0Y8WQAAAABJRU5ErkJggg==", "base64");
const OPAQUE_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR42mP8z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
const VISUAL_PASS = {
  semantic_action: true, subject_count: true, identity_boundary: true, visible_text_or_logo: true,
  reference_invariants: true, edge_integration: true, copy_safe_space: true
};

test("character briefs compile semantic action before the stable editorial style", () => {
  const compiled = compileVisualPrompt(characterBrief());
  assert.deepEqual(compiled.sections, [
    "Use case", "Asset type", "Primary request", "Scene/backdrop", "Subject", "Style/medium",
    "Composition/framing", "Lighting/mood", "Color palette", "Text", "Constraints", "Avoid"
  ]);
  assert.ok(compiled.prompt.indexOf("points to the blocked task") < compiled.prompt.indexOf("low-poly editorial"));
  assert.match(compiled.prompt, /No visible text, letters, numbers, labels, logos, watermarks, signatures, or pseudo-text/);
  assert.match(compiled.prompt, /3 subjects/);
  assert.match(compiled.prompt, /stick figures/);
});

test("provider retries create separate immutable attempts and keep selected references bounded", async (t) => {
  const project = await createProject(t);
  const pipeline = deterministicPipeline(project);
  let calls = 0;
  const provider = {
    id: "fake-imagegen", model: "fixture-v1",
    async generate(request) {
      calls += 1;
      assert.deepEqual(request.references, []);
      if (calls === 1) { const error = new Error("temporary failure"); error.retryable = true; error.code = "TEMPORARY"; throw error; }
      return { bytes: ALPHA_PNG, mime: "image/png" };
    }
  };
  const generation = await pipeline.generate(characterBrief(), provider, { maxAttempts: 2 });
  assert.equal(calls, 2);
  assert.equal(generation.state, "awaiting_visual_observation");
  assert.equal(generation.provider, "fake-imagegen");
  assert.equal(generation.inspection.has_alpha, true);
  const generationRoot = path.join(project, ".pptops", "visual-assets", "generations");
  const attempts = await fs.readdir(generationRoot);
  assert.equal(attempts.length, 2);
  const records = await Promise.all(attempts.map((id) => fs.readFile(path.join(generationRoot, id, "manifest.json"), "utf8").then(JSON.parse)));
  assert.deepEqual(records.map((record) => record.state).sort(), ["awaiting_visual_observation", "provider_failed"]);
  await assert.rejects(fs.writeFile(path.join(generationRoot, generation.id, "manifest.json"), "replacement", { flag: "wx" }), /EEXIST/);
});

test("transparency failure remains machine evidence and cannot become acceptance", async (t) => {
  const project = await createProject(t);
  const source = path.join(project, "opaque.png");
  await fs.writeFile(source, OPAQUE_PNG);
  const pipeline = deterministicPipeline(project);
  const prepared = await pipeline.prepare(characterBrief());
  const generation = await pipeline.ingest(prepared.brief.id, { sourceFile: source, provider: "imagegen", model: "test", mime: "image/png" });
  assert.equal(generation.state, "validation_failed");
  assert.equal(generation.inspection.checks.alpha_channel_matches, false);
  assert.equal(generation.inspection.visual_claims.semantic_action, "pending_visual_observation");
  await assert.rejects(pipeline.recordVisualObservation(generation.id, { actor: "agent", verdict: "pass", checks: VISUAL_PASS }), /not ready for visual observation/);
  await assert.rejects(pipeline.recordUserDecision(generation.id, { decision: "accept", raw_feedback: "Use it" }), /requires passing automated validation/);
});

test("reference edits send only selected references and bind hash, change scope, and invariants", async (t) => {
  const project = await createProject(t);
  await registerReference(project, "character-reference", ALPHA_PNG);
  const pipeline = deterministicPipeline(project);
  const brief = characterBrief({
    mode: "reference_edit", reference_asset_ids: ["character-reference"], parent_generation_id: "visual-generation-parent",
    change_scope: "Replace only the planning board with a routing board",
    invariants: ["Keep all three character identities", "Keep posture, palette, lighting, and transparent background"]
  });
  let outbound;
  const generation = await pipeline.generate(brief, { id: "fake", model: "edit-v1", async generate(request) { outbound = request; return { bytes: ALPHA_PNG, mime: "image/png" }; } });
  assert.deepEqual(outbound.references.map(({ asset_id }) => asset_id), ["character-reference"]);
  assert.equal(outbound.references[0].sha256, sha256(ALPHA_PNG));
  assert.equal(generation.parent_generation_id, "visual-generation-parent");
  assert.match(generation.change_scope, /planning board/);
  assert.equal(generation.invariants.length, 2);
  assert.deepEqual(generation.reference_assets, [{ asset_id: "character-reference", file: "assets/character-reference.png", sha256: sha256(ALPHA_PNG) }]);
});

test("accepted registration is gated, atomic, page-scoped, and shared by HTML and PPTX", async (t) => {
  const projectRoot = await createProject(t, { secondPage: true });
  const source = path.join(projectRoot, "candidate.png");
  await fs.writeFile(source, ALPHA_PNG);
  const pipeline = deterministicPipeline(projectRoot);
  const prepared = await pipeline.prepare(characterBrief());
  const generation = await pipeline.ingest(prepared.brief.id, { sourceFile: source, provider: "imagegen", model: "live-capability", mime: "image/png" });
  await assert.rejects(pipeline.registerAccepted(generation.id, registrationInput()), /user-accepted/);

  await pipeline.recordVisualObservation(generation.id, { actor: "agent", verdict: "pass", checks: VISUAL_PASS, notes: "Exact candidate inspected" });
  await pipeline.recordUserDecision(generation.id, { decision: "accept", raw_feedback: "Use this visual" });
  const pagesBefore = JSON.parse(await fs.readFile(path.join(projectRoot, "pages.json"), "utf8"));
  const result = await pipeline.registerAccepted(generation.id, registrationInput());
  const [contract, assets, pages] = await Promise.all(["project.json", "assets.json", "pages.json"].map((file) => fs.readFile(path.join(projectRoot, file), "utf8").then(JSON.parse)));
  assert.deepEqual(contract.asset_ids, ["generated-team-scene"]);
  assert.equal(assets[0].provenance.generation_id, generation.id);
  assert.deepEqual(pages[0].asset_slots, [{ role: "hero", asset_id: "generated-team-scene", fit: "contain" }]);
  assert.deepEqual(pages[1], pagesBefore[1]);
  assert.equal(result.asset.sha256, sha256(ALPHA_PNG));
  await assert.rejects(pipeline.registerAccepted(generation.id, registrationInput()), /asset id already exists/);

  const project = await readProject(projectRoot);
  const html = await buildHtml(project);
  assert.match(html, /data:image\/png;base64,/);
  const pptxFile = path.join(projectRoot, "outputs", "visual.pptx");
  await buildPptx(project, pptxFile);
  const zip = await JSZip.loadAsync(await fs.readFile(pptxFile));
  assert.ok(Object.keys(zip.files).some((file) => /^ppt\/media\/image-1-\d+\.png$/.test(file)));
  const slide = await zip.file("ppt/slides/slide1.xml").async("string");
  assert.match(slide, /<p:pic>/);
  assert.match(slide, /<a:t>Visual Asset Test<\/a:t>/);
});

test("escaping reference paths fail before a provider request", async (t) => {
  const project = await createProject(t);
  const assets = [{ contract_version: "1.0", kind: "asset", id: "unsafe-reference", type: "image", file: "../outside.png", mime: "image/png", sha256: "0".repeat(64) }];
  await fs.writeFile(path.join(project, "assets.json"), `${JSON.stringify(assets, null, 2)}\n`);
  const pipeline = deterministicPipeline(project);
  let called = false;
  await assert.rejects(pipeline.generate(characterBrief({
    mode: "reference_edit", reference_asset_ids: ["unsafe-reference"], change_scope: "Change the board", invariants: ["Keep subjects"]
  }), { async generate() { called = true; } }), /escapes project root/);
  assert.equal(called, false);
});

function characterBrief(overrides = {}) {
  return {
    role: "scene", mode: "fresh", page_id: "page-001", slot_role: "hero",
    semantic_goal: "Show coordinated routing instead of passive discussion",
    three_second_message: "The team identifies and routes a blocked task",
    subject_count: 3, identity_boundary: "faceless, non-identifiable adult staff",
    action: "Three staff gather around a planning board; one points to the blocked task, one writes the route, and one checks a task card",
    prohibited_interpretations: ["a posed team portrait", "a generic meeting"],
    copy_safe_zones: ["upper left"], aspect_ratio: "1:1", text_policy: "none", transparency_required: true,
    ...overrides
  };
}

function registrationInput() { return { asset_id: "generated-team-scene", page_id: "page-001", slot_role: "hero", alt: "Three staff route a blocked task", fit: "contain" }; }

function deterministicPipeline(project) {
  let id = 0;
  return new VisualAssetPipeline(project, { now: () => "2026-09-02T08:00:00.000Z", idFactory: () => `fixture-${++id}` });
}

async function createProject(t, options = {}) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-visual-assets-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const project = path.join(parent, "project");
  await initializeProject(project, { name: "visual-assets-test", title: "Visual Asset Test" });
  if (options.secondPage) {
    const pagesFile = path.join(project, "pages.json");
    const outlineFile = path.join(project, "outline.json");
    const pages = JSON.parse(await fs.readFile(pagesFile, "utf8"));
    pages.push({ ...structuredClone(pages[0]), id: "page-002", page: 2, screen_text: { title: "Untouched page", body: ["Must remain byte-equivalent as JSON data"] }, asset_slots: [] });
    const outline = JSON.parse(await fs.readFile(outlineFile, "utf8"));
    outline.sections[0].page_ids.push("page-002");
    await Promise.all([
      fs.writeFile(pagesFile, `${JSON.stringify(pages, null, 2)}\n`),
      fs.writeFile(outlineFile, `${JSON.stringify(outline, null, 2)}\n`)
    ]);
  }
  return project;
}

async function registerReference(project, id, bytes) {
  const file = `assets/${id}.png`;
  await fs.writeFile(path.join(project, file), bytes);
  const asset = { contract_version: "1.0", kind: "asset", id, type: "image", file, mime: "image/png", sha256: sha256(bytes), bytes: bytes.length, width: 1, height: 1, alt: "Reference character" };
  const projectContract = JSON.parse(await fs.readFile(path.join(project, "project.json"), "utf8"));
  projectContract.asset_ids.push(id);
  await Promise.all([
    fs.writeFile(path.join(project, "assets.json"), `${JSON.stringify([asset], null, 2)}\n`),
    fs.writeFile(path.join(project, "project.json"), `${JSON.stringify(projectContract, null, 2)}\n`)
  ]);
}

function sha256(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
