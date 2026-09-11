import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import { withHtmlPage, findBrowser } from "../src/qa/html.js";
import { promisify } from "node:util";
import { ApplicationService } from "../src/application/service.js";
import { initializeProject } from "../src/core/init.js";
import { reindexProject } from "../src/doctor/index.js";
import { seedAcceptedBoundaryImages } from "./support/accepted-boundaries.js";

process.env.PPT_OPS_RENDER_QA = "0";
const execFileAsync = promisify(execFile);
const cli = path.resolve("src/cli.js");

test("creates a reusable offline package from one immutable HTML Build and Review", async (t) => {
  const { project, cleanup } = await fixture();
  const service = await ApplicationService.open(project);
  t.after(() => service.close());
  t.after(cleanup);
  const { build, review } = await formalReview(service);
  const packageResult = await service.createReviewerPackage(build.id, review.id, reviewBrief());
  const repeated = await service.createReviewerPackage(build.id, review.id, reviewBrief());

  assert.equal(packageResult.reused, false);
  assert.equal(repeated.reused, true);
  assert.equal(repeated.package_id, packageResult.package_id);
  const entry = await fs.readFile(packageResult.entry_file, "utf8");
  assert.match(entry, /Presentation review/);
  assert.match(entry, /Decisions requested/);
  assert.match(entry, /deck\.html#slide-1/);
  assert.match(entry, /Download response JSON/);
  assert.doesNotMatch(entry, new RegExp(build.id));
  assert.doesNotMatch(entry, new RegExp(review.id));
  assert.doesNotMatch(entry, /Establish the presentation promise/);
  assert.doesNotMatch(entry, /brief\.md/);
  assert.match(entry, /Speaker notes are not included/);

  const manifest = JSON.parse(await fs.readFile(packageResult.manifest_file, "utf8"));
  assert.equal(manifest.build.id, build.id);
  assert.equal(manifest.review.id, review.id);
  assert.equal(manifest.review.revision, review.revision);
  assert.equal(manifest.disclosures.speaker_notes, false);
  assert.equal(manifest.network_requests_required, false);
  assert.deepEqual(manifest.page_mapping.map(({ human_reference, page_spec_id }) => ({ human_reference, page_spec_id })), [{ human_reference: "slide-1", page_spec_id: "page-001" }]);
  assert.ok(manifest.included_artifacts.every(({ sha256 }) => /^[a-f0-9]{64}$/.test(sha256)));
  assert.equal(await fs.readFile(path.join(packageResult.package_dir, "deck.html"), "utf8"), await fs.readFile(path.join(project, `.pptops/builds/${build.id}/html/slides.html`), "utf8"));
  await fs.writeFile(path.join(packageResult.package_dir, "response-template.json"), "tampered");
  await assert.rejects(service.createReviewerPackage(build.id, review.id, reviewBrief()), { code: "REVIEW_PACKAGE_INTEGRITY_FAILED" });
});

test("requires explicit disclosure choices and never creates a preview by rebuilding", async (t) => {
  const { project, cleanup } = await fixture();
  const service = await ApplicationService.open(project);
  t.after(() => service.close());
  t.after(cleanup);
  const version = await service.freezeVersion();
  const { build } = await service.createBuild({ versionId: version.id, targets: ["pptx"] });
  const { review } = await service.runReview(build.id);

  await assert.rejects(service.createReviewerPackage(build.id, review.id, { ...reviewBrief(), disclosures: undefined }), { code: "DISCLOSURE_SELECTION_REQUIRED" });
  await assert.rejects(service.createReviewerPackage(build.id, review.id, reviewBrief()), { code: "REVIEW_PACKAGE_HTML_BUILD_REQUIRED" });
  await assert.rejects(fs.access(path.join(project, `.pptops/builds/${build.id}/html/slides.html`)));
});

test("imports page-addressable responses as append-only evidence and surfaces conflicts", async (t) => {
  const { project, cleanup } = await fixture();
  const service = await ApplicationService.open(project);
  t.after(() => service.close());
  t.after(cleanup);
  const { version, build, review } = await formalReview(service);
  const packageResult = await service.createReviewerPackage(build.id, review.id, reviewBrief());
  const template = JSON.parse(await fs.readFile(path.join(packageResult.package_dir, "response-template.json"), "utf8"));
  const reviewBefore = service.requireEntity("review", review.id);
  const firstFile = await responseFile(t, {
    ...template,
    reviewer: { name: "A Reviewer", role: "Sponsor", contact: "" },
    decision_time: "2026-09-12T14:00:00Z",
    overall: { decision: "approve", comment: "Ready for this audience." },
    pages: template.pages.map((page) => ({ ...page, decision: "comment", comment: "Keep this wording exactly." }))
  }, "first.json");
  const first = await service.importReviewerResponse(firstFile);

  assert.equal(first.stale, false);
  assert.equal(first.feedback.identity_verified, false);
  assert.deepEqual(first.feedback.reviewer, { name: "A Reviewer", role: "Sponsor" });
  assert.equal(first.feedback.pages[0].human_reference, "slide-1");
  assert.equal(first.feedback.pages[0].page_spec_id, "page-001");
  assert.equal(first.feedback.pages[0].comment, "Keep this wording exactly.");
  await fs.access(path.join(project, ".pptops", "reviewer-feedback", first.feedback.id, "manifest.json"));
  assert.equal(service.requireEntity("review", review.id).revision, reviewBefore.revision);
  assert.equal((await service.importReviewerResponse(firstFile)).reused, true);

  const conflictingFile = await responseFile(t, {
    ...template,
    reviewer: { name: "B Reviewer", role: "SME", contact: "b@example.test" },
    overall: { decision: "request_changes", comment: "The conclusion needs evidence." },
    pages: template.pages.map((page) => ({ ...page, decision: "request_changes", comment: "Please cite this claim." }))
  }, "conflict.json");
  const conflicting = await service.importReviewerResponse(conflictingFile);
  assert.deepEqual(conflicting.conflicts.map(({ scope }) => scope), ["deck"]);
  assert.equal(conflicting.feedback.reviewer.contact, "b@example.test");

  await service.createBuild({ versionId: version.id, targets: ["html"] });
  const staleFile = await responseFile(t, {
    ...template,
    reviewer: { name: "Late Reviewer", role: "", contact: "" },
    overall: { decision: "comment", comment: "I reviewed the earlier version." },
    pages: template.pages
  }, "stale.json");
  const stale = await service.importReviewerResponse(staleFile);
  assert.equal(stale.stale, true);
  assert.notEqual(stale.feedback.current_build_id, build.id);
  assert.equal(service.requireEntity("review", review.id).revision, reviewBefore.revision);
});

test("rejects tampered bindings, unknown pages, and ambiguous silence", async (t) => {
  const { project, cleanup } = await fixture();
  const service = await ApplicationService.open(project);
  t.after(() => service.close());
  t.after(cleanup);
  const { build, review } = await formalReview(service);
  const packageResult = await service.createReviewerPackage(build.id, review.id, reviewBrief());
  const template = JSON.parse(await fs.readFile(path.join(packageResult.package_dir, "response-template.json"), "utf8"));
  const empty = await responseFile(t, template, "empty.json");
  await assert.rejects(service.importReviewerResponse(empty), { code: "REVIEWER_RESPONSE_EMPTY" });

  const tampered = await responseFile(t, { ...template, binding_sha256: "0".repeat(64), overall: { decision: "approve", comment: "" } }, "tampered.json");
  await assert.rejects(service.importReviewerResponse(tampered), { code: "REVIEWER_RESPONSE_BINDING_MISMATCH" });

  const unknownPage = await responseFile(t, { ...template, overall: { decision: null, comment: "" }, pages: [{ human_reference: "slide-99", decision: "comment", comment: "Unknown" }] }, "unknown.json");
  await assert.rejects(service.importReviewerResponse(unknownPage), { code: "REVIEWER_RESPONSE_PAGE_UNKNOWN" });
});

test("CLI exposes package creation and response import with stable envelopes", async (t) => {
  const { project, cleanup } = await fixture();
  t.after(cleanup);
  const service = await ApplicationService.open(project);
  const { build, review } = await formalReview(service);
  service.close();

  const created = JSON.parse((await runCli("review-package-create", project, "--build", build.id, "--review", review.id, "--brief", JSON.stringify(reviewBrief()))).stdout);
  assert.equal(created.ok, true);
  assert.match(created.data.entry_file, /index\.html$/);
  const template = JSON.parse(await fs.readFile(path.join(created.data.package_dir, "response-template.json"), "utf8"));
  const file = await responseFile(t, { ...template, reviewer: { name: "CLI Reviewer", role: "", contact: "" }, overall: { decision: "approve", comment: "Approved for review purposes." }, pages: template.pages }, "cli.json");
  const imported = JSON.parse((await runCli("review-package-import", project, "--response", file)).stdout);
  assert.equal(imported.ok, true);
  assert.equal(imported.data.feedback.overall.decision, "approve");
  assert.equal(imported.data.feedback.identity_verified, false);
});

test("reindex restores portable reviewer feedback evidence", async (t) => {
  const { project, cleanup } = await fixture();
  t.after(cleanup);
  let feedbackId;
  const service = await ApplicationService.open(project);
  try {
    const { build, review } = await formalReview(service);
    const packageResult = await service.createReviewerPackage(build.id, review.id, reviewBrief());
    const template = JSON.parse(await fs.readFile(path.join(packageResult.package_dir, "response-template.json"), "utf8"));
    const file = await responseFile(t, { ...template, reviewer: { name: "Portable Reviewer", role: "", contact: "" }, overall: { decision: "comment", comment: "Keep this evidence." }, pages: template.pages }, "portable.json");
    feedbackId = (await service.importReviewerResponse(file)).feedback.id;
  } finally { service.close(); }

  const result = await reindexProject(project);
  assert.equal(result.counts.reviewer_feedback, 1);
  const restored = await ApplicationService.open(project);
  try { assert.equal(restored.store.listEntities(restored.projectId, "reviewer_feedback")[0].id, feedbackId); }
  finally { restored.close(); }
});

async function formalReview(service) {
  const version = await service.freezeVersion();
  const { build } = await service.createBuild({ versionId: version.id, targets: ["html"] });
  const { review } = await service.runReview(build.id);
  return { version, build, review };
}

function reviewBrief() {
  return {
    purpose: "Confirm that the launch story is clear.",
    audience: "Executive sponsor",
    scope: "Message clarity and launch decision only",
    requested_decisions: ["Can this deck be used for the launch meeting?"],
    change_summary: ["The opening now leads with the audience outcome."],
    deadline: "2026-09-15",
    disclosures: { speaker_notes: false, sources: false, prior_feedback: false }
  };
}

async function fixture({ notes = "", title } = {}) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-reviewer-feedback-"));
  const project = path.join(parent, "project");
  await initializeProject(project, { title: "Reviewer Feedback Package" });
  const pagesFile = path.join(project, "pages.json");
  const pages = JSON.parse(await fs.readFile(pagesFile, "utf8"));
  if (notes) pages[0].speaker_notes = notes;
  else delete pages[0].speaker_notes;
  if (title) pages[0].screen_text.title = title;
  await fs.writeFile(pagesFile, JSON.stringify(pages));
  await seedAcceptedBoundaryImages(project);
  return { project, cleanup: () => fs.rm(parent, { recursive: true, force: true }) };
}

async function responseFile(t, value, name) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-returned-feedback-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, name);
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function runCli(...args) { return execFileAsync(process.execPath, [cli, ...args], { encoding: "utf8" }); }

test("excluded notes block the whole package without changing the reviewed artifact", async (t) => {
  const marker = "PRIVATE_REVIEW_TEST_NOTE <client>";
  const { project, cleanup } = await fixture({ notes: marker });
  const service = await ApplicationService.open(project);
  t.after(() => service.close());
  t.after(cleanup);
  const { build, review } = await formalReview(service);
  const artifact = path.join(project, `.pptops/builds/${build.id}/html/slides.html`);
  const before = await fs.readFile(artifact);
  await assert.rejects(service.createReviewerPackage(build.id, review.id, reviewBrief()), { code: "REVIEW_PACKAGE_DISCLOSURE_UNSAFE" });
  await assert.rejects(fs.access(path.join(project, ".pptops/review-packages")));
  assert.deepEqual(await fs.readFile(artifact), before);
  const brief = reviewBrief();
  brief.disclosures.speaker_notes = true;
  const accepted = await service.createReviewerPackage(build.id, review.id, brief);
  assert.match(await fs.readFile(path.join(accepted.package_dir, "deck.html"), "utf8"), /PRIVATE_REVIEW_TEST_NOTE/);
  assert.match(await fs.readFile(accepted.entry_file, "utf8"), /Speaker notes are included/);
});

test("HTML-safe response data preserves closing-script titles and downloads valid JSON", async (t) => {
  const title = "Escaping </script> safely";
  const { project, cleanup } = await fixture({ title });
  const service = await ApplicationService.open(project);
  t.after(() => service.close());
  t.after(cleanup);
  const { build, review } = await formalReview(service);
  const result = await service.createReviewerPackage(build.id, review.id, reviewBrief());
  const entry = await fs.readFile(result.entry_file, "utf8");
  const scripts = [...entry.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)];
  assert.equal(scripts.length, 1);
  let submit, downloaded;
  const status = {};
  const link = { click() {} };
  const fields = new Map([["overall-decision", "approve"]]);
  vm.runInNewContext(scripts[0][1], {
    document: {
      getElementById: id => id === "feedback" ? { addEventListener(type, fn) { assert.equal(type, "submit"); submit = fn; } } : status,
      createElement: () => link
    },
    FormData: class { get(name) { return fields.get(name); } },
    structuredClone, Blob,
    URL: { createObjectURL(blob) { downloaded = blob; return "blob:test"; }, revokeObjectURL() {} },
    setTimeout: fn => fn()
  });
  submit({ preventDefault() {}, currentTarget: {} });
  const response = JSON.parse(await downloaded.text());
  assert.equal(response.pages[0].title, title);
  assert.equal(response.overall.decision, "approve");
  assert.equal(link.download, "review-response.json");
});

test("a changed Build artifact cannot inherit an earlier Review binding", async (t) => {
  const { project, cleanup } = await fixture();
  const service = await ApplicationService.open(project);
  t.after(() => service.close());
  t.after(cleanup);
  const { build, review } = await formalReview(service);
  await fs.appendFile(path.join(project, `.pptops/builds/${build.id}/html/slides.html`), "<!-- changed -->");
  await assert.rejects(service.createReviewerPackage(build.id, review.id, reviewBrief()), { code: "REVIEW_SOURCE_CHANGED" });
});

test("a newer sibling audience build does not make this review stale", async t => {
  const { project, cleanup } = await fixture();
  t.after(cleanup);
  const service = await ApplicationService.open(project);
  t.after(() => service.close());
  const base = await service.freezeVersion();
  for (const id of ["executive", "workshop"]) {
    const state = await service.manageAudienceVariants("list");
    await service.manageAudienceVariants("save", { expected_revision: state.revision, actor: "user", raw_feedback: "Synthetic acceptance for workflow testing", variant: { id, title: id, audience: id, purpose: "Review the story", base: { project_id: service.projectId, revision: base.id }, page_ids: ["page-001"] } });
  }
  const executive = await service.freezeVersion({ variantId: "executive" });
  const workshop = await service.freezeVersion({ variantId: "workshop" });
  const { build } = await service.createBuild({ versionId: executive.id, targets: ["html"] });
  const { review } = await service.runReview(build.id);
  const packet = await service.createReviewerPackage(build.id, review.id, reviewBrief());
  assert.equal(packet.manifest.build.variant.variant_id, "executive");
  await service.createBuild({ versionId: workshop.id, targets: ["html"] });
  const template = JSON.parse(await fs.readFile(path.join(packet.package_dir, "response-template.json")));
  const response = await responseFile(t, { ...template, overall: { decision: "approve", comment: "Executive approval" } }, "executive.json");
  assert.equal((await service.importReviewerResponse(response)).stale, false);
  await service.createBuild({ versionId: executive.id, targets: ["html"] });
  const repeated = await service.importReviewerResponse(response);
  assert.equal(repeated.reused, true);
  assert.equal(repeated.stale, true);
  assert.equal(repeated.feedback.stale, false); // Immutable evidence retains its original import status.
  const updatedBrief = { ...reviewBrief(), change_summary: ["Reviewing the old executive copy"] };
  const oldPacket = await service.createReviewerPackage(build.id, review.id, updatedBrief);
  assert.equal(oldPacket.manifest.version_status.newer_build_known, true);
  assert.match(await fs.readFile(oldPacket.entry_file, "utf8"), /A newer version was already available/);
  assert.equal(oldPacket.manifest.accessibility.status, "degraded");
});

test("a real offline browser loads the preview and downloads a page-addressable response", async t => {
  if (!await findBrowser()) { t.skip("Chromium unavailable"); return; }
  const { project, cleanup } = await fixture({ title: "Browser </script> check" });
  t.after(cleanup);
  const service = await ApplicationService.open(project);
  t.after(() => service.close());
  const { build, review } = await formalReview(service);
  const packet = await service.createReviewerPackage(build.id, review.id, reviewBrief());
  const downloads = path.join(project, "returned");
  await fs.mkdir(downloads);
  await withHtmlPage({ htmlFile: packet.entry_file }, async client => {
    await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloads });
    const tree = await client.send("Page.getFrameTree");
    assert.equal(tree.frameTree.childFrames.length, 1);
    assert.match(tree.frameTree.childFrames[0].frame.url, /deck\.html/);
    const preview = await client.send("Page.createIsolatedWorld", { frameId: tree.frameTree.childFrames[0].frame.id, worldName: "review-test" });
    const shown = await client.send("Runtime.evaluate", { contextId: preview.executionContextId, expression: `document.querySelector('.slide[aria-hidden="false"] h1').textContent`, returnByValue: true });
    assert.equal(shown.result.value, "Browser </script> check");
    const result = await client.send("Runtime.evaluate", { expression: `(() => { document.querySelector('[name="reviewer-name"]').value='Browser Reviewer'; document.querySelector('[name="overall-decision"][value="approve"]').checked=true; document.querySelector('[name="page-comment-0"]').value='Keep this wording.'; document.getElementById('feedback').requestSubmit(); return {status:document.getElementById('status').textContent,overflow:document.documentElement.scrollWidth>innerWidth}; })()`, returnByValue: true });
    assert.equal(result.result.value.overflow, false);
    assert.match(result.result.value.status, /Response downloaded/);
    const file = path.join(downloads, "review-response.json");
    let downloaded;
    for (let attempt = 0; attempt < 50; attempt++) {
      try { downloaded = JSON.parse(await fs.readFile(file, "utf8")); break; } catch (error) { if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error; await new Promise(resolve => setTimeout(resolve, 100)); }
    }
    assert.ok(downloaded);
    assert.equal(downloaded.overall.decision, "approve");
    assert.equal(downloaded.pages[0].comment, "Keep this wording.");
    assert.equal(downloaded.pages[0].title, "Browser </script> check");
    const imported = await service.importReviewerResponse(file);
    assert.equal(imported.feedback.pages[0].page_spec_id, "page-001");
    assert.equal(imported.feedback.identity_verified, false);
  });
});
