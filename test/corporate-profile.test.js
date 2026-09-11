import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { ApplicationService } from "../src/application/service.js";
import { initializeProject } from "../src/core/init.js";
import { seedAcceptedBoundaryImages } from "./support/accepted-boundaries.js";
import { findBrowser, withHtmlPage } from "../src/qa/html.js";
import { corporateRevision } from "../src/templates/corporate-profile.js";
process.env.PPT_OPS_RENDER_QA = "0";
const user = { actor: "user", raw_feedback: "Synthetic fixture decision: accept the selected rules" };

for (const format of ["pptx", "potx", "html", "pdf"]) test(`${format} selected corporate rules reach both renderers without importing facts`, async t => {
  const { root, service } = await fixture(t);
  const raw = await Promise.all(["pages.json", "sources.json", "theme.json"].map(file => fs.readFile(path.join(root, file), "utf8")));
  const imported = await source(service, root, format);
  const compared = await service.manageCorporateProfile("compare", { inspection_files: [imported.inspection_file] });
  const field = format === "pdf" ? "page_dimensions" : "theme_colors";
  const index = imported.profile.observations.findIndex(item => item.field === field);
  const accepted = await service.manageCorporateProfile("accept", { ...user, inspection_files: [imported.inspection_file], inspection_revisions: { [imported.inspection_file]: compared.inspections[0].sha256 }, selections: [{ inspection_file: imported.inspection_file, observation_index: index, value_index: 0, target: format === "pdf" ? "dimensions" : "colors.text" }], layout_mappings: [{ inspection_file: imported.inspection_file, ...(format === "pptx" || format === "potx" ? { layout_id: "slidelayout1" } : { reference_page: 1 }), semantic_family: "hero", page_ids: ["page-001"] }] });
  assert.equal(service.project.contracts.project.corporate_profile, undefined);
  const state = await service.manageCorporateProfile("status");
  await service.manageCorporateProfile("apply", { ...user, file: accepted.file, sha256: accepted.sha256, expected_revision: state.project_revision });
  assert.deepEqual(await Promise.all(["pages.json", "sources.json", "theme.json"].map(file => fs.readFile(path.join(root, file), "utf8"))), raw);
  const version = await service.freezeVersion();
  const frozen = await service.projectFromVersion(version.id);
  assert.equal(frozen.pages[0].template_id, "template-hero");
  assert.equal(version.corporate_profile.sha256, accepted.sha256);
  assert.equal((await service.freezeVersion()).id, version.id);
  const { build } = await service.createBuild({ versionId: version.id, targets: ["html", "pptx"] });
  assert.deepEqual(build.config.corporate_profile, version.corporate_profile);
  const html = await fs.readFile(path.join(root, `.pptops/builds/${build.id}/html/slides.html`), "utf8");
  const pptx = await JSZip.loadAsync(await fs.readFile(path.join(root, `.pptops/builds/${build.id}/pptx/slides.pptx`)));
  if (format !== "pdf") { assert.match(html, /#123456/i); assert.match(await pptx.file("ppt/slides/slide1.xml").async("string"), /123456/); }
  assert.equal(html.includes("PRIVATE CORPORATE CLAIM"), false);
  const { review, report } = await service.runReview(build.id);
  assert.deepEqual(review.corporate_profile, version.corporate_profile);
  assert.deepEqual(report.corporate_profile, version.corporate_profile);
  const approved = await service.recordReview(review.id, { decision: "accepted", expectedRevision: review.revision, evidence: { source: "synthetic test only" } });
  const selected = await service.selectDelivery({ artifactType: "presentation", formats: ["pptx"], sourceId: build.id, sourceRevision: version.id, actor: "user", buildId: build.id });
  const handoff = await service.createHandoff(build.id, approved.id, { deliverySelectionId: selected.decision.id });
  assert.deepEqual(JSON.parse(await fs.readFile(handoff.manifest_file)).corporate_profile, version.corporate_profile);
  assert.equal(accepted.profile.evidence.real_powerpoint, "pending");
  const variant = { id: "executive", title: "Executive", audience: "Board", purpose: "Decision", base: { project_id: service.projectId, revision: version.id }, page_ids: ["page-001"], page_overrides: [{ page_id: "page-001", patch: { theme_override: { colors: { accent: "#ABCDEF" } } } }], section_overrides: [] };
  await service.manageAudienceVariants("save", { ...user, variant, expected_revision: (await service.manageAudienceVariants("list")).revision });
  const derived = await service.freezeVersion({ variantId: "executive" });
  assert.deepEqual(derived.corporate_profile, version.corporate_profile);
  assert.equal((await service.projectFromVersion(derived.id)).pages[0].theme_override.colors.accent, "#ABCDEF");
  assert.equal(frozen.pages[0].theme_override, undefined);
});

test("corporate acceptance fails closed on stale revisions, source edits and unresolved precedence", async t => {
  const { root, service } = await fixture(t);
  const first = await source(service, root, "html"), second = await source(service, root, "pptx");
  const files = [first.inspection_file, second.inspection_file];
  const compared = await service.manageCorporateProfile("compare", { inspection_files: files });
  const input = { ...user, inspection_files: files, inspection_revisions: Object.fromEntries(compared.inspections.map(item => [item.file, item.sha256])), selections: [{ inspection_file: first.inspection_file, observation_index: first.profile.observations.findIndex(item => item.field === "theme_colors"), value_index: 0, target: "colors.accent" }] };
  await assert.rejects(service.manageCorporateProfile("accept", { ...input, actor: "agent" }), { code: "CORPORATE_USER_REQUIRED" });
  await assert.rejects(service.manageCorporateProfile("accept", { ...input, inspection_revisions: {} }), { code: "CORPORATE_INSPECTION_STALE" });
  await assert.rejects(service.manageCorporateProfile("accept", input), { code: "CORPORATE_PRECEDENCE_REQUIRED" });
  input.precedence = Object.fromEntries(compared.conflicts.map(conflict => [conflict.field, first.profile.id]));
  const accepted = await service.manageCorporateProfile("accept", input);
  await assert.rejects(service.manageCorporateProfile("apply", { ...user, ...accepted, expected_revision: "old" }), { code: "CORPORATE_PROJECT_STALE" });
  await fs.writeFile(path.join(root, first.profile.source.file), "changed");
  await assert.rejects(service.manageCorporateProfile("apply", { ...user, ...accepted, expected_revision: corporateRevision(service.project.contracts.project) }), { code: "CORPORATE_SOURCE_CHANGED" });
});

test("HTML visual reference blocks scripts and every local/network subresource", async t => {
  if (!await findBrowser()) return t.skip("Chromium unavailable");
  const { root, service } = await fixture(t);
  const html = path.join(root, "untrusted.html");
  await fs.writeFile(html, `<html><script>globalThis.executed = true</script><body onload="globalThis.executed=true"><section style="width:1200px;height:675px;color:#123456">Reference</section><img src="file:///etc/hosts"><img src="https://example.com/private"><iframe src="file:///etc/hosts"></iframe></body></html>`);
  const imported = await service.manageCorporateProfile("import", { file: html });
  await withHtmlPage({ htmlFile: html, isolatedDocument: true }, async client => {
    const result = await client.send("Runtime.evaluate", { expression: `({ executed: Boolean(globalThis.executed), loaded: [...document.images].some(image => image.naturalWidth > 0) })`, returnByValue: true });
    assert.deepEqual(result.result.value, { executed: false, loaded: false });
  });
  const preview = await service.manageCorporateProfile("preview", { inspection_file: imported.inspection_file });
  assert.equal(preview.status, "rendered");
  assert.equal(preview.observations.pages[0].width, 1200);
  assert.equal(preview.observations.pages[0].color, "rgb(18, 52, 86)");
  assert.ok((await fs.stat(path.join(root, preview.screenshot.file))).size > 100);
  assert.equal(preview.real_powerpoint, "pending");
});

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-corporate-profile-"));
  await initializeProject(root, { name: "brand-workflow", title: "Project facts" });
  await seedAcceptedBoundaryImages(root);
  const service = await ApplicationService.open(root);
  t.after(async () => { service.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { root, service };
}
async function source(service, root, format) {
  const file = path.join(root, `brand.${format}`);
  if (format === "html") await fs.writeFile(file, '<html><style>section{width:1600px;height:900px;color:#123456;font-family:Arial}</style><section>PRIVATE CORPORATE CLAIM</section></html>');
  else if (format === "pdf") await fs.writeFile(file, '%PDF-1.4\n1 0 obj << /Type /Page /MediaBox [0 0 960 540] >> endobj\n%%EOF');
  else {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", "<Types/>"); zip.file("ppt/presentation.xml", '<p:presentation><p:sldSz cx="12192000" cy="6858000"/></p:presentation>');
    zip.file("ppt/theme/theme1.xml", '<a:theme><a:srgbClr val="123456"/><a:srgbClr val="654321"/><a:latin typeface="Arial"/></a:theme>');
    zip.file("ppt/slideLayouts/slideLayout1.xml", '<p:sldLayout type="title"><p:cSld name="Brand title"/></p:sldLayout>');
    zip.file("ppt/slides/slide1.xml", "PRIVATE CORPORATE CLAIM");
    await fs.writeFile(file, await zip.generateAsync({ type: "nodebuffer" }));
  }
  return service.manageCorporateProfile("import", { file });
}
