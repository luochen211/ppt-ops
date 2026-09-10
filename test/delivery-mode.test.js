import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { buildHtml } from "../src/adapters/html.js";
import { buildPptx } from "../src/adapters/pptx.js";
import { inspectDeliveryModeFit } from "../src/contracts/delivery.js";
import { validateV1Entity } from "../src/contracts/v1.js";
import { readProject } from "../src/core/project.js";
import { initializeProject } from "../src/core/init.js";
import { validatePage, validateProject } from "../src/core/validate.js";
import { reviewProject } from "../src/review/index.js";

const v1Page = (overrides = {}) => ({
  contract_version: "1.0", kind: "page_spec", id: "page-001", page: 1,
  task: "Teach", three_second_message: "Try the task", relation: "hero",
  screen_text: { title: "Workshop" }, visual_job: "Focus", source_refs: [],
  asset_slots: [], content_status: "draft", renderers: { html: {}, pptx: {} },
  ...overrides
});

test("Project and PageSpec delivery metadata is optional but strictly validated", () => {
  const project = {
    contract_version: "1.0", kind: "project", id: "demo", title: "Demo", format: "16:9",
    outputs: ["html"], source_ids: ["source-001"], outline_id: "outline-main",
    theme_id: "theme-default", asset_ids: [], delivery_mode: "workshop"
  };
  assert.deepEqual(validateV1Entity(project, "project"), []);
  assert.ok(validateV1Entity({ ...project, delivery_mode: "webinar" }, "project").includes("delivery_mode is invalid: webinar"));

  const page = v1Page({
    estimated_duration_seconds: 90,
    speaker_note_intent: "Explain the constraint without placing the script on the slide.",
    audience_interaction: { kind: "exercise", intent: "Ask pairs to classify the example.", expected_response: "One classification and reason." }
  });
  assert.deepEqual(validateV1Entity(page, "page_spec"), []);
  assert.ok(validateV1Entity(v1Page({ estimated_duration_seconds: 0 }), "page_spec").includes("estimated_duration_seconds must be a positive integer"));
  assert.ok(validateV1Entity(v1Page({ audience_interaction: { kind: "poll", intent: "Vote" } }), "page_spec").includes("kind is invalid: poll"));
});

test("new projects can declare delivery mode without making it mandatory", async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-delivery-init-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const workshop = path.join(parent, "workshop");
  const legacyCompatible = path.join(parent, "unspecified");
  await initializeProject(workshop, { title: "Workshop", deliveryMode: "workshop" });
  await initializeProject(legacyCompatible, { title: "Unspecified" });
  assert.equal(JSON.parse(await fs.readFile(path.join(workshop, "project.json"), "utf8")).delivery_mode, "workshop");
  assert.equal("delivery_mode" in JSON.parse(await fs.readFile(path.join(legacyCompatible, "project.json"), "utf8")), false);
  const pageFile = path.join(workshop, "pages.json");
  const pages = JSON.parse(await fs.readFile(pageFile, "utf8"));
  Object.assign(pages[0], {
    estimated_duration_seconds: 75,
    speaker_note_intent: "Frame the exercise.",
    audience_interaction: { kind: "exercise", intent: "Classify the example." }
  });
  await fs.writeFile(pageFile, `${JSON.stringify(pages, null, 2)}\n`);
  const normalized = await readProject(workshop);
  assert.equal(normalized.project.delivery_mode, "workshop");
  assert.equal(normalized.pages[0].estimated_duration_seconds, 75);
  assert.deepEqual(normalized.pages[0].audience_interaction, { kind: "exercise", intent: "Classify the example." });
  await assert.rejects(initializeProject(path.join(parent, "invalid"), { deliveryMode: "webinar" }), /delivery-mode is invalid/);
});

test("Foundation validation accepts delivery semantics and rejects malformed values", async () => {
  const project = await readProject("examples/demo-project");
  project.project.delivery_mode = "live_talk";
  Object.assign(project.pages[0], {
    estimated_duration_seconds: 45,
    speaker_note_intent: "State the promise in one sentence.",
    audience_interaction: { kind: "question", intent: "Invite a show of hands." }
  });
  assert.deepEqual(validateProject(project), []);
  assert.ok(validatePage({ ...project.pages[0], speaker_note_intent: "" }, new Set(project.assets.map(({ id }) => id))).includes("speaker_note_intent must be a non-empty string"));
});

test("live-talk density guidance is stricter than leave-behind guidance", () => {
  const opening = { page: 1, screen_text: { title: "Dense" } };
  const dense = { page: 2, three_second_message: "Message", screen_text: { title: "Dense", body: ["x".repeat(500)] } };
  const closing = { page: 3, screen_text: { title: "Close" } };
  const liveTalk = inspectDeliveryModeFit({ project: { delivery_mode: "live_talk" }, pages: [opening, dense, closing] });
  const leaveBehind = inspectDeliveryModeFit({ project: { delivery_mode: "leave_behind" }, pages: [opening, dense, closing] });
  assert.equal(liveTalk.status, "failed");
  assert.equal(liveTalk.findings[0].evidence.character_limit, 420);
  assert.equal(leaveBehind.status, "passed");
  assert.ok(liveTalk.guidance.character_limit < leaveBehind.guidance.character_limit);
});

test("workshop review reports missing and declared interaction without requiring it on every page", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-delivery-review-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.cp(path.resolve("examples/demo-project"), root, { recursive: true });
  const project = await readProject(root);
  project.project.delivery_mode = "workshop";

  const missing = await reviewProject(project, { render: false });
  const missingCheck = missing.automated_checks.find(({ id }) => id === "delivery-mode-fit");
  assert.equal(missingCheck.required, false);
  assert.equal(missingCheck.status, "failed");
  assert.ok(missingCheck.evidence.findings.some(({ check }) => check === "workshop-interaction"));

  project.pages[0].audience_interaction = { kind: "audience_action", intent: "Ask the audience to choose a path." };
  const declared = await reviewProject(project, { render: false });
  assert.equal(declared.automated_checks.find(({ id }) => id === "delivery-mode-fit").status, "passed");
});

test("speaker-note intent and interaction metadata never become visible HTML or PPTX copy", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-delivery-render-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const project = await readProject("examples/demo-project");
  const secretIntent = "OFF_SLIDE_SPEAKER_INTENT_9d77";
  const secretInteraction = "OFF_SLIDE_INTERACTION_4c21";
  project.pages[0].speaker_note_intent = secretIntent;
  project.pages[0].audience_interaction = { kind: "question", intent: secretInteraction };

  const html = await buildHtml(project);
  assert.doesNotMatch(html, new RegExp(`${secretIntent}|${secretInteraction}`));

  const pptxFile = path.join(root, "slides.pptx");
  await buildPptx(project, pptxFile);
  const archive = await JSZip.loadAsync(await fs.readFile(pptxFile));
  const slideXml = await Promise.all(Object.keys(archive.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).map((name) => archive.file(name).async("string")));
  assert.doesNotMatch(slideXml.join("\n"), new RegExp(`${secretIntent}|${secretInteraction}`));
});
