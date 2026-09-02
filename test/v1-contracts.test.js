import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateV1Bundle, validateV1Entity } from "../src/contracts/v1.js";
import { canTransition, transition } from "../src/core/state-machines.js";
import { initializeProject } from "../src/core/init.js";
import { migrateFoundationProject, writeMigratedProject } from "../src/migrations/foundation-to-v1.js";

const digest = crypto.createHash("sha256").update("fixture").digest("hex");
const base = (kind, id, fields = {}) => ({ contract_version: "1.0", kind, id, ...fields });

test("all V1 entity fixtures satisfy their semantic contracts", () => {
  const fixtures = [
    base("project", "demo", { title: "Demo", format: "16:9", outputs: ["html", "pptx"], source_ids: ["source-001"], outline_id: "outline-main", theme_id: "theme-default", asset_ids: ["hero"] }),
    base("source", "source-001", { file: "brief.md", bytes: 7, mime: "text/markdown", sha256: digest }),
    base("outline", "outline-main", { sections: [{ id: "section-main", title: "Main", page_ids: ["page-001"] }] }),
    base("page_spec", "page-001", { page: 1, task: "Explain", three_second_message: "Message", relation: "hero", screen_text: { title: "Demo" }, visual_job: "Focus", source_refs: [{ source_id: "source-001", locator: "" }], asset_slots: [{ role: "hero", asset_id: "hero" }], content_status: "draft", renderers: { html: {}, pptx: {} } }),
    base("theme", "theme-default", { tokens: {} }),
    base("template", "template-hero", { name: "Hero", slots: {}, renderers: { html: "hero", pptx: "hero" } }),
    base("asset", "hero", { type: "image", file: "hero.png", sha256: digest }),
    base("candidate", "candidate-001", { target_id: "page-001", target_kind: "page_spec", state: "generated", patch: [] }),
    base("candidate_feedback", "feedback-001", {
      candidate_id: "candidate-001", target_id: "page-001", decision: "reject", actor: "user", raw_feedback: "Roles are wrong and the layout has no ownership",
      findings: [
        { eval_category: "semantic_accuracy", root_cause: "information_relationship", root_cause_fingerprint: "roles", severity: "blocking", target: { kind: "page_spec", id: "page-001" }, evidence: { observation: "Inputs and outputs are peers" } },
        { eval_category: "layout_composition", root_cause: "information_relationship", root_cause_fingerprint: "floating-copy", severity: "major", target: { kind: "page_spec", id: "page-001" }, evidence: { observation: "Text has no visual owner" } }
      ]
    }),
    base("powerpoint_observation", "powerpoint-001", { candidate_id: "candidate-001", target_id: "page-001", status: "viewed", evidence: { app: "Microsoft PowerPoint" } }),
    base("approval", "approval-001", { subject_id: "candidate-001", subject_hash: digest, decision: "accepted" }),
    base("version", "version-001", { state: "draft", snapshot_hash: digest, component_hashes: {} }),
    base("build", "build-001", { version_id: "version-001", state: "queued", targets: ["html", "pptx"], attempts: [] }),
    base("review", "review-001", { build_id: "build-001", state: "automated_pending", automated: [], human: [] }),
    base("handoff", "handoff-001", { build_id: "build-001", review_id: "review-001", state: "preparing", files: [] })
  ];
  for (const fixture of fixtures) assert.deepEqual(validateV1Entity(fixture, fixture.kind), []);
  const [project, source, outline, page, theme, template, asset, candidate, feedback, observation, approval, version, build, review, handoff] = fixtures;
  assert.deepEqual(validateV1Bundle({ project, sources: [source], outline, pages: [page], theme, assets: [asset], templates: [template], candidates: [candidate], approvals: [approval], versions: [version], builds: [build], reviews: [review], handoffs: [handoff] }), []);
});

test("candidate feedback rejects legacy single-category fields and malformed findings", () => {
  const legacy = base("candidate_feedback", "feedback-legacy", {
    candidate_id: "candidate-001", target_id: "page-001", decision: "reject", actor: "user", raw_feedback: "Wrong",
    eval_category: "visual_hierarchy", root_cause: "visual_grammar", root_cause_fingerprint: "flat"
  });
  const errors = validateV1Entity(legacy, "candidate_feedback");
  assert.ok(errors.includes("findings must contain at least one atomic finding"));
  assert.ok(errors.includes("eval_category must be stored inside findings"));

  const malformed = base("candidate_feedback", "feedback-malformed", {
    candidate_id: "candidate-001", target_id: "page-001", decision: "reject", actor: "user", raw_feedback: "Wrong",
    findings: [{ eval_category: "layout_composition", root_cause: "information_relationship", severity: "severe", target: { kind: "page_spec", id: "page-001" }, evidence: [] }]
  });
  const malformedErrors = validateV1Entity(malformed, "candidate_feedback");
  assert.ok(malformedErrors.some((error) => error.includes("root_cause_fingerprint is required")));
  assert.ok(malformedErrors.some((error) => error.includes("severity is invalid")));
  assert.ok(malformedErrors.some((error) => error.includes("evidence must be an object")));
});

test("semantic validation rejects cross-entity references that do not exist", () => {
  const errors = validateV1Bundle({
    project: base("project", "demo", { title: "Demo", format: "16:9", outputs: ["html"], source_ids: ["missing"], outline_id: "outline-main", theme_id: "theme-default", asset_ids: [] }),
    sources: [], outline: base("outline", "outline-main", { sections: [{ id: "main", title: "Main", page_ids: ["missing-page"] }] }), pages: [],
    theme: base("theme", "theme-default", { tokens: {} }), assets: [], templates: [], candidates: [], approvals: [], versions: [], builds: [], reviews: [], handoffs: []
  });
  assert.ok(errors.includes("project.source_ids references missing source: missing"));
  assert.ok(errors.includes("outline.sections.page_ids references missing page_spec: missing-page"));
});

test("state machines allow declared paths and reject shortcuts", () => {
  assert.equal(canTransition("candidate", "generated", "validating"), true);
  assert.equal(canTransition("candidate", "generated", "accepted"), false);
  assert.equal(canTransition("candidate", "awaiting_powerpoint_observation", "awaiting_user_decision"), true);
  assert.equal(canTransition("candidate", "awaiting_powerpoint_observation", "accepted"), false);
  assert.deepEqual(transition("version", { id: "version-001", state: "draft" }, "approval_pending"), { id: "version-001", state: "approval_pending" });
  assert.throws(() => transition("version", { state: "draft" }, "frozen"), /invalid version transition/);
  assert.equal(canTransition("build", "succeeded", "rendering"), false);
});

test("Foundation migration is deterministic, valid, and leaves its source unchanged", async (t) => {
  const source = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-foundation-"));
  const destination = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "pptops-v1-parent-")), "migrated");
  t.after(() => Promise.all([fs.rm(source, { recursive: true, force: true }), fs.rm(path.dirname(destination), { recursive: true, force: true })]));
  await fs.cp(path.resolve("examples/demo-project"), source, { recursive: true });
  const before = await snapshot(source);
  const first = await migrateFoundationProject(source);
  const second = await migrateFoundationProject(source);
  assert.deepEqual(first, second);
  assert.deepEqual(validateV1Bundle(first.bundle), []);
  assert.deepEqual(await snapshot(source), before);
  await writeMigratedProject(source, destination);
  assert.equal(JSON.parse(await fs.readFile(path.join(destination, "project.json"), "utf8")).kind, "project");
  assert.deepEqual(await snapshot(source), before);
});

test("new projects persist only V1 contracts", async (t) => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-new-v1-"));
  const projectDir = path.join(parent, "new-project");
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  await initializeProject(projectDir, { title: "New Project" });
  const project = JSON.parse(await fs.readFile(path.join(projectDir, "project.json"), "utf8"));
  assert.deepEqual({ contract_version: project.contract_version, kind: project.kind }, { contract_version: "1.0", kind: "project" });
  assert.equal("schema_version" in project, false);
  assert.equal("source_files" in project, false);
});

async function snapshot(root) {
  const files = (await fs.readdir(root, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath ?? entry.path, entry.name)).sort();
  return Promise.all(files.map(async (file) => [path.relative(root, file), crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex")]));
}
