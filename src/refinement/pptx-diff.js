import crypto from "node:crypto";
import fs from "node:fs/promises";
import JSZip from "jszip";
import { inspectRefinementPptx } from "./pptx-inspection.js";

export async function reviewRefinementCandidate(sourceFile, candidateFile, source, scope, evidence) {
  const sourceBytes = await fs.readFile(sourceFile), candidateBytes = await fs.readFile(candidateFile);
  if (sha(sourceBytes) !== evidence.source_sha256 || sha(candidateBytes) !== evidence.candidate_sha256) throw coded("REFINEMENT_CANDIDATE_CHANGED", "Candidate or Source bytes differ from recorded evidence");
  const before = await inspectRefinementPptx(sourceFile, source);
  const candidateSource = { ...source, sha256: evidence.candidate_sha256, bytes: candidateBytes.length };
  const after = await inspectRefinementPptx(candidateFile, candidateSource);
  if (before.slide_count !== after.slide_count || before.slides.map((slide) => slide.part).join("|") !== after.slides.map((slide) => slide.part).join("|")) throw coded("REFINEMENT_SLIDE_ORDER_CHANGED", "Candidate changed slide count or order");
  const sourceZip = await JSZip.loadAsync(sourceBytes), candidateZip = await JSZip.loadAsync(candidateBytes);
  const targets = new Map(scope.targets.map((target) => [`${target.slide}:${target.object_id}`, target]));
  const changedParts = [], objectDiffs = [];
  for (const name of Object.keys(sourceZip.files).filter((item) => !sourceZip.files[item].dir).sort()) {
    const right = candidateZip.file(name);
    if (!right) throw coded("REFINEMENT_PART_REMOVED", `Candidate removed package part: ${name}`);
    const [leftBytes, rightBytes] = await Promise.all([sourceZip.file(name).async("nodebuffer"), right.async("nodebuffer")]);
    if (sha(leftBytes) === sha(rightBytes)) continue;
    changedParts.push(name);
    const slide = before.slides.find((item) => item.part === name);
    if (!slide) throw coded("REFINEMENT_PART_FORBIDDEN", `Candidate changed out-of-scope package part: ${name}`);
    const [leftXml, rightXml] = [leftBytes.toString("utf8"), rightBytes.toString("utf8")];
    let normalizedLeft = leftXml, normalizedRight = rightXml;
    for (const target of scope.targets.filter((item) => item.slide === slide.slide)) {
      const object = slide.objects.find((item) => item.id === target.object_id);
      const leftBlock = objectBlock(leftXml, object), rightBlock = objectBlock(rightXml, object);
      const leftNormalized = normalizeAllowed(leftBlock, target.properties), rightNormalized = normalizeAllowed(rightBlock, target.properties);
      if (leftNormalized !== rightNormalized) throw coded("REFINEMENT_SCOPE_DIFF_FAILED", `Candidate changed data outside allowed properties: ${target.object_id}`);
      normalizedLeft = normalizedLeft.replace(leftBlock, leftNormalized);
      normalizedRight = normalizedRight.replace(rightBlock, rightNormalized);
      objectDiffs.push({ slide: target.slide, object_id: target.object_id, properties: target.properties, before_bounds_emu: object.bounds_emu ?? null, after_bounds_emu: after.slides.find((item) => item.slide === target.slide)?.objects.find((item) => item.id === target.object_id)?.bounds_emu ?? null });
    }
    if (normalizedLeft !== normalizedRight) throw coded("REFINEMENT_UNTARGETED_CHANGE", `Candidate changed an untargeted object on slide ${slide.slide}`);
  }
  const extraParts = Object.keys(candidateZip.files).filter((name) => !sourceZip.files[name] && !candidateZip.files[name].dir);
  if (extraParts.length) throw coded("REFINEMENT_PART_ADDED", `Candidate added package parts: ${extraParts.join(", ")}`);
  for (const slide of before.slides) for (const object of slide.objects) {
    const current = after.slides.find((item) => item.slide === slide.slide)?.objects.find((item) => item.id === object.id);
    if (!current || current.text_sha256 !== object.text_sha256) throw coded("REFINEMENT_CONTENT_CHANGED", `Candidate changed text or removed object: ${object.id}`);
    if (!targets.has(`${slide.slide}:${object.id}`) && current.fingerprint !== object.fingerprint) throw coded("REFINEMENT_UNTARGETED_CHANGE", `Candidate changed untargeted object: ${object.id}`);
  }
  const report = { contract_version: "1.0", kind: "pptx_refinement_scoped_diff", source_sha256: evidence.source_sha256, candidate_sha256: evidence.candidate_sha256, scope_id: scope.id, passed: true, changed_parts: changedParts, objects: objectDiffs, preservation: { text: true, slide_order: true, untargeted_objects: true, package_parts: true } };
  return { report, preview: previewHtml(report) };
}

function objectBlock(xml, object) {
  const tag = object.type === "picture" ? "p:pic" : "p:sp", blocks = [...xml.matchAll(new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, "g"))];
  const found = blocks.find((match) => new RegExp(`<p:cNvPr\\b[^>]*\\bid="${escape(object.native_id)}"`).test(match[0]));
  if (!found) throw coded("REFINEMENT_OBJECT_MISSING", `Candidate is missing scoped object: ${object.id}`);
  return found[0];
}
function normalizeAllowed(block, properties) {
  let value = block;
  for (const property of properties) {
    if (property === "position") value = value.replace(/<a:off\b[^>]*\/>/, "<a:off scoped=\"position\"/>");
    else if (property === "size") value = value.replace(/<a:ext\b[^>]*\/>/, "<a:ext scoped=\"size\"/>");
    else if (property === "font_size") value = value.replace(/(<a:rPr\b[^>]*?)\ssz="[^"]*"/g, "$1");
    else if (property === "font_weight") value = value.replace(/(<a:rPr\b[^>]*?)\sb="[^"]*"/g, "$1");
    else if (property === "font_family") value = value.replace(/<a:latin\b[^>]*\/>/g, "");
    else if (property === "line_spacing") value = value.replace(/<a:lnSpc\b[\s\S]*?<\/a:lnSpc>/g, "");
    else if (property === "fill_color") value = replaceNthFill(value, "fill_color", 0);
    else if (property === "line_color") value = value.replace(/<a:ln\b([^>]*)>([\s\S]*?)<\/a:ln>/g, (_all, attrs, inner) => `<a:ln${attrs}>${stripFill(inner)}</a:ln>`);
    else if (property === "text_color") value = value.replace(/<a:rPr\b([^>]*)>([\s\S]*?)<\/a:rPr>/g, (_all, attrs, inner) => `<a:rPr${attrs}>${stripFill(inner)}</a:rPr>`);
    else if (property === "crop") value = value.replace(/<a:srcRect\b[^>]*\/>/, "");
  }
  value = value.replace(/<a:(rPr|pPr|ln)\b([^>]*?)\/>/g, (_all, tag, attrs) => `<a:${tag}${attrs}></a:${tag}>`);
  value = value.replace(/<a:(rPr|pPr|ln)\s*><\/a:\1>/g, "");
  return value.replace(/<p:spPr\b([^>]*)><\/p:spPr>/g, "<p:spPr$1/>");
}
function stripFill(value) { return value.replace(/<a:(solidFill|gradFill|blipFill|pattFill)\b[^>]*>[\s\S]*?<\/a:\1>|<a:(?:noFill|grpFill|solidFill)\b[^>]*\/>/g, ""); }
function replaceNthFill(value) {
  return value.replace(/<p:spPr\b([^>]*)>([\s\S]*?)<\/p:spPr>/, (_all, attrs, inner) => {
    const lines = [];
    const masked = inner.replace(/<a:ln\b[^>]*\/>|<a:ln\b[^>]*>[\s\S]*?<\/a:ln>/g, (line) => { lines.push(line); return `__PPTOPS_LINE_${lines.length - 1}__`; });
    return `<p:spPr${attrs}>${stripFill(masked).replace(/__PPTOPS_LINE_(\d+)__/g, (_match, index) => lines[Number(index)])}</p:spPr>`;
  });
}
function previewHtml(report) { const rows = report.objects.map((item) => `<tr><td>${item.slide}</td><td>${html(item.object_id)}</td><td>${html(item.properties.join(", "))}</td><td><code>${html(JSON.stringify(item.before_bounds_emu))}</code></td><td><code>${html(JSON.stringify(item.after_bounds_emu))}</code></td></tr>`).join(""); return `<!doctype html><html><head><meta charset="utf-8"><title>Refinement before/after</title><style>body{font:14px system-ui;margin:32px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:8px;text-align:left}code{font-size:12px}</style></head><body><h1>Scoped refinement preview</h1><p>Candidate ${html(report.candidate_sha256.slice(0, 12))} passed the automated scope check.</p><table><thead><tr><th>Slide</th><th>Object</th><th>Authorized properties</th><th>Before bounds</th><th>After bounds</th></tr></thead><tbody>${rows}</tbody></table></body></html>`; }
function sha(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function escape(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function html(value) { return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;"); }
function coded(code, message) { return Object.assign(new Error(message), { code }); }
