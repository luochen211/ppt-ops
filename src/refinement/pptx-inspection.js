import crypto from "node:crypto";
import fs from "node:fs/promises";
import JSZip from "jszip";

const SUPPORTED_PROPERTIES = Object.freeze({
  text_box: ["position", "size", "font_family", "font_size", "font_weight", "line_spacing", "fill_color", "line_color", "text_color"],
  basic_shape: ["position", "size", "fill_color", "line_color"],
  picture: ["position", "size", "crop"]
});

export async function inspectRefinementPptx(file, source) {
  const bytes = await fs.readFile(file);
  const actualSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  if (source.sha256 !== actualSha256) throw coded("REFINEMENT_SOURCE_CHANGED", "stored PPTX bytes no longer match the registered source hash");
  let archive;
  try { archive = await JSZip.loadAsync(bytes, { checkCRC32: true, createFolders: false }); }
  catch { throw coded("REFINEMENT_PPTX_INVALID", "visual refinement requires a valid PPTX archive"); }
  if (!archive.file("ppt/presentation.xml")) throw coded("REFINEMENT_PPTX_INVALID", "visual refinement requires a PPTX presentation package");
  const slideFiles = Object.keys(archive.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort(naturalOrder);
  if (slideFiles.length === 0) throw coded("REFINEMENT_PPTX_EMPTY", "PPTX contains no inspectable slides");
  const slides = [], findings = [];
  for (const [index, slideFile] of slideFiles.entries()) {
    const xml = await archive.file(slideFile).async("string");
    const objects = inspectSlideObjects(xml, index + 1);
    const unsupported = detectUnsupported(xml, index + 1, objects);
    findings.push(...unsupported);
    slides.push({ slide: index + 1, part: slideFile, objects, unsupported });
  }
  const counts = slides.flatMap((slide) => slide.objects).reduce((result, object) => {
    result[object.type] = (result[object.type] ?? 0) + 1;
    return result;
  }, {});
  return {
    contract_version: "1.0", kind: "pptx_refinement_inspection",
    source: { id: source.id, sha256: source.sha256, original_name: source.original_name, bytes: source.bytes },
    slide_count: slides.length, object_counts: counts, slides, findings,
    capabilities: { supported_properties: SUPPORTED_PROPERTIES, content_editing: false, slide_reordering: false, whole_slide_replacement: false, real_powerpoint_acceptance: "pending" }
  };
}

export function createRefinementScope(inspection, { targets, actor }) {
  if (!Array.isArray(targets) || targets.length === 0) throw coded("REFINEMENT_TARGETS_REQUIRED", "at least one slide/object target is required");
  if (typeof actor !== "string" || !actor.trim()) throw coded("REFINEMENT_ACTOR_REQUIRED", "an explicit actor is required");
  const seen = new Set();
  const normalized = targets.map((target, index) => {
    if (!Number.isInteger(target?.slide) || target.slide < 1) throw coded("REFINEMENT_TARGET_INVALID", `targets[${index}].slide must be a positive integer`);
    const slide = inspection.slides.find((item) => item.slide === target.slide);
    if (!slide) throw coded("REFINEMENT_TARGET_INVALID", `unknown slide: ${target.slide}`);
    if (typeof target.object_id !== "string" || !target.object_id) throw coded("REFINEMENT_TARGET_INVALID", `targets[${index}].object_id is required`);
    const object = slide.objects.find((item) => item.id === target.object_id);
    if (!object) throw coded("REFINEMENT_TARGET_INVALID", `unknown object on slide ${target.slide}: ${target.object_id}`);
    if (!SUPPORTED_PROPERTIES[object.type]) throw coded("REFINEMENT_OBJECT_UNSUPPORTED", `object ${target.object_id} on slide ${target.slide} is not safely editable`);
    if (!Array.isArray(target.properties) || target.properties.length === 0) throw coded("REFINEMENT_PROPERTIES_REQUIRED", `target ${target.object_id} requires visual properties`);
    const properties = [...new Set(target.properties.map(String))].sort();
    const forbidden = properties.filter((property) => !SUPPORTED_PROPERTIES[object.type].includes(property));
    if (forbidden.length) throw coded("REFINEMENT_PROPERTY_FORBIDDEN", `unsupported properties for ${object.type}: ${forbidden.join(", ")}`);
    const key = `${target.slide}:${target.object_id}`;
    if (seen.has(key)) throw coded("REFINEMENT_TARGET_DUPLICATE", `duplicate target: ${key}`);
    seen.add(key);
    return { slide: target.slide, object_id: target.object_id, object_type: object.type, properties, objective: String(target.objective ?? "").trim() };
  });
  return {
    contract_version: "1.0", kind: "pptx_refinement_scope", source: inspection.source, actor: actor.trim(), targets: normalized,
    preservation: { text: true, facts: true, numbers: true, slide_order: true, untargeted_slides: true, untargeted_properties: true },
    prohibited_operations: ["content_rewrite", "slide_reorder", "whole_slide_replacement", "unsupported_object_edit"],
    acceptance: { automated_scope_check: "pending", before_after_preview: "pending", real_powerpoint: "pending", user_decision: "pending" }
  };
}

export function stableHash(value) { return crypto.createHash("sha256").update(stableJson(value)).digest("hex"); }

function inspectSlideObjects(xml, slide) {
  return [
    ...elementBlocks(xml, "p:sp").map((block) => objectFromBlock(block, slide, "shape")),
    ...elementBlocks(xml, "p:pic").map((block) => objectFromBlock(block, slide, "picture")),
    ...elementBlocks(xml, "p:graphicFrame").map((block) => objectFromBlock(block, slide, "graphic_frame"))
  ].sort((left, right) => Number(left.native_id) - Number(right.native_id) || left.id.localeCompare(right.id));
}

function objectFromBlock(xml, slide, baseType) {
  const tag = /<p:cNvPr\b([^>]*)\/?\s*>/.exec(xml)?.[1] ?? "";
  const nativeId = /\bid="([^"]+)"/.exec(tag)?.[1] ?? "unknown";
  const name = /\bname="([^"]*)"/.exec(tag)?.[1] ?? "";
  const hasText = /<a:t(?:\s[^>]*)?>/.test(xml);
  const type = baseType === "shape" ? (hasText ? "text_box" : "basic_shape") : baseType === "picture" ? "picture" : detectGraphicType(xml);
  const offset = /<a:off\b[^>]*\bx="(-?\d+)"[^>]*\by="(-?\d+)"/.exec(xml);
  const extent = /<a:ext\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/.exec(xml);
  const text = [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((match) => decodeXml(match[1])).join("");
  const fingerprint = stableHash({ slide, native_id: nativeId, type, name, text, offset: offset?.slice(1), extent: extent?.slice(1) }).slice(0, 16);
  return {
    id: `slide-${String(slide).padStart(3, "0")}-object-${nativeId}-${fingerprint}`, native_id: nativeId, name, type,
    editable_properties: SUPPORTED_PROPERTIES[type] ?? [],
    ...(offset && extent ? { bounds_emu: { x: Number(offset[1]), y: Number(offset[2]), width: Number(extent[1]), height: Number(extent[2]) } } : {}),
    text_sha256: text ? crypto.createHash("sha256").update(text).digest("hex") : null
  };
}

function detectGraphicType(xml) { if (/drawingml\/2006\/chart/.test(xml)) return "chart"; if (/drawingml\/2006\/diagram/.test(xml)) return "smartart"; return "graphic_frame"; }
function detectUnsupported(xml, slide, objects) {
  const rules = [[/<p:timing\b/, "animation_or_timing"], [/<p:oleObj\b/, "ole_object"], [/<p:video\b|<a:videoFile\b|<p14:media\b/, "media"], [/drawingml\/2006\/diagram/, "smartart"], [/drawingml\/2006\/chart/, "chart_editing_pending"]];
  return rules.filter(([pattern]) => pattern.test(xml)).flatMap(([, feature]) => {
    const objectType = feature === "smartart" ? "smartart" : feature === "chart_editing_pending" ? "chart" : feature === "ole_object" || feature === "media" ? "graphic_frame" : undefined;
    const matches = objectType ? objects.filter((object) => object.type === objectType) : [];
    return matches.length
      ? matches.map((object) => ({ slide, object_id: object.id, feature, severity: "blocking_for_edit", action: "preserve_and_report" }))
      : [{ slide, feature, severity: "blocking_for_edit", action: "preserve_and_report" }];
  });
}
function elementBlocks(xml, tag) { return [...xml.matchAll(new RegExp(`<${tag.replace(":", "\\:")}\\b[\\s\\S]*?<\\/${tag.replace(":", "\\:")}>`, "g"))].map((match) => match[0]); }
function naturalOrder(left, right) { return Number(left.match(/slide(\d+)/)?.[1]) - Number(right.match(/slide(\d+)/)?.[1]); }
function decodeXml(value) { return value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&").replaceAll("&quot;", "\"").replaceAll("&apos;", "'"); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function coded(code, message) { return Object.assign(new Error(message), { code }); }
