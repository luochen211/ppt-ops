import crypto from "node:crypto";
import fs from "node:fs/promises";
import JSZip from "jszip";

/**
 * Compare the semantic text present in the actual HTML and PPTX artifacts.
 * This is intentionally not a pixel or layout comparison.
 */
export async function inspectContentConsistency({ htmlFile, pptxFile, buildRevision = null }) {
  const [htmlBytes, pptxBytes] = await Promise.all([fs.readFile(htmlFile), fs.readFile(pptxFile)]);
  const [htmlPages, pptxPages] = await Promise.all([
    extractHtmlPages(htmlBytes.toString("utf8")),
    extractPptxPages(pptxBytes)
  ]);
  const artifactHashes = {
    html: sha256(htmlBytes),
    pptx: sha256(pptxBytes)
  };
  const pageCount = Math.max(htmlPages.length, pptxPages.length);
  const pages = [];
  const findings = [];
  for (let index = 0; index < pageCount; index += 1) {
    const html = htmlPages[index];
    const pptx = pptxPages[index];
    const pageFindings = [];
    if (!html || !pptx) {
      pageFindings.push(finding("page-missing", "blocking", {
        html_page: html?.page ?? null,
        pptx_page: pptx?.page ?? null
      }));
    } else {
      for (const field of ["title", "message", "task", "visual_job"]) {
        const left = html.fields[field] ?? [];
        const right = pptx.fields[field] ?? [];
        // Boundary slides intentionally omit the footer in HTML. Some PPTX
        // producers retain footer text in the source artifact; this is a
        // declared format difference, not a semantic content loss.
        if (html.boundary && ["task", "visual_job"].includes(field) && !left.length && right.length) continue;
        if (normalizeList(left).join("\n") !== normalizeList(right).join("\n")) {
          pageFindings.push(finding("field-mismatch", sensitiveField(field) ? "blocking" : "major", {
            field, html: left, pptx: right, normalized_html: normalizeList(left), normalized_pptx: normalizeList(right)
          }));
        }
      }
      const htmlNumbers = extractSensitiveTokens(html.text);
      const pptxNumbers = extractSensitiveTokens(pptx.text);
      if (JSON.stringify(htmlNumbers) !== JSON.stringify(pptxNumbers)) {
        pageFindings.push(finding("sensitive-token-mismatch", "blocking", {
          html: htmlNumbers, pptx: pptxNumbers
        }));
      }
    }
    pages.push({ page: index + 1, html_page: html?.page ?? null, pptx_page: pptx?.page ?? null, status: pageFindings.length ? "failed" : "passed", findings: pageFindings });
    findings.push(...pageFindings.map(item => ({ ...item, page: index + 1 })));
  }
  const status = findings.some(({ severity }) => severity === "blocking" || severity === "major") ? "failed" : "passed";
  return {
    id: "html-pptx-content-consistency",
    kind: "automated",
    status,
    required: true,
    scope: "semantic-content-only",
    build_revision: buildRevision,
    artifacts: { html_file: htmlFile, pptx_file: pptxFile, ...artifactHashes },
    page_count: { html: htmlPages.length, pptx: pptxPages.length },
    pages,
    findings,
    limitations: [
      "Does not compare pixels, geometry, animation, fonts, or visual hierarchy.",
      "Speaker notes and hidden PowerPoint content are reported as not checked unless a dedicated notes extractor is added.",
      "Charts, tables, citations, and non-text media are not inferred from rendered pixels; unsupported semantic content requires human review."
    ],
    checked_at: new Date().toISOString()
  };
}

async function extractPptxPages(bytes) {
  const archive = await JSZip.loadAsync(bytes);
  const entries = Object.keys(archive.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/slide(\d+)/)[1]) - Number(b.match(/slide(\d+)/)[1]));
  return Promise.all(entries.map(async (entry, index) => {
    const xml = await archive.file(entry).async("string");
    const texts = [...xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map(match => decodeXml(match[1]).trim()).filter(Boolean);
    const meaningful = texts.filter(text => text !== String(index + 1));
    const title = meaningful[0] ?? "";
    const footer = meaningful.slice(-2);
    const body = meaningful.slice(1, Math.max(1, meaningful.length - 2));
    return {
      page: index + 1,
      text: meaningful.join(" "),
      fields: {
        title: title ? [title] : [],
        message: body.length ? body : [],
        subtitle: [],
        body: [],
        task: footer[0] ? [footer[0]] : [],
        visual_job: footer[1] ? [footer[1]] : []
      }
    };
  }));
}

function extractHtmlPages(html) {
  return [...html.matchAll(/<section\b[^>]*class="[^"]*\bslide\b[^"]*"[^>]*data-page="([^"]+)"[^>]*>([\s\S]*?)<\/section>/gi)].map((match, index) => {
    const source = match[2];
    const field = key => [...source.matchAll(new RegExp(`<[^>]*data-reading-key="${key}"[^>]*>([\\s\\S]*?)<\\/[^>]+>`, "gi"))].map(item => decodeHtml(stripTags(item[1]))).filter(Boolean);
    const message = [...field("subtitle"), ...field("message"), ...field("body")];
    const footer = source.match(/<footer\b[^>]*>([\s\S]*?)<\/footer>/i)?.[1] ?? "";
    const footerFields = [...footer.matchAll(/<span\b[^>]*>([\s\S]*?)<\/span>/gi)].map(item => decodeHtml(stripTags(item[1]))).filter(Boolean);
    const fields = {
      title: field("title"), message, subtitle: field("subtitle"), body: field("body"),
      task: footerFields.slice(0, 1), visual_job: footerFields.slice(1, 2)
    };
    const text = decodeHtml(stripTags(source)).replace(/\s+/g, " ").trim();
    return { page: Number(match[1]) || index + 1, boundary: /\bboundary-slide\b/i.test(match[0]), text, fields };
  });
}

function sensitiveField(field) { return ["title", "message", "body"].includes(field); }

function normalizeList(values) { return values.map(value => normalizeText(value)).filter(Boolean); }

function normalizeText(value) {
  return String(value).normalize("NFKC").replace(/[\u00a0\s]+/g, " ").replace(/[“”]/g, '"').replace(/[‘’]/g, "'").trim();
}

function extractSensitiveTokens(text) {
  const normalized = normalizeText(text);
  return [...new Set(normalized.match(/(?:\d+(?:\.\d+)?%?|\d{4}[./年-]\d{1,2}(?:[./月-]\d{1,2})?|[<>≤≥]=?\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:人|页|天|次|元|万|个|小时|分钟|秒|倍|件|项|岁|℃|公里|km|kg|MB|GB))/gi) ?? [])].sort();
}

function finding(rule, severity, evidence) { return { rule, severity, evidence, verification: "automated" }; }

function stripTags(value) { return String(value).replace(/<[^>]+>/g, " "); }

function decodeHtml(value) { return decodeXml(String(value).replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16))).replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&nbsp;/gi, " ")); }

function decodeXml(value) { return String(value).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&"); }

function sha256(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }
