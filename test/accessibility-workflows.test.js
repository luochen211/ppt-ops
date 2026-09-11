import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { ApplicationService } from "../src/application/service.js";
import { initializeProject } from "../src/core/init.js";
import { seedAcceptedBoundaryImages } from "./support/accepted-boundaries.js";
import { auditAccessibility, contrastRatio } from "../src/accessibility/index.js";
import { auditAccessibilityArtifacts, auditStoredBuild } from "../src/accessibility/artifacts.js";
import { findBrowser, withHtmlPage } from "../src/qa/html.js";
import { buildHtml } from "../src/adapters/html.js";
import { buildPptx } from "../src/adapters/pptx.js";
process.env.PPT_OPS_RENDER_QA = "0";
const profile = { enabled: true, intent: "create_accessible", document_language: "fr-CA", reading_direction: "ltr", target_formats: ["html", "pptx"], text_scale: 1.5 };

test("accessible creation writes real language, scaled editable text, descriptions and separate reading order evidence", async t => {
  const { root, service } = await fixture(t);
  const version = await service.freezeVersion();
  const { build } = await service.createBuild({ versionId: version.id, targets: ["html", "pptx"] });
  const htmlFile = path.join(root, `.pptops/builds/${build.id}/html/slides.html`), pptxFile = path.join(root, `.pptops/builds/${build.id}/pptx/slides.pptx`);
  const html = await fs.readFile(htmlFile, "utf8");
  assert.match(html, /<html lang="fr-CA" dir="ltr">/);
  assert.match(html, /font-size:114px/);
  assert.match(html, /lang="en-GB"/);
  assert.match(html, /scope="col"/);
  assert.match(html, /href="https:\/\/example.com\/facts"/);
  const zip = await JSZip.loadAsync(await fs.readFile(pptxFile));
  assert.match(await zip.file("docProps/core.xml").async("string"), /<dc:language>fr-CA<\/dc:language>/);
  const first = await zip.file("ppt/slides/slide1.xml").async("string"), second = await zip.file("ppt/slides/slide2.xml").async("string");
  assert.match(first, /lang="fr-CA"/); assert.match(first, /sz="5100"/); assert.doesNotMatch(first, /normAutofit/); assert.match(first, /Detailed alternative with the supporting data/);
  assert.match(second, /lang="en-GB"/); assert.match(second, /<a:t>/);
  const before = await hashes([htmlFile, pptxFile, path.join(root, "pages.json"), path.join(root, ".pptops/metadata.sqlite")]);
  const audit = await auditStoredBuild(service.project, build.id);
  assert.deepEqual(await hashes([htmlFile, pptxFile, path.join(root, "pages.json"), path.join(root, ".pptops/metadata.sqlite")]), before);
  assert.equal(audit.build_revision, build.id);
  assert.equal(audit.artifacts.find(item => item.format === "pptx").pages[1].languages[0], "en-GB");
  assert.ok(audit.findings.some(item => item.rule === "pptx-reading-order" && item.target.id === "page-001"));
  if (await findBrowser()) assert.equal(audit.findings.some(item => item.rule === "html-reading-order" && item.target.id === "page-001"), false);
  assert.equal(audit.evidence.find(item => item.kind === "assistive_technology").status, "pending");
  assert.equal(audit.evidence.find(item => item.kind === "powerpoint_accessibility_checker").status, "pending");
  assert.equal(audit.claims.legal_or_policy_conformance, "not_claimed");
  const { review } = await service.runReview(build.id);
  const accepted = await service.recordReview(review.id, { decision: "accepted", expectedRevision: review.revision, evidence: { source: "Synthetic handoff fixture only" } });
  const selected = await service.selectDelivery({ artifactType: "presentation", formats: ["pptx"], sourceId: build.id, sourceRevision: version.id, actor: "user", buildId: build.id });
  const handoff = await service.createHandoff(build.id, accepted.id, { deliverySelectionId: selected.decision.id });
  const manifest = JSON.parse(await fs.readFile(handoff.manifest_file));
  assert.deepEqual(manifest.accessibility.declared_profile, profile);
  assert.equal(manifest.accessibility.artifact_audits.length, 2);
  assert.equal(manifest.accessibility.evidence.find(item => item.kind === "assistive_technology").status, "pending");
  const reviewed = JSON.parse(await fs.readFile(path.join(root, review.report_file))); reviewed.automated_checks = [];
  await fs.writeFile(path.join(root, review.report_file), JSON.stringify(reviewed));
  await assert.rejects(service.createHandoff(build.id, accepted.id, { deliverySelectionId: selected.decision.id }), { code: "REVIEW_REPORT_CHANGED" });
});

test("page-scoped remediation preserves siblings and requires both current audit and explicit acceptance", async t => {
  const { root, service } = await fixture(t);
  const frozen = await service.freezeVersion(), frozenFile = path.join(root, `.pptops/versions/${frozen.id}/snapshot.json`);
  const oldHash = (await hashes([frozenFile]))[0];
  const audit = auditAccessibility(service.project), pagesBefore = JSON.parse(await fs.readFile(path.join(root, "pages.json")));
  await assert.rejects(service.proposeAccessibilityRemediation({ source_revision: "old", page_id: "page-002", patch: { screen_text: { title: "Corrected" } }, reason: "Name the decision" }), { code: "ACCESSIBILITY_AUDIT_STALE" });
  const proposed = await service.proposeAccessibilityRemediation({ source_revision: audit.source_revision, page_id: "page-002", patch: { screen_text: { title: "Decide the next step" } }, reason: "A unique title explains this page" });
  assert.equal(proposed.applied, false);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root, "pages.json"))), pagesBefore);
  await assert.rejects(service.acceptCandidate(proposed.candidate.id, proposed.candidate.revision, "Synthetic acceptance"), { code: "ILLEGAL_RESUME_EVENT" });
  const rendered = await service.renderCandidate(proposed.candidate.id, proposed.candidate.revision);
  const observed = service.recordPowerPointObservation(proposed.candidate.id, { expectedRevision: rendered.candidate.revision, status: "viewed", evidence: { application: "Microsoft PowerPoint", ...rendered.render_evidence, source: "Synthetic contract fixture only" } });
  await service.acceptCandidate(proposed.candidate.id, observed.candidate.revision, "Synthetic fixture: accept this page correction");
  const after = JSON.parse(await fs.readFile(path.join(root, "pages.json")));
  assert.equal(after[1].screen_text.title, "Decide the next step");
  assert.deepEqual(after[0], pagesBefore[0]); assert.deepEqual(after[2], pagesBefore[2]);
  assert.equal((await hashes([frozenFile]))[0], oldHash);
  await assert.rejects(service.proposeAccessibilityRemediation({ source_revision: audit.source_revision, page_id: "page-002", patch: { screen_text: { title: "Stale correction" } }, reason: "Old report" }), { code: "ACCESSIBILITY_AUDIT_STALE" });
});

test("large-text overflow blocks both renderers without silently shrinking", async t => {
  const { root, service } = await fixture(t);
  const project = structuredClone(service.project); project.pages[1].screen_text.title = "A".repeat(90);
  await assert.rejects(buildHtml(project), { code: "ACCESSIBILITY_TEXT_OVERFLOW" });
  await assert.rejects(buildPptx(project, path.join(root, "overflow.pptx")), { code: "ACCESSIBILITY_TEXT_OVERFLOW" });
  assert.equal(auditAccessibility(project).status, "failed");
});

test("contrast considers resolved page overrides and retains uncertain regions", async t => {
  const { service } = await fixture(t);
  assert.equal(contrastRatio("#000000", "#ffffff"), 21);
  assert.equal(contrastRatio("#123456", "#123456"), 1);
  assert.equal(contrastRatio("var(--unknown)", "#fff"), null);
  const project = structuredClone(service.project); project.pages[1].theme_override = { colors: { text: "#EEEEEE", background: "#FFFFFF" } }; project.pages[1].accessibility.text_on_image = true;
  const audit = auditAccessibility(project);
  assert.ok(audit.findings.some(item => item.rule === "resolved-theme-contrast" && item.target.id === "page-002"));
  assert.ok(audit.findings.some(item => item.rule === "text-on-image-contrast" && item.verification === "human_required"));
});

test("HTML supports actual keyboard navigation, names, focus, language and semantic alternatives", async t => {
  if (!await findBrowser()) return t.skip("Chromium unavailable");
  const { root, service } = await fixture(t);
  const file = path.join(root, "accessible.html"); await fs.writeFile(file, await buildHtml(service.project));
  await withHtmlPage({ htmlFile: file }, async client => {
    const evaluate = async expression => (await client.send("Runtime.evaluate", { expression, returnByValue: true })).result.value;
    assert.equal(await evaluate('document.querySelector("section[aria-hidden=false]").dataset.page'), "1");
    await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
    assert.equal(await evaluate('document.querySelector("section[aria-hidden=false]").dataset.page'), "2");
    await evaluate('document.querySelector("[data-nav=next]").focus()');
    assert.deepEqual(await evaluate('({name:document.activeElement.getAttribute("aria-label"),width:getComputedStyle(document.activeElement).outlineWidth})'), { name: "Next slide", width: "3px" });
    await evaluate('document.querySelector("[data-nav=previous]").focus()');
    await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
    await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: " ", code: "Space", windowsVirtualKeyCode: 32 });
    assert.equal(await evaluate('document.querySelector("section[aria-hidden=false]").dataset.page'), "1");
    await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
    await evaluate(`document.querySelector('section[data-page="2"] details').open=true`);
    assert.equal(await evaluate(`document.querySelector('section[data-page="2"] th').getAttribute('scope')`), "col");
    assert.equal(await evaluate(`document.querySelector('section[data-page="2"] a').getAttribute('href')`), "https://example.com/facts");
    await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "End", code: "End", windowsVirtualKeyCode: 35 });
    assert.equal(await evaluate('document.querySelector("section[aria-hidden=false]").dataset.page'), "3");
  });
});

test("an inaccessible HTML artifact produces findings without modifying the file", async t => {
  if (!await findBrowser()) return t.skip("Chromium unavailable");
  const { root, service } = await fixture(t);
  const file = path.join(root, "inaccessible.html");
  await fs.writeFile(file, '<html><body><section data-page="1"><img src="data:image/png;base64,"><button></button></section></body></html>');
  const database = path.join(root, ".pptops/metadata.sqlite");
  const before = await hashes([file, database]);
  const report = JSON.parse(execFileSync(process.execPath, [path.resolve("src/cli.js"), "accessibility-audit", root, "--html-file", file], { encoding: "utf8" }));
  assert.equal(report.status, "failed");
  assert.ok(report.findings.some(item => item.rule === "html-image-description"));
  assert.ok(report.findings.some(item => item.rule === "html-control-name"));
  assert.ok(report.findings.some(item => item.rule === "html-document-language"));
  assert.deepEqual(await hashes([file, database]), before);
});

test("RTL reaches real PowerPoint text properties", async t => {
  const { root, service } = await fixture(t);
  const project = structuredClone(service.project); project.project.accessibility_profile = { ...profile, document_language: "ar", reading_direction: "rtl" };
  const file = path.join(root, "rtl.pptx"); await buildPptx(project, file);
  const zip = await JSZip.loadAsync(await fs.readFile(file));
  assert.match(await zip.file("ppt/slides/slide1.xml").async("string"), /rtl="1"/);
  assert.match(await zip.file("docProps/core.xml").async("string"), /<dc:language>ar<\/dc:language>/);
});

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-accessible-workflow-"));
  await initializeProject(root, { name: "accessible-workflow", title: "A clear shared project", accessibilityProfile: profile });
  const first = JSON.parse(await fs.readFile(path.join(root, "pages.json")))[0];
  const pages = Array.from({ length: 3 }, (_, index) => ({ ...structuredClone(first), id: `page-00${index + 1}`, page: index + 1, relation: index === 1 ? "parallel" : "hero", screen_text: { title: ["The shared purpose", "A supported decision", "The next step"][index], ...(index === 1 ? { body: ["Evidence supports this choice"] } : {}) }, accessibility: { reading_order: index === 1 ? ["title", "message", "body", "alternatives"] : ["title", "assets"], ...(index === 1 ? { language: "en-GB", links: [{ label: "Supporting facts", destination: "https://example.com/facts" }], tables: [{ title: "Results", headers: ["Metric", "Value"], rows: [["Count", "10"]], simple_structure: true }] } : {}) } }));
  const outline = JSON.parse(await fs.readFile(path.join(root, "outline.json"))); outline.sections[0].page_ids = pages.map(page => page.id);
  await fs.writeFile(path.join(root, "pages.json"), JSON.stringify(pages)); await fs.writeFile(path.join(root, "outline.json"), JSON.stringify(outline));
  await seedAcceptedBoundaryImages(root);
  const assets = JSON.parse(await fs.readFile(path.join(root, "assets.json"))); assets[0].long_description = "Detailed alternative with the supporting data.";
  await fs.writeFile(path.join(root, "assets.json"), JSON.stringify(assets));
  const service = await ApplicationService.open(root);
  t.after(async () => { service.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, service };
}
async function hashes(files) { return Promise.all(files.map(async file => crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex"))); }
