import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { ApplicationService } from "../src/application/service.js";
import { initializeProject } from "../src/core/init.js";
import { createRefinementScope, inspectRefinementPptx } from "../src/refinement/pptx-inspection.js";

test("refinement inspection assigns stable object identities and reports unsupported features", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-refinement-inspect-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "existing.pptx");
  const bytes = await refinementPptx();
  await fs.writeFile(file, bytes);
  const source = { id: "source-existing", sha256: sha(bytes), original_name: "existing.pptx", bytes: bytes.length };

  const first = await inspectRefinementPptx(file, source);
  const second = await inspectRefinementPptx(file, source);
  assert.deepEqual(second, first);
  assert.equal(first.slide_count, 2);
  assert.deepEqual(first.object_counts, { text_box: 1, picture: 1, chart: 1 });
  assert.deepEqual(first.findings.map(({ slide, feature }) => ({ slide, feature })), [
    { slide: 1, feature: "animation_or_timing" },
    { slide: 2, feature: "chart_editing_pending" }
  ]);
  assert.equal(first.slides[0].objects[0].text_sha256, sha(Buffer.from("Confidential result 42")));
  assert.equal(JSON.stringify(first).includes("Confidential result 42"), false);
  await assert.rejects(inspectRefinementPptx(file, { ...source, sha256: "0".repeat(64) }), { code: "REFINEMENT_SOURCE_CHANGED" });
});

test("refinement scope permits only explicit visual properties on supported objects", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-refinement-scope-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "existing.pptx");
  const bytes = await refinementPptx();
  await fs.writeFile(file, bytes);
  const inspection = await inspectRefinementPptx(file, { id: "source-existing", sha256: sha(bytes), original_name: "existing.pptx", bytes: bytes.length });
  const textBox = inspection.slides[0].objects.find((object) => object.type === "text_box");
  const anchor = { inspectionFile: ".pptops/refinement/inspections/example/inspection.json", inspectionSha256: "a".repeat(64) };
  const scope = createRefinementScope(inspection, { ...anchor, actor: "user:syna", targets: [{ slide: 1, object_id: textBox.id, properties: ["font_size", "position"], objective: "Improve hierarchy" }] });
  assert.deepEqual(scope.targets[0].properties, ["font_size", "position"]);
  assert.equal(scope.preservation.text, true);
  assert.equal(scope.acceptance.real_powerpoint, "pending");
  assert.equal(scope.inspection_sha256, "a".repeat(64));
  assert.equal(scope.targets[0].object_fingerprint, textBox.fingerprint);
  assert.throws(() => createRefinementScope(inspection, { ...anchor, actor: "user:syna", targets: [{ slide: 1, object_id: textBox.id, properties: ["text"] }] }), { code: "REFINEMENT_PROPERTY_FORBIDDEN" });
  const chart = inspection.slides[1].objects.find((object) => object.type === "chart");
  assert.throws(() => createRefinementScope(inspection, { ...anchor, actor: "user:syna", targets: [{ slide: 2, object_id: chart.id, properties: ["fill_color"] }] }), { code: "REFINEMENT_OBJECT_UNSUPPORTED" });
});

test("inspection follows presentation order and reports unsupported objects without broadcasting", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-refinement-edge-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, "edge.pptx"), bytes = await edgeCasePptx();
  await fs.writeFile(file, bytes);
  const report = await inspectRefinementPptx(file, { id: "source-edge", sha256: sha(bytes), original_name: "edge.pptx", bytes: bytes.length });
  assert.equal(report.slides[0].part, "ppt/slides/slide2.xml");
  assert.equal(report.slides[1].part, "ppt/slides/slide1.xml");
  assert.deepEqual(report.slides[0].objects.map((object) => object.type), ["media", "table", "ole_object", "connector"]);
  assert.deepEqual(report.slides[0].unsupported.map((finding) => finding.feature), ["media", "table", "ole_object", "connector"]);
  assert.ok(report.slides[0].unsupported.every((finding) => finding.object_id));
  assert.equal(report.slides[1].objects.length, 1, "AlternateContent Choice and Fallback must not duplicate an object");
  const object = report.slides[1].objects[0];
  assert.deepEqual(object.locator, { slide: 2, native_id: "20" });
  assert.equal(object.id, "slide-002-object-20");
  assert.match(object.fingerprint, /^[a-f0-9]{16}$/);
});

test("application service stores the original, inspection, and idempotent scope without editing the PPTX", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-refinement-service-"));
  const projectDir = path.join(root, "project");
  await initializeProject(projectDir, { name: "refinement-fixture", title: "Refinement Fixture" });
  const input = path.join(root, "existing.pptx");
  const bytes = await refinementPptx();
  await fs.writeFile(input, bytes);
  const service = await ApplicationService.open(projectDir);
  try {
    const inspected = await service.inspectPptxRefinement(input);
    const textBox = inspected.inspection.slides[0].objects.find((object) => object.type === "text_box");
    const request = { sourceId: inspected.source.id, actor: "user:syna", targets: [{ slide: 1, object_id: textBox.id, properties: ["position"] }] };
    const first = await service.proposePptxRefinementScope(request);
    const second = await service.proposePptxRefinementScope(request);
    assert.equal(second.scope.id, first.scope.id);
    assert.equal(first.scope.inspection_file, inspected.inspection_file.replaceAll("\\", "/"));
    assert.match(first.scope.inspection_sha256, /^[a-f0-9]{64}$/);
    assert.equal(sha(await fs.readFile(path.join(projectDir, inspected.source.file))), sha(bytes));
    assert.equal(JSON.parse(await fs.readFile(path.join(projectDir, first.scope_file), "utf8")).acceptance.user_decision, "pending");
  } finally {
    service.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("application service rejects modified inspection evidence", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-refinement-integrity-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const projectDir = path.join(root, "project");
  await initializeProject(projectDir, { name: "integrity-fixture", title: "Integrity Fixture" });
  const input = path.join(root, "existing.pptx"), bytes = await refinementPptx();
  await fs.writeFile(input, bytes);
  const service = await ApplicationService.open(projectDir);
  try {
    const inspected = await service.inspectPptxRefinement(input);
    const inspectionFile = path.join(projectDir, inspected.inspection_file);
    const changed = JSON.parse(await fs.readFile(inspectionFile, "utf8"));
    changed.slide_count = 999;
    await fs.writeFile(inspectionFile, `${JSON.stringify(changed, null, 2)}\n`);
    await assert.rejects(service.proposePptxRefinementScope({ sourceId: inspected.source.id, actor: "user:syna", targets: [{ slide: 1, object_id: inspected.inspection.slides[0].objects[0].id, properties: ["position"] }] }), { code: "REFINEMENT_INSPECTION_CHANGED" });
  } finally { service.close(); }
});

test("Stage 2 creates an immutable scoped Candidate and preserves the original PPTX", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-refinement-candidate-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const projectDir = path.join(root, "project");
  await initializeProject(projectDir, { name: "candidate-fixture", title: "Candidate Fixture" });
  const input = path.join(root, "existing.pptx"), bytes = await refinementPptx();
  await fs.writeFile(input, bytes);
  const service = await ApplicationService.open(projectDir);
  try {
    const inspected = await service.inspectPptxRefinement(input);
    const textBox = inspected.inspection.slides[0].objects.find((object) => object.type === "text_box");
    const scoped = await service.proposePptxRefinementScope({ sourceId: inspected.source.id, actor: "user:syna", targets: [{ slide: 1, object_id: textBox.id, properties: ["position", "font_size"] }] });
    const request = { sourceId: inspected.source.id, scopeId: scoped.scope.id, actor: "user:syna", changes: [{ slide: 1, object_id: textBox.id, properties: { position: { x: 120, y: 240 }, font_size: 24 } }] };
    const first = await service.createPptxRefinementCandidate(request);
    const second = await service.createPptxRefinementCandidate(request);
    assert.equal(second.candidate.id, first.candidate.id);
    assert.deepEqual(first.candidate.operations[0].properties, ["font_size", "position"]);
    assert.equal(first.candidate.original_preserved, true);
    assert.equal(sha(await fs.readFile(path.join(projectDir, inspected.source.file))), sha(bytes));
    const candidateBytes = await fs.readFile(path.join(projectDir, first.candidate_file));
    assert.notEqual(sha(candidateBytes), sha(bytes));
    const archive = await JSZip.loadAsync(candidateBytes);
    const slide = await archive.file("ppt/slides/slide1.xml").async("string");
    assert.match(slide, /<a:off x="120" y="240"\/>/);
    assert.match(slide, /<a:rPr sz="2400"\/>/);
    const reviewed = await service.reviewPptxRefinementCandidate(first.candidate.id);
    assert.equal(reviewed.diff.passed, true);
    assert.deepEqual(reviewed.diff.changed_parts, ["ppt/slides/slide1.xml"]);
    assert.equal(await fs.readFile(path.join(projectDir, reviewed.preview_file), "utf8").then((value) => value.includes("Scoped refinement preview")), true);
    await assert.rejects(service.createPptxRefinementCandidate({ ...request, changes: [{ slide: 1, object_id: textBox.id, properties: { fill_color: "FF0000" } }] }), { code: "REFINEMENT_PROPERTY_FORBIDDEN" });
  } finally { service.close(); }
});

async function refinementPptx() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("ppt/presentation.xml", "<p:presentation/>");
  zip.file("ppt/slides/slide1.xml", `<p:sld><p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/></p:nvSpPr><p:spPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="300" cy="400"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:rPr sz="1800"/><a:t>Confidential result 42</a:t></a:r></a:p></p:txBody></p:sp>
    <p:pic><p:nvPicPr><p:cNvPr id="3" name="Photo"/></p:nvPicPr><p:spPr><a:xfrm><a:off x="500" y="600"/><a:ext cx="700" cy="800"/></a:xfrm></p:spPr></p:pic>
  </p:spTree></p:cSld><p:timing/></p:sld>`);
  zip.file("ppt/slides/slide2.xml", `<p:sld><p:cSld><p:spTree><p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Chart"/></p:nvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"/></a:graphic></p:graphicFrame></p:spTree></p:cSld></p:sld>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

async function edgeCasePptx() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("ppt/presentation.xml", `<p:presentation><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`);
  zip.file("ppt/_rels/presentation.xml.rels", `<Relationships><Relationship Id="rId2" Target="slides/slide1.xml"/><Relationship Id="rId3" Target="slides/slide2.xml"/></Relationships>`);
  zip.file("ppt/slides/slide1.xml", `<p:sld><p:cSld><p:spTree><mc:AlternateContent><mc:Choice Requires="a14"><p:sp><p:nvSpPr><p:cNvPr id="20" name="Choice"/></p:nvSpPr><p:spPr/></p:sp></mc:Choice><mc:Fallback><p:sp><p:nvSpPr><p:cNvPr id="20" name="Fallback"/></p:nvSpPr><p:spPr/></p:sp></mc:Fallback></mc:AlternateContent></p:spTree></p:cSld></p:sld>`);
  zip.file("ppt/slides/slide2.xml", `<p:sld><p:cSld><p:spTree>
    <p:pic><p:nvPicPr><p:cNvPr id="2" name="Video"/><p:nvPr><a:videoFile r:link="rId9"/></p:nvPr></p:nvPicPr><p:spPr/></p:pic>
    <p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="3" name="Table"/></p:nvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"/></a:graphic></p:graphicFrame>
    <p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="OLE"/></p:nvGraphicFramePr><a:graphic><a:graphicData><p:oleObj/></a:graphicData></a:graphic></p:graphicFrame>
    <p:cxnSp><p:nvCxnSpPr><p:cNvPr id="5" name="Connector"/></p:nvCxnSpPr><p:spPr/></p:cxnSp>
  </p:spTree></p:cSld></p:sld>`);
  return zip.generateAsync({ type: "nodebuffer" });
}

function sha(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
