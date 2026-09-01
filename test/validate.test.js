import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readProject, resolveProjectPath } from "../src/core/project.js";
import { validatePage, validateProject } from "../src/core/validate.js";

const validPage = (overrides = {}) => ({
  page: 1, source: "brief.md#opening", task: "建立预期",
  three_second_message: "观众三秒内知道重点", relation: "hero",
  screen_text: { title: "标题" }, visual_job: "建立记忆点",
  asset_slots: [], status: "draft", ...overrides
});

const validLoadedProject = (overrides = {}) => ({
  project: {
    schema_version: "0.1", name: "demo", title: "Demo", format: "16:9",
    source_files: ["brief.md"], theme_file: "theme.json", assets_file: "assets.json",
    outputs: ["html", "pptx"]
  },
  theme: {
    dimensions: { width: 13.333, height: 7.5 },
    typography: { heading_font: "Aptos Display", body_font: "Aptos" },
    colors: { background: "#ffffff", text: "#111111", accent: "#ff5500" },
    spacing: { unit: 0.25, page_margin: 0.6 }
  },
  assets: [], pages: [validPage()],
  referencedFiles: [{ kind: "source", file: "brief.md", exists: true }],
  ...overrides
});

test("valid shared project and page contract passes", () => {
  assert.deepEqual(validateProject(validLoadedProject()), []);
});

test("page validation rejects invalid number, missing text, relation, and lifecycle", () => {
  const errors = validatePage({ page: 0, relation: "unknown", screen_text: {}, asset_slots: [], status: "done" });
  assert.ok(errors.includes("page must be a positive integer"));
  assert.ok(errors.includes("task is required"));
  assert.ok(errors.includes("three_second_message is required"));
  assert.ok(errors.includes("relation is invalid: unknown"));
  assert.ok(errors.includes("screen_text.title is required"));
  assert.ok(errors.includes("status is invalid: done"));
});

test("project validation rejects duplicate page numbers", () => {
  const errors = validateProject(validLoadedProject({ pages: [validPage(), validPage({ task: "second" })] }));
  assert.ok(errors.includes("duplicate page number: 1"));
});

test("project validation rejects pages that are out of order", () => {
  const pages = [validPage({ page: 2 }), validPage({ page: 1 })];
  const errors = validateProject(validLoadedProject({ pages }));
  assert.ok(errors.includes("pages must be ordered by page number: 1 follows 2"));
});

test("page asset slots must reference a declared asset", () => {
  const pages = [validPage({ asset_slots: [{ role: "hero", asset_id: "missing" }] })];
  assert.ok(validateProject(validLoadedProject({ pages })).includes("page 1: asset_slots[0].asset_id is unknown: missing"));
});

test("page sources must be declared by the project", () => {
  const errors = validateProject(validLoadedProject({ pages: [validPage({ source: "notes.md#part-1" })] }));
  assert.ok(errors.includes("page 1: source is not declared in project.source_files: notes.md"));
});

test("missing referenced source and asset files fail validation", () => {
  const errors = validateProject(validLoadedProject({ referencedFiles: [
    { kind: "source", file: "missing.md", exists: false },
    { kind: "asset", id: "hero", file: "assets/missing.png", exists: false }
  ] }));
  assert.ok(errors.includes("missing source file: missing.md"));
  assert.ok(errors.includes("missing asset file for hero: assets/missing.png"));
});

test("readProject loads normalized manifests and inspects referenced files", async () => {
  const loaded = await readProject(path.resolve("examples/demo-project"));
  assert.equal(loaded.project.schema_version, "0.1");
  assert.equal(loaded.theme.dimensions.height, 7.5);
  assert.equal(loaded.assets[0].id, "workflow-mark");
  assert.ok(loaded.referencedFiles.every(({ exists }) => exists));
  assert.deepEqual(validateProject(loaded), []);
});

test("readProject records a deleted referenced file as missing", async (t) => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "ppt-ops-contract-"));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  await fs.cp(path.resolve("examples/demo-project"), fixture, { recursive: true });
  await fs.rm(path.join(fixture, "assets/workflow-mark.svg"));
  const loaded = await readProject(fixture);
  assert.ok(validateProject(loaded).includes("missing asset file for workflow-mark: assets/workflow-mark.svg"));
});

test("project references cannot escape the project root", () => {
  assert.throws(() => resolveProjectPath("/tmp/project", "../secret.txt"), /escapes project root/);
});

test("all shared contract schemas are valid JSON", async () => {
  for (const file of ["project.schema.json", "theme.schema.json", "assets.schema.json", "page-spec.schema.json"]) {
    const schema = JSON.parse(await fs.readFile(path.join("schemas", file), "utf8"));
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  }
});

test("all V1 entity schemas are valid JSON and identify draft 2020-12", async () => {
  for (const file of await fs.readdir(path.join("schemas", "v1"))) {
    const schema = JSON.parse(await fs.readFile(path.join("schemas", "v1", file), "utf8"));
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  }
});
