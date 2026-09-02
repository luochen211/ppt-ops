import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { ApplicationService } from "../src/application/service.js";
import { initializeProject } from "../src/core/init.js";
import { SourceIntake } from "../src/sources/intake.js";
import { seedAcceptedBoundaryImages } from "./support/accepted-boundaries.js";

process.env.PPT_OPS_RENDER_QA = "0";
const fixturesRoot = new URL("fixtures/golden-conversations/", import.meta.url);

test("five Golden Conversation fixtures record the complete reproducible evidence contract", async () => {
  const names = (await fs.readdir(fixturesRoot)).filter((name) => name.endsWith(".json")).sort();
  assert.equal(names.length, 5);
  for (const name of names) {
    const fixture = JSON.parse(await fs.readFile(new URL(name, fixturesRoot), "utf8"));
    for (const field of ["id", "user_input", "route", "loaded_context", "forbidden_context", "command_trace", "project_diff", "outputs", "unresolved_acceptance"]) assert.ok(fixture[field], `${name} missing ${field}`);
    assert.ok(fixture.unresolved_acceptance.length > 0);
    assert.ok(!fixture.route.includes("web"));
  }
});

test("topic-only request reaches editable PPTX and Review without user code editing", async (t) => {
  const project = await projectFixture(t, "topic-only");
  const result = await buildAndReview(project);
  assert.equal(result.build.state, "succeeded");
  assert.ok(result.artifacts.some(({ file }) => file.endsWith("slides.pptx")));
  assert.ok(result.report.acceptance.every(({ status }) => status === "pending"));
});

test("DOCX and existing PPTX intake preserve traceable source locators before build", async (t) => {
  for (const kind of ["docx", "pptx"]) {
    const project = await projectFixture(t, `intake-${kind}`);
    const service = await ApplicationService.open(project);
    const input = path.join(path.dirname(project), `source.${kind}`);
    await fs.writeFile(input, kind === "docx" ? await docxBuffer(["First fact", "Second fact"]) : await pptxBuffer([["Opening", "Evidence"], ["Conclusion"]]));
    const imported = await new SourceIntake({ projectRoot: project, store: service.store, projectId: service.projectId }).importFile(input);
    assert.equal(imported.duplicate, false);
    assert.ok(imported.extracted.segments.every(({ locator }) => locator));
    const version = await service.freezeVersion();
    const { build, artifacts } = await service.createBuild({ versionId: version.id, targets: ["pptx"] });
    assert.equal(build.state, "succeeded");
    assert.ok(artifacts[0].file.endsWith("slides.pptx"));
    service.close();
  }
});

test("target-page revision changes zero unrelated approved pages", async (t) => {
  const project = await projectFixture(t, "revise");
  const pagesFile = path.join(project, "pages.json");
  const outlineFile = path.join(project, "outline.json");
  const starter = JSON.parse(await fs.readFile(pagesFile, "utf8"));
  const second = { ...structuredClone(starter[0]), id: "page-002", page: 2, task: "Remain unchanged", three_second_message: "Untouched page", screen_text: { title: "Untouched page", body: ["Approved content."] } };
  await fs.writeFile(pagesFile, `${JSON.stringify([...starter, second], null, 2)}\n`);
  const outline = JSON.parse(await fs.readFile(outlineFile, "utf8"));
  outline.sections[0].page_ids.push(second.id);
  await fs.writeFile(outlineFile, `${JSON.stringify(outline, null, 2)}\n`);
  const before = JSON.parse(await fs.readFile(pagesFile, "utf8"));
  const untouchedHash = hash(before[1]);
  const service = await ApplicationService.open(project);
  const candidate = await service.proposeCandidate({ targetKind: "page_spec", targetId: before[0].id, baseRevision: 1, patch: { screen_text: { title: "Locally revised title" } } });
  assert.equal(service.diffCandidate(candidate.id).stale, false);
  const rendered = await service.renderCandidate(candidate.id, candidate.revision);
  const observed = service.recordPowerPointObservation(candidate.id, { expectedRevision: rendered.candidate.revision, status: "viewed", evidence: { application: "Microsoft PowerPoint", artifact: rendered.render_evidence.artifact, sha256: rendered.render_evidence.sha256, pages: rendered.render_evidence.pages } });
  await service.acceptCandidate(candidate.id, observed.candidate.revision);
  service.close();
  const after = JSON.parse(await fs.readFile(pagesFile, "utf8"));
  assert.equal(after[0].screen_text.title, "Locally revised title");
  assert.equal(hash(after[1]), untouchedHash);
});

test("formal Review and Handoff preserve separate unresolved acceptance", async (t) => {
  const project = await projectFixture(t, "handoff");
  const service = await ApplicationService.open(project);
  const version = await service.freezeVersion();
  const { build } = await service.createBuild({ versionId: version.id, targets: ["pptx"] });
  const { review, report } = await service.runReview(build.id);
  assert.deepEqual(report.acceptance.map(({ kind, status }) => ({ kind, status })), [
    { kind: "visual", status: "pending" },
    { kind: "real_powerpoint", status: "pending" }
  ]);
  const accepted = await service.recordReview(review.id, { decision: "accepted", expectedRevision: review.revision, evidence: { kind: "golden-fixture", note: "Workflow gate only; business acceptance remains unresolved." } });
  const handoff = await service.createHandoff(build.id, accepted.id);
  assert.equal(handoff.handoff.state, "verified");
  const manifest = JSON.parse(await fs.readFile(handoff.manifest_file, "utf8"));
  assert.equal(manifest.acceptance.visual.pending, 1);
  assert.equal(manifest.acceptance.real_powerpoint.pending, 1);
  service.close();
});

async function buildAndReview(project) {
  const service = await ApplicationService.open(project);
  const version = await service.freezeVersion();
  const result = await service.createBuild({ versionId: version.id, targets: ["pptx"] });
  const { report } = await service.runReview(result.build.id);
  service.close();
  return { ...result, report };
}
async function projectFixture(t, name) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), `pptops-golden-${name}-`));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const project = path.join(parent, "project");
  await initializeProject(project, { title: name });
  await seedAcceptedBoundaryImages(project);
  return project;
}
async function docxBuffer(paragraphs) {
  const zip = new JSZip(); zip.file("[Content_Types].xml", "<Types/>");
  zip.file("word/document.xml", `<w:document><w:body>${paragraphs.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}
async function pptxBuffer(slides) {
  const zip = new JSZip(); zip.file("[Content_Types].xml", "<Types/>"); zip.file("ppt/presentation.xml", "<p:presentation/>");
  slides.forEach((texts, index) => zip.file(`ppt/slides/slide${index + 1}.xml`, `<p:sld>${texts.map((text) => `<a:t>${text}</a:t>`).join("")}</p:sld>`));
  return zip.generateAsync({ type: "nodebuffer" });
}
function hash(value) { return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
