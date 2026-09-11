import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { ProjectFileStore } from "../infrastructure/file-store.js";
import { resolveProjectPath } from "../core/project.js";
import { printHtmlPdf } from "../qa/html.js";

export function outlineSource(project) {
  const outline = project.contracts.outline;
  const ids = new Set(outline.sections.flatMap(section => section.page_ids));
  const snapshot = { title: project.project.title, outline, pages: project.contracts.pages.filter(page => ids.has(page.id)).map(({ id, task, three_second_message, screen_text, source_refs }) => ({ id, task, three_second_message, screen_text, source_refs })) };
  return { source_id: outline.id, source_revision: digest(snapshot), snapshot };
}

export async function approveOutline(project, { sourceRevision, actor, rawFeedback }) {
  requireUser(actor);
  if (typeof rawFeedback !== "string" || !rawFeedback.trim()) throw failure("OUTLINE_FEEDBACK_REQUIRED", "explicit outline acceptance is required");
  const source = outlineSource(project);
  if (sourceRevision !== source.source_revision) throw failure("OUTLINE_REVISION_MISMATCH", "outline changed before acceptance");
  const id = `outline-approval-${crypto.randomUUID()}`;
  const approval = { kind: "outline_approval", id, ...source, actor, decision: "accepted", raw_feedback: rawFeedback, decided_at: new Date().toISOString() };
  await new ProjectFileStore(project.root).writeManifest("outline-approval", id, approval);
  return approval;
}

export async function requireOutlineApproval(project, id, sourceRevision) {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id ?? "")) throw failure("OUTLINE_NOT_ACCEPTED", "choose an explicit accepted outline approval");
  let approval;
  try { approval = JSON.parse(await fs.readFile(resolveProjectPath(project.root, `.pptops/outline-approvals/${id}/manifest.json`), "utf8")); }
  catch { throw failure("OUTLINE_NOT_ACCEPTED", "outline approval is missing or invalid"); }
  requireUser(approval.actor);
  const current = outlineSource(project);
  if (approval.id !== id || approval.kind !== "outline_approval" || approval.decision !== "accepted" || !approval.raw_feedback?.trim() || !Number.isFinite(Date.parse(approval.decided_at))) throw failure("OUTLINE_NOT_ACCEPTED", "outline approval is incomplete");
  if (approval.source_id !== current.source_id || approval.source_revision !== current.source_revision || sourceRevision !== current.source_revision || digest(approval.snapshot) !== current.source_revision) throw failure("OUTLINE_REVISION_MISMATCH", "export must use the exact accepted outline revision");
  return approval;
}

export async function exportOutline(project, selection, approval, options = {}) {
  const store = new ProjectFileStore(project.root);
  const prefix = `.pptops/delivery-selections/${selection.id}`;
  const blocks = outlineBlocks(approval.snapshot);
  const outputs = [];
  const add = async (format, bytes) => {
    const name = `outline.${format === "markdown" ? "md" : format}`;
    const artifact = await store.writeImmutable(`${prefix}/${name}`, bytes);
    outputs.push({ format, name, path: resolveProjectPath(project.root, artifact.file), ...artifact });
  };
  for (const format of selection.formats) {
    if (format === "markdown") await add(format, blocks.map(({ level, text }) => `${level ? "#".repeat(level) : "-"} ${text}\n`).join("\n"));
    else if (format === "docx") await add(format, await outlineDocx(blocks));
    else if (format === "pdf") {
      const html = outlineHtml(blocks);
      const source = await store.writeImmutable(`${prefix}/source/outline.html`, html);
      const pdf = await (options.printPdf ?? printHtmlPdf)({ htmlFile: resolveProjectPath(project.root, source.file), browserPath: options.browserPath });
      if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw failure("EXPORT_FAILED", "PDF exporter returned an invalid document");
      await add(format, pdf);
      await store.writeImmutable(`${prefix}/pdf-source.json`, JSON.stringify({ kind: "pdf_derivation", approval_id: approval.id, source_revision: approval.source_revision, source, exporter: "chromium-print", accepted_source: "outline" }, null, 2));
    }
  }
  await store.writeImmutable(`${prefix}/export-manifest.json`, JSON.stringify({ selection_id: selection.id, source_revision: selection.source_revision, approval_id: approval.id, outputs }, null, 2));
  return outputs;
}

function outlineBlocks(snapshot) {
  const pages = new Map(snapshot.pages.map(page => [page.id, page]));
  return [{ level: 1, text: snapshot.title }, ...snapshot.outline.sections.flatMap(section => [{ level: 2, text: section.title }, ...section.page_ids.map(id => {
    const page = pages.get(id);
    if (!page) throw failure("OUTLINE_PAGE_MISSING", `outline references missing page: ${id}`);
    return { level: 0, text: `${page.screen_text?.title ?? page.three_second_message} — ${page.task}` };
  })])];
}

async function outlineDocx(blocks) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
  zip.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file("word/_rels/document.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file("word/styles.xml", '<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei"/><w:sz w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style></w:styles>');
  const paragraphs = blocks.map(({ level, text }) => `<w:p><w:pPr>${level ? `<w:pStyle w:val="Heading${level}"/>` : ""}<w:spacing w:after="160"/></w:pPr><w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`).join("");
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function outlineHtml(blocks) {
  return `<!doctype html><meta charset="utf-8"><style>@page{size:A4;margin:20mm}body{font:12pt/1.6 Arial,'Microsoft YaHei',sans-serif;color:#222}h1{font-size:24pt}h2{font-size:17pt;break-after:avoid}p{margin:0 0 10pt}</style>${blocks.map(({ level, text }) => `<${level ? `h${level}` : "p"}>${escapeXml(text)}</${level ? `h${level}` : "p"}>`).join("")}`;
}
export function requireUser(actor) { if (typeof actor !== "string" || !/^user(?::\S+)?$/.test(actor)) throw failure("DELIVERY_USER_REQUIRED", "a user decision is required"); }
function escapeXml(value) { return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[char]); }
export function digest(value) { return crypto.createHash("sha256").update(stableJson(value)).digest("hex"); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function failure(code, message) { return Object.assign(new Error(message), { code }); }
