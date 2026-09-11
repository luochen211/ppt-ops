import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import {
  CORPORATE_TEMPLATE_CAPABILITIES,
  CorporateTemplateIntake,
  detectCorporateTemplateConflicts
} from "../src/templates/corporate-intake.js";

test("PPTX template intake stores immutable evidence and extracts native structure", async (t) => {
  const fixture = await setup(t);
  const file = path.join(fixture.root, "brand-template.pptx");
  const bytes = await presentationPackage();
  await fs.writeFile(file, bytes);

  const first = await fixture.intake.importFile(file);
  assert.equal(first.duplicate, false);
  assert.equal(first.profile.state, "proposed");
  assert.equal(first.profile.source.format, "pptx");
  assert.equal(first.profile.source.file.includes("\\"), false);
  assert.deepEqual(first.profile.capabilities, CORPORATE_TEMPLATE_CAPABILITIES.pptx);
  assert.deepEqual(value(first.profile, "slide_dimensions"), { width: 13.3333, height: 7.5, unit: "in" });
  assert.deepEqual(value(first.profile, "theme_colors"), ["#112233", "#4472C4"]);
  assert.deepEqual(value(first.profile, "theme_fonts"), ["Aptos Display", "Aptos"]);
  assert.equal(value(first.profile, "master_count"), 1);
  assert.equal(first.profile.layouts[0].name, "Title and Content");
  assert.deepEqual(first.profile.layouts[0].placeholders[0], {
    id: "1", type: "title", geometry: { x: 100, y: 200, cx: 300, cy: 400, unit: "emu" }
  });
  assert.deepEqual(first.profile.assets, [{ locator: "/ppt/media/logo.png", name: "logo.png", evidence_type: "structural" }]);
  assert.ok(first.profile.findings.some(({ code }) => code === "external_relationship_present"));

  const original = await fs.readFile(path.join(fixture.root, first.profile.source.file));
  assert.deepEqual(original, bytes);
  const second = await fixture.intake.importFile(file);
  assert.equal(second.duplicate, true);
  assert.deepEqual(second.profile, first.profile);

  await fs.writeFile(path.join(fixture.root, first.profile.source.file), "tampered");
  await assert.rejects(fixture.intake.importFile(file), (error) => error.code === "CORPORATE_TEMPLATE_IMMUTABLE_CONFLICT");
});

test("POTX uses the template media type and the same guarded Open XML inspector", async (t) => {
  const fixture = await setup(t);
  const file = path.join(fixture.root, "brand-template.potx");
  await fs.writeFile(file, await presentationPackage({ macro: true, embedding: true }));
  const result = await fixture.intake.importFile(file);
  assert.equal(result.profile.source.format, "potx");
  assert.equal(result.profile.source.mime, "application/vnd.openxmlformats-officedocument.presentationml.template");
  assert.ok(result.profile.findings.some(({ code, severity }) => code === "macro_present" && severity === "blocked"));
  assert.ok(result.profile.findings.some(({ code }) => code === "embedded_object_present"));
});

test("HTML inspection is static, records local assets, and blocks active content", async (t) => {
  const fixture = await setup(t);
  const file = path.join(fixture.root, "brand.html");
  const html = `<!doctype html><html><head><title>Brand Deck</title><style>
    :root { --slide-width: 1600px; --slide-height: 900px; --brand: #0057ff; }
    body { font-family: "Inter", Arial; color: rgb(17, 17, 17); }
  </style><script>globalThis.templateExecuted = true</script></head>
  <body onload="run()"><section><img src="assets/logo.svg"><a href="https://example.com/font.woff">remote</a></section><section></section></body></html>`;
  await fs.writeFile(file, html);
  const result = await fixture.intake.importFile(file);
  assert.equal(result.profile.source.format, "html");
  assert.equal(result.profile.capabilities.editable_master, "none");
  assert.equal(value(result.profile, "document_title"), "Brand Deck");
  assert.deepEqual(value(result.profile, "slide_dimensions"), { width: 1600, height: 900, unit: "px" });
  assert.equal(value(result.profile, "page_count"), 2);
  assert.deepEqual(result.profile.assets, [{ locator: "assets/logo.svg", name: "logo.svg", evidence_type: "structural" }]);
  for (const code of ["active_script_present", "inline_event_handler_present", "remote_resource_present"]) {
    assert.ok(result.profile.findings.some((finding) => finding.code === code));
  }
  assert.equal(globalThis.templateExecuted, undefined);
  assert.equal(await fs.readFile(path.join(fixture.root, result.profile.source.file), "utf8"), html);
});

test("PDF inspection reports fixed-page evidence without claiming editability", async (t) => {
  const fixture = await setup(t);
  const file = path.join(fixture.root, "brand.pdf");
  const pdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >> endobj
3 0 obj << /Type /Page /MediaBox [0 0 960 540] /Resources << /Font << /F1 << /BaseFont /BrandSans >> >> >> >> endobj
4 0 obj << /Type /Page /MediaBox [0 0 960 540] /AA << /O << /S /JavaScript /JS (alert) >> >> /URI (https://example.com) >> endobj
%%EOF`;
  await fs.writeFile(file, pdf, "latin1");
  const result = await fixture.intake.importFile(file);
  assert.equal(result.profile.source.format, "pdf");
  assert.equal(result.profile.capabilities.layouts, "visual_reference_only");
  assert.equal(value(result.profile, "page_count"), 2);
  assert.deepEqual(value(result.profile, "page_dimensions"), [{ x1: 0, y1: 0, x2: 960, y2: 540, unit: "pt" }]);
  assert.deepEqual(value(result.profile, "font_names"), ["BrandSans"]);
  assert.ok(result.profile.findings.some(({ code }) => code === "pdf_javascript_present"));
  assert.ok(result.profile.limitations.some((item) => item.includes("cannot prove editable placeholders")));
});

test("profile comparison makes cross-format conflicts explicit", () => {
  const profiles = [
    profile("powerpoint", "pptx", [observation("slide_dimensions", { width: 13.333, height: 7.5 }, "structural")]),
    profile("web", "html", [observation("slide_dimensions", { width: 1600, height: 900 }, "inferred")]),
    profile("pdf", "pdf", [observation("page_count", 12, "structural")])
  ];
  const conflicts = detectCorporateTemplateConflicts(profiles);
  assert.deepEqual(conflicts.map(({ field }) => field), ["slide_dimensions"]);
  assert.equal(conflicts[0].requires_precedence_decision, true);
  assert.deepEqual(conflicts[0].values.map(({ profile_id, evidence_type }) => ({ profile_id, evidence_type })), [
    { profile_id: "powerpoint", evidence_type: "structural" }, { profile_id: "web", evidence_type: "inferred" }
  ]);
});

test("unsupported types, signature mismatches, and configured size limits fail closed", async (t) => {
  const fixture = await setup(t, { maxFileBytes: 16 });
  const unsupported = path.join(fixture.root, "brand.svg");
  await fs.writeFile(unsupported, "<svg/>");
  await assert.rejects(fixture.intake.importFile(unsupported), (error) => error.code === "UNSUPPORTED_CORPORATE_TEMPLATE_TYPE");
  const fakePdf = path.join(fixture.root, "fake.pdf");
  await fs.writeFile(fakePdf, "not pdf");
  await assert.rejects(fixture.intake.importFile(fakePdf), (error) => error.code === "CORPORATE_TEMPLATE_MIME_MISMATCH");
  const emptyPdf = path.join(fixture.root, "empty.pdf");
  await fs.writeFile(emptyPdf, "%PDF-1.4\n%%EOF");
  await assert.rejects(fixture.intake.importFile(emptyPdf), (error) => error.code === "CORPORATE_TEMPLATE_PDF_INVALID");
  const fakeHtml = path.join(fixture.root, "fake.html");
  await fs.writeFile(fakeHtml, "plain text");
  await assert.rejects(fixture.intake.importFile(fakeHtml), (error) => error.code === "CORPORATE_TEMPLATE_HTML_INVALID");
  const largeHtml = path.join(fixture.root, "large.html");
  await fs.writeFile(largeHtml, "<html>too large</html>");
  await assert.rejects(fixture.intake.importFile(largeHtml), (error) => error.code === "CORPORATE_TEMPLATE_TOO_LARGE");
});

async function setup(t, limits = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-corporate-template-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return {
    root,
    intake: new CorporateTemplateIntake({ projectRoot: root, limits, clock: () => new Date("2026-09-10T12:00:00.000Z") })
  };
}

async function presentationPackage({ macro = false, embedding = false } = {}) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("ppt/presentation.xml", '<p:presentation xmlns:p="p"><p:sldSz cx="12191969" cy="6858000"/></p:presentation>');
  zip.file("ppt/theme/theme1.xml", '<a:theme xmlns:a="a"><a:clrScheme><a:dk1><a:srgbClr val="112233"/></a:dk1><a:accent1><a:srgbClr val="4472C4"/></a:accent1></a:clrScheme><a:fontScheme><a:majorFont><a:latin typeface="Aptos Display"/></a:majorFont><a:minorFont><a:latin typeface="Aptos"/></a:minorFont></a:fontScheme></a:theme>');
  zip.file("ppt/slideMasters/slideMaster1.xml", '<p:sldMaster xmlns:p="p"/>');
  zip.file("ppt/slideLayouts/slideLayout1.xml", '<p:sldLayout xmlns:p="p" xmlns:a="a" type="obj"><p:cSld name="Title and Content"><p:spTree><p:sp><p:nvSpPr><p:nvPr><p:ph type="title" idx="1"/></p:nvPr></p:nvSpPr><p:spPr><a:xfrm><a:off x="100" y="200"/><a:ext cx="300" cy="400"/></a:xfrm></p:spPr></p:sp></p:spTree></p:cSld></p:sldLayout>');
  zip.file("ppt/media/logo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  zip.file("ppt/_rels/presentation.xml.rels", '<Relationships><Relationship Target="https://example.com" TargetMode="External"/></Relationships>');
  if (macro) zip.file("ppt/vbaProject.bin", Buffer.from([1]));
  if (embedding) zip.file("ppt/embeddings/object1.bin", Buffer.from([2]));
  return zip.generateAsync({ type: "nodebuffer" });
}

function value(profileValue, field) { return profileValue.observations.find((item) => item.field === field)?.value; }
function observation(field, valueValue, evidenceType) { return { field, value: valueValue, evidence_type: evidenceType, locators: [`/${field}`] }; }
function profile(id, format, observations) { return { id, source: { format }, observations }; }
