import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { deliveryCapabilities, readDeliverySelection, recordDeliverySelection } from "../src/delivery/selection.js";
import { ApplicationService } from "../src/application/service.js";
import { initializeProject } from "../src/core/init.js";
import { seedAcceptedBoundaryImages } from "./support/accepted-boundaries.js";
import { findBrowser } from "../src/qa/html.js";
import { hashFile } from "../src/delivery/pdf.js";
process.env.PPT_OPS_RENDER_QA = "0";
const execFileAsync = promisify(execFile);

test("records explicit one-format and multi-format decisions without a default", async t => {
  const root = await temporary(t);
  const base = { artifact_type: "presentation", available_formats: ["html", "pptx"], source_id: "build-007", source_revision: "version-003", actor: "user:syna" };
  const first = await recordDeliverySelection(root, { ...base, id: "selection-001", formats: ["pptx"] });
  const second = await recordDeliverySelection(root, { ...base, id: "selection-002", formats: ["html", "pptx"] });
  assert.deepEqual(first.decision.formats, ["pptx"]);
  assert.deepEqual(second.decision.formats, ["html", "pptx"]);
  assert.deepEqual(await readDeliverySelection(root, "selection-002"), second.decision);
  await assert.rejects(recordDeliverySelection(root, { ...base, formats: [] }), { code: "DELIVERY_FORMAT_REQUIRED" });
  await assert.rejects(recordDeliverySelection(root, { ...base, formats: ["pptx"], actor: "agent" }), { code: "DELIVERY_USER_REQUIRED" });
  await assert.rejects(recordDeliverySelection(root, { ...base, id: "../escape", formats: ["pptx"] }), { code: "DELIVERY_SELECTION_INVALID" });
  await assert.rejects(recordDeliverySelection(root, { ...first.decision, available_formats: ["pptx"] }), { code: "EEXIST" });
  await fs.writeFile(first.manifest_file, JSON.stringify({ ...first.decision, formats: [] }));
  await assert.rejects(readDeliverySelection(root, first.decision.id), { code: "DELIVERY_SELECTION_INVALID" });
});

test("unavailable exporters preserve accepted work and expose alternatives", async t => {
  const root = await temporary(t);
  await assert.rejects(recordDeliverySelection(root, { artifact_type: "outline", formats: ["pdf"], available_formats: ["markdown", "docx"], source_id: "outline-main", source_revision: "abc", actor: "user" }), error => {
    assert.equal(error.code, "EXPORTER_UNAVAILABLE");
    assert.equal(error.details.unavailable[0].format, "pdf"); return true;
  });
  assert.deepEqual(deliveryCapabilities({ artifactType: "outline", availableFormats: ["markdown", "docx"] }).map(({ status }) => status), ["available", "available", "unavailable"]);
  await assert.rejects(fs.access(path.join(root, ".pptops", "delivery-selections")));
});

test("new projects defer outputs; outline export requires the exact explicit acceptance", async t => {
  const { root, service } = await fixture(t);
  assert.equal("outputs" in JSON.parse(await fs.readFile(path.join(root, "project.json"))), false);
  const source = service.outlineSource();
  const input = { artifactType: "outline", sourceId: source.source_id, sourceRevision: source.source_revision, formats: ["markdown", "docx"], actor: "user" };
  await assert.rejects(service.selectDelivery(input), { code: "OUTLINE_NOT_ACCEPTED" });
  await assert.rejects(service.approveOutline({ sourceRevision: "stale", actor: "user", rawFeedback: "Accept" }), { code: "OUTLINE_REVISION_MISMATCH" });
  const approval = await service.approveOutline({ sourceRevision: source.source_revision, actor: "user", rawFeedback: "Accept this exact outline" });
  const result = await service.selectDelivery({ ...input, approvalId: approval.id });
  assert.deepEqual(result.artifacts.map(({ format }) => format), ["markdown", "docx"]);
  const docx = await JSZip.loadAsync(await fs.readFile(result.artifacts[1].path));
  assert.match(await docx.file("word/document.xml").async("string"), /Delivery &amp; evidence/);
  assert.match(await fs.readFile(result.artifacts[0].path, "utf8"), /Delivery & evidence/);
  const oldHash = await hashFile(result.artifacts[1].path);
  const next = await service.selectDelivery({ ...input, formats: ["markdown"], approvalId: approval.id });
  assert.equal(next.artifacts.length, 1);
  assert.equal(await hashFile(result.artifacts[1].path), oldHash);
  assert.equal(await fs.readFile(path.join(root, "outline.json"), "utf8"), JSON.stringify(source.snapshot.outline, null, 2) + "\n");
  const pages = JSON.parse(await fs.readFile(path.join(root, "pages.json")));
  pages[0].task = "Changed after approval";
  await fs.writeFile(path.join(root, "pages.json"), JSON.stringify(pages));
  await assert.rejects(service.selectDelivery({ ...input, approvalId: approval.id }), { code: "OUTLINE_REVISION_MISMATCH" });
});

test("formal handoff selects only requested formats and preserves previous packages", async t => {
  const { root, service } = await fixture(t);
  await seedAcceptedBoundaryImages(root);
  const version = await service.freezeVersion();
  const { build } = await service.createBuild({ versionId: version.id, targets: ["html", "pptx"] });
  const { review } = await service.runReview(build.id);
  const accepted = await service.recordReview(review.id, { decision: "accepted", expectedRevision: review.revision, evidence: { source: "synthetic test acceptance" } });
  await assert.rejects(service.createHandoff(build.id, accepted.id), { code: "DELIVERY_SELECTION_REQUIRED" });
  const versionHash = await hashFile(path.join(root, ".pptops", "versions", version.id, "snapshot.json"));
  const select = formats => service.selectDelivery({ artifactType: "presentation", formats, sourceId: build.id, sourceRevision: version.id, actor: "user", buildId: build.id });
  const first = await select(["pptx"]);
  const one = await service.createHandoff(build.id, accepted.id, { deliverySelectionId: first.decision.id });
  const firstManifest = await fs.readFile(one.manifest_file, "utf8");
  assert.deepEqual(JSON.parse(firstManifest).outputs.map(({ name }) => name), ["review-report.json", "slides.pptx"]);
  const second = await select(["html", "pptx"]);
  const both = await service.createHandoff(build.id, accepted.id, { deliverySelectionId: second.decision.id });
  assert.deepEqual(JSON.parse(await fs.readFile(both.manifest_file)).outputs.map(({ name }) => name), ["review-report.json", "slides.html", "slides.pptx"]);
  assert.equal(await fs.readFile(one.manifest_file, "utf8"), firstManifest);
  assert.equal(await hashFile(path.join(root, ".pptops", "versions", version.id, "snapshot.json")), versionHash);
  await assert.rejects(service.createHandoff(build.id, accepted.id, { deliverySelectionId: "not-stored" }), { code: "DELIVERY_SELECTION_NOT_FOUND" });
});

test("PDF deck and outline exports retain approved source provenance", async t => {
  if (!await findBrowser()) { t.skip("Chromium is unavailable; unavailable-exporter coverage remains active"); return; }
  const { root, service } = await fixture(t, 3);
  await seedAcceptedBoundaryImages(root);
  const version = await service.freezeVersion();
  const { build } = await service.createBuild({ versionId: version.id, targets: ["html"] });
  const input = { artifactType: "presentation", formats: ["pdf"], sourceId: build.id, sourceRevision: version.id, actor: "user", buildId: build.id };
  await assert.rejects(service.selectDelivery(input), { code: "EXPORTER_UNAVAILABLE" });
  const { review } = await service.runReview(build.id);
  const accepted = await service.recordReview(review.id, { decision: "accepted", expectedRevision: review.revision, evidence: { source: "synthetic" } });
  const selected = await service.selectDelivery(input);
  const result = await service.createHandoff(build.id, accepted.id, { deliverySelectionId: selected.decision.id });
  const manifest = JSON.parse(await fs.readFile(result.manifest_file));
  assert.deepEqual(manifest.outputs.map(({ name }) => name).sort(), ["review-report.json", "slides.pdf"]);
  const pdf = await fs.readFile(path.join(result.package_dir, "slides.pdf"));
  assert.equal(pdf.subarray(0, 5).toString(), "%PDF-");
  assert.match(pdf.toString("latin1"), /\/Count 3\b/);
  assert.equal(selected.decision.pdf_source.review_id, review.id);
  assert.equal(selected.decision.pdf_source.sha256, await hashFile(path.join(root, selected.decision.pdf_source.file)));
  const source = service.outlineSource();
  const approval = await service.approveOutline({ sourceRevision: source.source_revision, actor: "user", rawFeedback: "Accept outline" });
  const outline = await service.selectDelivery({ artifactType: "outline", formats: ["pdf"], sourceId: source.source_id, sourceRevision: source.source_revision, actor: "user", approvalId: approval.id });
  assert.equal((await fs.readFile(outline.artifacts[0].path)).subarray(0,5).toString(), "%PDF-");
  const trace = JSON.parse(await fs.readFile(path.join(path.dirname(outline.manifest_file), "pdf-source.json")));
  assert.equal(trace.approval_id, approval.id);
  await fs.appendFile(path.join(root, selected.decision.pdf_source.file), "<!-- changed -->");
  await assert.rejects(service.createHandoff(build.id, accepted.id, { deliverySelectionId: selected.decision.id }), { code: "PDF_SOURCE_CHANGED" });
});

test("a build changed after automated review cannot receive stale acceptance", async t => {
  const { root, service } = await fixture(t);
  await seedAcceptedBoundaryImages(root);
  const version = await service.freezeVersion();
  const { build } = await service.createBuild({ versionId: version.id, targets: ["pptx"] });
  const { review } = await service.runReview(build.id);
  await fs.appendFile(path.join(root, `.pptops/builds/${build.id}/pptx/slides.pptx`), "changed");
  await assert.rejects(service.recordReview(review.id, { decision: "accepted", expectedRevision: review.revision }), { code: "REVIEW_SOURCE_CHANGED" });
  assert.equal(service.requireEntity("review", review.id).state, "human_pending");
});

test("CLI conversation can approve and export an outline before choosing presentation formats", async t => {
  const { root } = await fixture(t);
  const run = async (...args) => JSON.parse((await execFileAsync(process.execPath, [path.resolve("src/cli.js"), ...args], { encoding: "utf8" })).stdout).data;
  const source = await run("outline-source", root);
  const approval = await run("outline-approve", root, "--source-revision", source.source_revision, "--actor", "user", "--raw-feedback", "Accept; export Word and Markdown");
  const result = await run("delivery-select", root, "--artifact", "outline", "--formats", "docx,markdown", "--source", source.source_id, "--source-revision", source.source_revision, "--approval", approval.id, "--actor", "user");
  assert.deepEqual(result.decision.formats, ["docx", "markdown"]);
  assert.equal(result.artifacts.length, 2);
  await assert.rejects(fs.access(path.join(root, ".pptops", "builds")));
});

async function temporary(t) { const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-delivery-")); t.after(() => fs.rm(root, { recursive: true, force: true })); return root; }
async function fixture(t, count = 1) {
  const root = path.join(await temporary(t), "project");
  await initializeProject(root, { title: "Delivery & evidence" });
  if (count > 1) {
    const file = path.join(root, "pages.json");
    const [page] = JSON.parse(await fs.readFile(file));
    const pages = Array.from({ length: count }, (_, index) => ({ ...page, id: `page-00${index+1}`, page: index+1, speaker_notes: "Notes remain off-slide", screen_text: { title: `Page ${index+1}` } }));
    await fs.writeFile(file, JSON.stringify(pages));
    const outlineFile = path.join(root, "outline.json"); const outline = JSON.parse(await fs.readFile(outlineFile)); outline.sections[0].page_ids = pages.map(page => page.id); await fs.writeFile(outlineFile, JSON.stringify(outline));
  }
  const service = await ApplicationService.open(root); t.after(() => service.close()); return { root, service };
}
