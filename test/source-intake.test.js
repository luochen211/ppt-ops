import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { InfrastructureStore } from "../src/infrastructure/store.js";
import { extractMarkdown, SourceIntake } from "../src/sources/intake.js";

test("Markdown intake preserves heading and line locators and deduplicates by hash", async (t) => {
  const fixture = await setup(t);
  const sourceFile = path.join(fixture.root, "notes.md");
  await fs.writeFile(sourceFile, "# Opening\nOne fact.\n\n## Evidence\nSecond fact.\n");
  const first = await fixture.intake.importFile(sourceFile);
  assert.equal(first.duplicate, false);
  assert.deepEqual(first.extracted.segments.map(({ locator, heading }) => ({ locator, heading })), [
    { locator: "line:1-3", heading: "Opening" }, { locator: "line:4-6", heading: "Evidence" }
  ]);
  const second = await fixture.intake.importFile(sourceFile);
  assert.equal(second.duplicate, true);
  assert.equal(second.source.id, first.source.id);
  assert.equal(fixture.store.listEntities("demo", "source").length, 1);

  const original = await fs.readFile(path.join(fixture.root, first.source.file), "utf8");
  const corrected = await fixture.intake.correctExtraction(first.source.id, [{ locator: "line:1-2", heading: "Opening", text: "Corrected fact." }]);
  assert.equal(corrected.source.correction_revision, 1);
  assert.equal((await fixture.intake.readExtraction(corrected.source)).text, "Corrected fact.");
  assert.equal(await fs.readFile(path.join(fixture.root, first.source.file), "utf8"), original);
});

test("DOCX intake extracts ordered paragraph references", async (t) => {
  const fixture = await setup(t);
  const file = path.join(fixture.root, "brief.docx");
  await fs.writeFile(file, await docxBuffer(["First paragraph", "Second & final"]));
  const result = await fixture.intake.importFile(file);
  assert.equal(result.source.mime, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.deepEqual(result.extracted.segments, [
    { locator: "/document/paragraph/1", text: "First paragraph" },
    { locator: "/document/paragraph/2", text: "Second & final" }
  ]);
});

test("PPTX intake extracts slide and text-run references in numeric order", async (t) => {
  const fixture = await setup(t);
  const file = path.join(fixture.root, "source.pptx");
  await fs.writeFile(file, await pptxBuffer([["Slide one", "Detail"], ["Slide two"]]));
  const result = await fixture.intake.importFile(file);
  assert.deepEqual(result.extracted.segments.map(({ locator, text }) => ({ locator, text })), [
    { locator: "/slides/1/text/1", text: "Slide one" },
    { locator: "/slides/1/text/2", text: "Detail" },
    { locator: "/slides/2/text/1", text: "Slide two" }
  ]);
});

test("intake rejects forged types, unsafe archive paths, and configured expansion limits", async (t) => {
  const fixture = await setup(t);
  const forged = path.join(fixture.root, "forged.docx");
  await fs.writeFile(forged, "not a zip");
  await assert.rejects(fixture.intake.importFile(forged), (error) => error.code === "MIME_MISMATCH");

  const malicious = new JSZip();
  malicious.file("[Content_Types].xml", "<Types/>"); malicious.file("word/document.xml", "<w:document/>"); malicious.file("../escape.txt", "escape");
  const maliciousFile = path.join(fixture.root, "malicious.docx");
  await fs.writeFile(maliciousFile, await malicious.generateAsync({ type: "nodebuffer" }));
  await assert.rejects(fixture.intake.importFile(maliciousFile), (error) => error.code === "ZIP_SLIP");

  const limited = new SourceIntake({ projectRoot: fixture.root, store: fixture.store, projectId: "demo", limits: { maxExpandedBytes: 20, maxEntryBytes: 20 } });
  const large = path.join(fixture.root, "large.docx");
  await fs.writeFile(large, await docxBuffer(["A".repeat(100)]));
  await assert.rejects(limited.importFile(large), (error) => ["ARCHIVE_ENTRY_TOO_LARGE", "ARCHIVE_EXPANDED_LIMIT"].includes(error.code));
});

test("Markdown parser normalizes CRLF without losing source line references", () => {
  assert.deepEqual(extractMarkdown("# A\r\nText\r\n").segments, [{ locator: "line:1-3", heading: "A", text: "# A\nText" }]);
});

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-intake-"));
  const store = new InfrastructureStore(path.join(root, "state.sqlite"));
  store.registerProject({ id: "demo", root, title: "Demo" });
  const fixture = { root, store, intake: new SourceIntake({ projectRoot: root, store, projectId: "demo" }) };
  t.after(async () => { store.close(); await fs.rm(root, { recursive: true, force: true }); });
  return fixture;
}

async function docxBuffer(paragraphs) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>");
  zip.file("word/document.xml", `<w:document><w:body>${paragraphs.map((text) => `<w:p><w:r><w:t>${escapeXml(text)}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer" });
}
async function pptxBuffer(slides) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", "<Types/>"); zip.file("ppt/presentation.xml", "<p:presentation/>");
  slides.forEach((texts, index) => zip.file(`ppt/slides/slide${index + 1}.xml`, `<p:sld>${texts.map((text) => `<a:t>${escapeXml(text)}</a:t>`).join("")}</p:sld>`));
  return zip.generateAsync({ type: "nodebuffer" });
}
function escapeXml(text) { return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
