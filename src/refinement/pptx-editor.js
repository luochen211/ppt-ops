import crypto from "node:crypto";
import fs from "node:fs/promises";
import JSZip from "jszip";
import { inspectRefinementPptx, stableHash } from "./pptx-inspection.js";

export async function applyRefinementPptx(sourceFile, source, inspection, scope, changes) {
  const current = await inspectRefinementPptx(sourceFile, source);
  if (stableHash(current) !== stableHash(inspection)) throw coded("REFINEMENT_INSPECTION_CHANGED", "current PPTX inspection differs from the approved inspection");
  if (scope.source.id !== source.id || scope.source.sha256 !== source.sha256) throw coded("REFINEMENT_SCOPE_SOURCE_MISMATCH", "Scope does not belong to the selected PPTX source");
  if (!Array.isArray(changes) || changes.length === 0) throw coded("REFINEMENT_CHANGES_REQUIRED", "at least one object change is required");
  const requested = new Map(changes.map((change) => [`${change.slide}:${change.object_id}`, change]));
  if (requested.size !== changes.length) throw coded("REFINEMENT_CHANGE_DUPLICATE", "each scoped object may appear only once");
  const bytes = await fs.readFile(sourceFile), archive = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const operations = [];
  for (const target of scope.targets) {
    const key = `${target.slide}:${target.object_id}`, change = requested.get(key);
    if (!change) continue;
    const slide = current.slides.find((item) => item.slide === target.slide);
    const object = slide?.objects.find((item) => item.id === target.object_id);
    if (!object || object.fingerprint !== target.object_fingerprint) throw coded("REFINEMENT_OBJECT_CHANGED", `object fingerprint changed: ${target.object_id}`);
    const values = change.properties;
    if (!values || typeof values !== "object" || Array.isArray(values)) throw coded("REFINEMENT_CHANGE_INVALID", `properties are required for ${target.object_id}`);
    const keys = Object.keys(values);
    const forbidden = keys.filter((property) => !target.properties.includes(property));
    if (forbidden.length) throw coded("REFINEMENT_PROPERTY_FORBIDDEN", `properties outside Scope: ${forbidden.join(", ")}`);
    let xml = await archive.file(slide.part).async("string");
    const result = editObject(xml, object.native_id, object.type, values);
    archive.file(slide.part, result.xml);
    operations.push({ slide: target.slide, object_id: target.object_id, object_type: object.type, before_fingerprint: object.fingerprint, properties: result.applied });
    requested.delete(key);
  }
  if (requested.size) throw coded("REFINEMENT_TARGET_INVALID", `changes reference objects outside Scope: ${[...requested.keys()].join(", ")}`);
  const output = await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  return { bytes: output, evidence: { contract_version: "1.0", kind: "pptx_refinement_candidate", source: scope.source, scope_id: scope.id, source_sha256: sha(bytes), candidate_sha256: sha(output), operations, content_editing: false, original_preserved: true } };
}

function editObject(xml, nativeId, type, values) {
  const tag = type === "picture" ? "p:pic" : "p:sp";
  const blocks = [...xml.matchAll(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, "g"))];
  const match = blocks.find(({ 0: block }) => new RegExp(`<p:cNvPr\\b[^>]*\\bid="${escape(nativeId)}"`).test(block));
  if (!match) throw coded("REFINEMENT_OBJECT_MISSING", `native object is missing: ${nativeId}`);
  let block = match[0]; const applied = [];
  for (const [property, value] of Object.entries(values)) {
    if (property === "position") block = replacePair(block, "a:off", "x", "y", value, property);
    else if (property === "size") block = replacePair(block, "a:ext", "cx", "cy", { cx: value.width, cy: value.height }, property);
    else if (property === "font_size") block = replaceRunAttribute(block, "sz", Math.round(number(value, property) * 100));
    else if (property === "font_weight") block = replaceRunAttribute(block, "b", value === "bold" || value === true ? "1" : "0");
    else if (property === "font_family") block = upsertRunChild(block, "a:latin", ` typeface="${xmlEscape(text(value, property))}"`);
    else if (property === "line_spacing") block = upsertParagraphSpacing(block, Math.round(number(value, property) * 1000));
    else if (property === "fill_color") block = upsertColor(block, "a:solidFill", color(value, property));
    else if (property === "line_color") block = upsertLineColor(block, color(value, property));
    else if (property === "text_color") block = upsertRunChild(block, "a:solidFill", `><a:srgbClr val="${color(value, property)}"/></a:solidFill`, true);
    else if (property === "crop") block = upsertCrop(block, value);
    else throw coded("REFINEMENT_PROPERTY_UNSUPPORTED", `editor does not support property: ${property}`);
    applied.push(property);
  }
  return { xml: `${xml.slice(0, match.index)}${block}${xml.slice(match.index + match[0].length)}`, applied: applied.sort() };
}

function replacePair(block, tag, first, second, value, property) {
  const a = Math.round(number(value?.[first], property)), b = Math.round(number(value?.[second], property));
  const pattern = new RegExp(`<${tag}\\b[^>]*\\b${first}="-?\\d+"[^>]*\\b${second}="-?\\d+"[^>]*/>`);
  if (!pattern.test(block)) throw coded("REFINEMENT_GEOMETRY_MISSING", `${property} requires existing OOXML geometry`);
  return block.replace(pattern, `<${tag} ${first}="${a}" ${second}="${b}"/>`);
}
function replaceRunAttribute(block, name, value) {
  return mapRuns(block, (run) => /<a:rPr\b/.test(run) ? run.replace(/<a:rPr\b([^>]*)>/, (_all, attrs) => `<a:rPr${setAttribute(attrs, name, value)}>`)
    : run.replace(/<a:r>/, `<a:r><a:rPr ${name}="${value}"/>`));
}
function upsertRunChild(block, tag, attributes, whole = false) {
  const child = whole ? `<${tag}${attributes}` : `<${tag}${attributes}/>`;
  const pattern = new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>|<${tag}\\b[^>]*/>`);
  return mapRuns(block, (run) => {
    if (pattern.test(run)) return run.replace(pattern, child);
    if (/<a:rPr\b[^>]*>/.test(run)) return run.replace(/<a:rPr\b([^>]*)>/, `<a:rPr$1>${child}`);
    return run.replace(/<a:r>/, `<a:r><a:rPr>${child}</a:rPr>`);
  });
}
function mapRuns(block, transform) { return block.replace(/<a:r>[\s\S]*?<\/a:r>/g, transform); }
function upsertParagraphSpacing(block, value) { const spacing = `<a:lnSpc><a:spcPct val="${value}"/></a:lnSpc>`; return /<a:pPr\b[^>]*>/.test(block) ? block.replace(/<a:pPr\b([^>]*)>/, `<a:pPr$1>${spacing}`) : block.replace(/<a:p>/, `<a:p><a:pPr>${spacing}</a:pPr>`); }
function upsertColor(block, tag, value) { const fill = `<${tag}><a:srgbClr val="${value}"/></${tag}>`; return new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`).test(block) ? block.replace(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`), fill) : block.replace(/<p:spPr\b([^>]*)>/, `<p:spPr$1>${fill}`); }
function upsertLineColor(block, value) { const line = `<a:ln><a:solidFill><a:srgbClr val="${value}"/></a:solidFill></a:ln>`; return /<a:ln\b[\s\S]*?<\/a:ln>/.test(block) ? block.replace(/<a:ln\b[\s\S]*?<\/a:ln>/, line) : block.replace(/<p:spPr\b([^>]*)>/, `<p:spPr$1>${line}`); }
function upsertCrop(block, value) { const attrs = ["left", "top", "right", "bottom"].map((key) => `${key[0]}="${Math.round(number(value?.[key] ?? 0, "crop") * 100000)}"`).join(" "); const crop = `<a:srcRect ${attrs}/>`; return /<a:srcRect\b[^>]*\/>/.test(block) ? block.replace(/<a:srcRect\b[^>]*\/>/, crop) : block.replace(/<p:blipFill\b([^>]*)>/, `<p:blipFill$1>${crop}`); }
function setAttribute(attrs, name, value) { const pattern = new RegExp(`\\s${name}="[^"]*"`); return pattern.test(attrs) ? attrs.replace(pattern, ` ${name}="${value}"`) : `${attrs} ${name}="${value}"`; }
function number(value, property) { if (!Number.isFinite(Number(value)) || Number(value) < 0) throw coded("REFINEMENT_VALUE_INVALID", `${property} requires a non-negative number`); return Number(value); }
function text(value, property) { if (typeof value !== "string" || !value.trim()) throw coded("REFINEMENT_VALUE_INVALID", `${property} requires text`); return value.trim(); }
function color(value, property) { const normalized = String(value).replace(/^#/, "").toUpperCase(); if (!/^[A-F0-9]{6}$/.test(normalized)) throw coded("REFINEMENT_VALUE_INVALID", `${property} requires a six-digit RGB color`); return normalized; }
function sha(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function escape(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function xmlEscape(value) { return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"); }
function coded(code, message) { return Object.assign(new Error(message), { code }); }
