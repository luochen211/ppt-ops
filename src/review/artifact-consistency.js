import crypto from "node:crypto";
import fs from "node:fs/promises";
import JSZip from "jszip";

// This checks text emitted by the current two renderers, not visual equivalence.
export async function inspectArtifactConsistency({ htmlFile, pptxFile, versionId, buildId }) {
  const [htmlBytes, pptxBytes] = await Promise.all([fs.readFile(htmlFile), fs.readFile(pptxFile)]);
  const evidence = {
    version_id: versionId ?? null,
    build_id: buildId ?? null,
    artifacts: {
      html: { file: htmlFile, sha256: digest(htmlBytes) },
      pptx: { file: pptxFile, sha256: digest(pptxBytes) }
    },
    checked: ["page count and order", "visible slide titles", "visible body text or message"],
    not_checked: ["HTML-only three-second message when a page has body text", "diagrams, charts and tables", "citations", "asset identity", "speaker notes and hidden content", "browser appearance", "PowerPoint appearance and editability"],
    differences: []
  };
  try {
    const html = extractHtml(htmlBytes.toString("utf8"));
    const pptx = await extractPptx(pptxBytes);
    evidence.page_counts = { html: html.length, pptx: pptx.length };
    for (let index = 0; index < Math.max(html.length, pptx.length); index++) {
      const left = html[index];
      const right = pptx[index];
      if (!left || !right) {
        evidence.differences.push({ type: "page_missing", position: index + 1, html: left ?? null, pptx: right ?? null });
        continue;
      }
      if (left.page_id !== null && right.page_id !== null && left.page_id !== right.page_id) {
        evidence.differences.push({ type: "page_reordered", position: index + 1, html_page_id: left.page_id, pptx_page_id: right.page_id });
      }
      for (const field of ["title", "body"]) {
        if (normalize(left[field]) === normalize(right[field])) continue;
        evidence.differences.push({ type: classify(left[field], right[field]), position: index + 1, page_id: left.page_id,
          field, html: left[field], pptx: right[field], html_location: `section[data-page="${left.page_id}"]`, pptx_location: `ppt/slides/slide${index + 1}.xml` });
      }
    }
    return { status: evidence.differences.length ? "failed" : "passed", evidence };
  } catch (error) {
    return { status: "failed", evidence: { ...evidence, extraction_error: error.message, differences: [{ type: "unreadable_artifact" }] } };
  }
}

function extractHtml(html) {
  const sections = [...html.matchAll(/<section\b([^>]*)class="([^"]*\bslide\b[^"]*)"([^>]*)>([\s\S]*?)<\/section>/g)];
  if (!sections.length) throw new Error("HTML contains no extractable slide sections");
  return sections.map((match) => {
    const attrs = `${match[1]} ${match[3]}`;
    const content = match[4];
    const pageId = attrs.match(/\bdata-page="([^"]+)"/)?.[1] ?? null;
    const title = text(content.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? "");
    const bodyItems = [...(content.match(/<ul\b[^>]*class="body-copy"[^>]*>([\s\S]*?)<\/ul>/)?.[1] ?? "").matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((item) => text(item[1]));
    const subtitle = text(content.match(/<p\b[^>]*class="subtitle"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "");
    const message = text(content.match(/<p\b[^>]*class="message"[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "");
    return { page_id: pageId, title, body: bodyItems.length ? bodyItems.join("\n") : subtitle || message };
  });
}

async function extractPptx(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const entries = Object.keys(zip.files).filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)/)[1]) - Number(b.match(/slide(\d+)/)[1]));
  if (!entries.length) throw new Error("PPTX contains no extractable slide XML");
  return Promise.all(entries.map(async (entry) => {
    const xml = await zip.file(entry).async("string");
    const shapes = [...xml.matchAll(/<p:sp>([\s\S]*?)<\/p:sp>/g)].map((match) => {
      const shape = match[1];
      const name = decode(shape.match(/<p:cNvPr\b[^>]*\bname="([^"]*)"/)?.[1] ?? "");
      return { name, text: [...shape.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map((part) => decode(part[1])).join("") };
    });
    const title = shapes.find((shape) => /(?:^Slide .+ title$|^Boundary slide .+ title$)/.test(shape.name));
    if (!title) throw new Error(`${entry} has no extractable title`);
    const body = shapes.filter((shape) => /^(?:Body text \d+|Message text)$/.test(shape.name)).map((shape) => shape.text).join("\n");
    const pageId = title.name.match(/^(?:Slide|Boundary slide) (\S+)/)?.[1] ?? null;
    return { page_id: pageId, title: title.text, body };
  }));
}

function text(value) { return decode(value.replace(/<[^>]+>/g, "")).trim(); }
function decode(value) { return value.replace(/&(?:amp|lt|gt|quot|apos|#39|#x([0-9a-f]+)|#(\d+));/gi, (entity, hex, decimal) => {
  if (hex || decimal) return String.fromCodePoint(parseInt(hex ?? decimal, hex ? 16 : 10));
  return { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&#39;": "'" }[entity] ?? entity;
}); }
function normalize(value) { return value.normalize("NFKC").replace(/\s+/g, " ").trim(); }
function classify(left, right) {
  const significant = /\d|%|％|元|美元|年|月|日|天|小时|分钟|不|无|未|非|not\b|no\b/i;
  return significant.test(left) || significant.test(right) ? "critical_content_mismatch" : "content_replaced";
}
function digest(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
