import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { ProjectFileStore } from "../infrastructure/file-store.js";
import { resolveProjectPath } from "../core/project.js";
import { findBrowser, printHtmlPdf } from "../qa/html.js";
import { renderPresentation } from "../qa/index.js";

export async function pdfCapability(build, reviews, root) {
  const review = [...reviews].reverse().find(item => item.build_id === build.id && item.state === "accepted");
  if (!review) return undefined;
  const browser = await findBrowser();
  const native = !browser || !build.targets.includes("html") ? await nativeConverterAvailable() : false;
  const format = browser && build.targets.includes("html") ? "html" : native && build.targets.includes("pptx") ? "pptx" : undefined;
  if (!format) return undefined;
  const file = `.pptops/builds/${build.id}/${format}/slides.${format}`;
  let sha256;
  try { sha256 = await hashFile(resolveProjectPath(root, file)); }
  catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
  // A review must bind the exact rendered source, not merely name its Build.
  if (review.artifact_hashes?.[file] !== sha256) return undefined;
  return { format, file, sha256, review_id: review.id, exporter: format === "html" ? "chromium-print" : "native-presentation-pdf" };
}

export async function exportPresentationPdf(projectRoot, selection, options = {}) {
  const source = selection.pdf_source;
  if (!source || !["html", "pptx"].includes(source.format) || !source.review_id) throw failure("PDF_SOURCE_REQUIRED", "PDF requires an eligible reviewed source");
  const input = resolveProjectPath(projectRoot, source.file);
  if (await hashFile(input) !== source.sha256) throw failure("PDF_SOURCE_CHANGED", "reviewed source changed after format selection");
  const store = new ProjectFileStore(projectRoot);
  const prefix = `.pptops/delivery-selections/${selection.id}`;
  const manifestFile = resolveProjectPath(projectRoot, `${prefix}/pdf-manifest.json`);
  try {
    const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
    if (manifest.selection_id !== selection.id || manifest.source.sha256 !== source.sha256 || await hashFile(resolveProjectPath(projectRoot, manifest.output.file)) !== manifest.output.sha256) throw failure("PDF_ARTIFACT_CHANGED", "previous PDF derivative was changed");
    return { name: "slides.pdf", path: resolveProjectPath(projectRoot, manifest.output.file) };
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  let bytes;
  try {
    if (source.format === "html") bytes = await (options.printPdf ?? printHtmlPdf)({ htmlFile: input, presentation: true });
    else {
      const rendering = await (options.renderPresentation ?? renderPresentation)({ pptxFile: input, evidenceDir: resolveProjectPath(projectRoot, `${prefix}/render-evidence`) });
      if (rendering.status !== "rendered" || !rendering.pdf_file) throw failure("EXPORTER_UNAVAILABLE", rendering.reason ?? "native PDF exporter is unavailable");
      bytes = await fs.readFile(rendering.pdf_file);
    }
    if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw failure("EXPORT_FAILED", "PDF exporter returned invalid data");
  } catch (error) {
    await store.writeImmutable(`${prefix}/failure-${crypto.randomUUID()}.json`, JSON.stringify({ selection_id: selection.id, format: "pdf", code: error.code ?? "EXPORT_FAILED", message: error.message, created_at: new Date().toISOString() }));
    throw failure("EXPORTER_UNAVAILABLE", `PDF export failed; choose another format or retry: ${error.message}`);
  }
  const output = await store.writeImmutable(`${prefix}/slides.pdf`, bytes);
  await store.writeImmutable(`${prefix}/pdf-manifest.json`, JSON.stringify({ kind: "pdf_derivation", selection_id: selection.id, source_revision: selection.source_revision, source, output }, null, 2));
  return { name: "slides.pdf", path: resolveProjectPath(projectRoot, output.file) };
}

async function nativeConverterAvailable() {
  const candidates = process.platform === "darwin" ? ["/Applications/Microsoft PowerPoint.app", "/Applications/LibreOffice.app/Contents/MacOS/soffice"] : [];
  for (const file of candidates) { try { await fs.access(file); return true; } catch {} }
  return false;
}
export async function hashFile(file) { return crypto.createHash("sha256").update(await fs.readFile(file)).digest("hex"); }
function failure(code, message) { return Object.assign(new Error(message), { code }); }
