import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { auditAccessibility, capabilityMatrix, validateAccessibilityProfile } from "../src/accessibility/index.js";
import { reviewProject } from "../src/review/index.js";

const execFileAsync = promisify(execFile);
const cli = path.resolve("src/cli.js");

const profile = Object.freeze({ enabled: true, intent: "audit_only", document_language: "en-CA", reading_direction: "ltr", target_formats: ["html", "pptx"], text_scale: 1.25, required_evidence: ["human_accessibility_review", "assistive_technology"] });

test("projects without Accessibility Mode remain valid and receive no accessibility claim", () => {
  const project = fixture(); const before = structuredClone(project); const report = auditAccessibility(project);
  assert.equal(report.status, "not_requested"); assert.equal(report.claims.automated_conformance, false); assert.equal(report.claims.legal_or_policy_conformance, "not_claimed"); assert.deepEqual(project, before);
});

test("profile requires explicit opt-in, exact standard version, and separate evidence kinds", () => {
  assert.deepEqual(validateAccessibilityProfile(profile), []);
  const errors = validateAccessibilityProfile({ ...profile, enabled: false, standard_target: { name: "WCAG" }, required_evidence: ["automated"] });
  assert.ok(errors.some((error) => error.includes("enabled"))); assert.ok(errors.some((error) => error.includes("exact name and version"))); assert.ok(errors.some((error) => error.includes("human evidence")));
});

test("audit-only reports page-addressable semantic findings without mutation", () => {
  const project = fixture({ accessibility_profile: profile });
  project.pages[0].accessibility = { language: "en-CA", reading_order: ["title", "message"], links: [{ label: "https://example.com", destination: "https://example.com" }], charts: [{ conclusion: "" }], tables: [{ headers: [], simple_structure: false }], meaning_dependencies: ["color_only"], text_on_image: true };
  project.pages[0].screen_text.title = "A".repeat(80); project.pages[0].asset_slots = [{ role: "hero", asset_id: "missing-description" }]; project.assets = [{ id: "missing-description", type: "image", file: "image.png" }]; project.pages.push({ ...structuredClone(project.pages[0]), id: "page-002", page: 2 });
  const before = structuredClone(project); const report = auditAccessibility(project, { buildRevision: "build-007" });
  assert.equal(report.intent, "audit_only"); assert.equal(report.mutation_performed, false); assert.equal(report.build_revision, "build-007"); assert.match(report.source_revision, /^[a-f0-9]{64}$/); assert.equal(report.status, "failed");
  assert.ok(report.findings.some(({ rule, target }) => rule === "unique-title" && target.id === "page-002"));
  for (const rule of ["asset-description", "meaningful-link", "chart-alternative", "table-headers", "table-structure", "single-channel-meaning", "text-on-image-contrast", "scaled-text-capacity"]) assert.ok(report.findings.some((finding) => finding.rule === rule), `missing ${rule}`);
  assert.ok(report.findings.every((finding) => finding.remediation.kind === "candidate_required" && finding.remediation.automatically_applied === false)); assert.deepEqual(project, before);
});

test("format capability and evidence states never imply conformance", () => {
  const matrix = capabilityMatrix(["html", "pptx", "pdf", "png"]); assert.equal(matrix.html.status, "partial"); assert.equal(matrix.pptx.status, "partial"); assert.equal(matrix.pdf.status, "unavailable"); assert.equal(matrix.png.status, "degraded");
  const report = auditAccessibility(fixture({ accessibility_profile: { ...profile, target_formats: ["pdf"] } })); assert.equal(report.status, "failed"); assert.equal(report.evidence.find(({ kind }) => kind === "legal_policy_conformance").status, "not_claimed"); assert.equal(report.evidence.find(({ kind }) => kind === "organization_approval").status, "pending"); assert.equal(report.evidence.some(({ kind }) => kind === "powerpoint_accessibility_checker"), false);
});

test("Review exposes Accessibility Mode while audit-only findings remain non-gating", async () => {
  const project = fixture({ accessibility_profile: { ...profile, text_scale: 1 } }); project.pages[0].accessibility = { language: "en-CA", reading_order: ["title", "message"] };
  const report = await reviewProject(project); const check = report.automated_checks.find(({ id }) => id === "accessibility-audit"); assert.equal(check.required, false); assert.equal(check.status, "passed"); assert.ok(report.acceptance.some(({ kind }) => kind === "assistive_technology"));
});

test("CLI creates an opt-in profile and accessibility-audit leaves source files unchanged", async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-accessibility-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const projectDir = path.join(temporary, "deck");
  await execFileAsync(process.execPath, [cli, "init", projectDir, "--accessibility-profile", JSON.stringify(profile)], { encoding: "utf8" });
  const files = ["project.json", "pages.json", "assets.json", "theme.json", "outline.json", "sources.json", "templates.json"];
  const before = Object.fromEntries(await Promise.all(files.map(async (file) => [file, await fs.readFile(path.join(projectDir, file), "utf8")])));
  const report = JSON.parse((await execFileAsync(process.execPath, [cli, "accessibility-audit", projectDir], { encoding: "utf8" })).stdout);
  const after = Object.fromEntries(await Promise.all(files.map(async (file) => [file, await fs.readFile(path.join(projectDir, file), "utf8")])));
  assert.equal(report.command, "accessibility-audit");
  assert.equal(report.mutation_performed, false);
  assert.ok(report.findings.every(({ target }) => target.kind === "page"));
  assert.deepEqual(after, before);
});

function fixture(projectFields = {}) {
  return { root: process.cwd(), contractModel: "foundation", project: { schema_version: "1.0", name: "accessibility-demo", title: "Demo", format: "16:9", source_files: [], theme_file: "theme.json", assets_file: "assets.json", outputs: ["html", "pptx"], ...projectFields }, pages: [{ id: "page-001", page: 1, task: "Explain", three_second_message: "Clear point", relation: "hero", screen_text: { title: "Meaningful title" }, visual_job: "Support the message", asset_slots: [], status: "draft" }], assets: [], theme: { dimensions: { width: 13.333, height: 7.5 }, typography: { heading_font: "Aptos", body_font: "Aptos" }, colors: { background: "#ffffff", text: "#111111", accent: "#0055aa" }, spacing: { unit: 0.25, page_margin: 0.6 } }, referencedFiles: [] };
}
