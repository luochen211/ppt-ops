import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import crc32 from "jszip/lib/crc32.js";
import { inflateRawSync } from "node:zlib";
import { resolveProjectPath } from "../core/project.js";

export const CORPORATE_TEMPLATE_PROFILE_VERSION = "1.0";

export const CORPORATE_TEMPLATE_CAPABILITIES = Object.freeze({
  pptx: Object.freeze({ structure: "native_openxml", theme: "structural", layouts: "structural", editable_master: "candidate" }),
  potx: Object.freeze({ structure: "native_openxml", theme: "structural", layouts: "structural", editable_master: "candidate" }),
  html: Object.freeze({ structure: "dom_css_source", theme: "observed", layouts: "observed", editable_master: "none" }),
  pdf: Object.freeze({ structure: "fixed_page", theme: "limited", layouts: "visual_reference_only", editable_master: "none" })
});

const DEFAULT_LIMITS = Object.freeze({
  maxFileBytes: 50 * 1024 * 1024,
  maxEntries: 5000,
  maxExpandedBytes: 200 * 1024 * 1024,
  maxEntryBytes: 25 * 1024 * 1024
});

const TYPES = Object.freeze({
  ".pptx": { format: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation" },
  ".potx": { format: "potx", mime: "application/vnd.openxmlformats-officedocument.presentationml.template" },
  ".html": { format: "html", mime: "text/html" },
  ".htm": { format: "html", mime: "text/html" },
  ".pdf": { format: "pdf", mime: "application/pdf" }
});

export class CorporateTemplateIntake {
  constructor({ projectRoot, limits = {}, clock = () => new Date() }) {
    this.root = path.resolve(projectRoot);
    this.limits = { ...DEFAULT_LIMITS, ...limits };
    this.clock = clock;
  }

  async importFile(inputFile) {
    const input = path.resolve(inputFile);
    const contents = await fs.readFile(input);
    if (contents.byteLength > this.limits.maxFileBytes) {
      throw templateError("CORPORATE_TEMPLATE_TOO_LARGE", `template/reference exceeds ${this.limits.maxFileBytes} bytes`);
    }
    const definition = TYPES[path.extname(input).toLowerCase()];
    if (!definition) {
      throw templateError("UNSUPPORTED_CORPORATE_TEMPLATE_TYPE", "only PPTX, POTX, HTML, and PDF template/reference files are supported");
    }
    verifySignature(contents, definition.format);
    const sha256 = crypto.createHash("sha256").update(contents).digest("hex");
    const directory = path.posix.join(".pptops", "templates", "corporate", definition.format, sha256);
    const inspectionFile = path.posix.join(directory, "inspection.json");
    const originalFile = path.posix.join(directory, `original.${definition.format}`);
    const existing = await readOptionalJson(resolveProjectPath(this.root, inspectionFile));
    if (existing) {
      if (existing.source?.sha256 !== sha256 || existing.source?.file !== originalFile) {
        throw templateError("CORPORATE_TEMPLATE_IMMUTABLE_CONFLICT", "stored inspection does not match the immutable source identity");
      }
      await assertFileMatches(resolveProjectPath(this.root, originalFile), contents);
      return { profile: existing, duplicate: true, inspection_file: inspectionFile };
    }

    const details = definition.format === "html"
      ? inspectHtml(contents)
      : definition.format === "pdf"
        ? inspectPdf(contents)
        : await inspectOpenXml(contents, definition.format, this.limits);
    const profile = {
      schema_version: CORPORATE_TEMPLATE_PROFILE_VERSION,
      kind: "corporate_template_profile_candidate",
      id: `corporate-template-${definition.format}-${sha256.slice(0, 12)}`,
      state: "proposed",
      inspected_at: this.clock().toISOString(),
      source: {
        file: originalFile,
        original_name: path.basename(input),
        bytes: contents.byteLength,
        mime: definition.mime,
        sha256,
        format: definition.format,
        inspector: { name: `corporate-${definition.format}`, version: "1" }
      },
      capabilities: { ...CORPORATE_TEMPLATE_CAPABILITIES[definition.format] },
      observations: details.observations,
      layouts: details.layouts,
      assets: details.assets,
      findings: details.findings,
      limitations: details.limitations
    };
    await writeImmutable(this.root, originalFile, contents);
    await writeImmutable(this.root, inspectionFile, `${JSON.stringify(profile, null, 2)}\n`);
    return { profile, duplicate: false, inspection_file: inspectionFile };
  }

  async readInspection(relativeFile) {
    return JSON.parse(await fs.readFile(resolveProjectPath(this.root, relativeFile), "utf8"));
  }
}

export function detectCorporateTemplateConflicts(profiles) {
  if (!Array.isArray(profiles) || profiles.length < 2) return [];
  const fields = new Map();
  for (const profile of profiles) {
    for (const observation of profile?.observations ?? []) {
      const key = observation.field;
      if (!fields.has(key)) fields.set(key, []);
      fields.get(key).push({ profile_id: profile.id, format: profile.source?.format, value: observation.value, evidence_type: observation.evidence_type });
    }
  }
  return [...fields.entries()].flatMap(([field, values]) => {
    const distinct = new Set(values.map(({ value }) => stableJson(value)));
    return distinct.size > 1 ? [{ field, values, requires_precedence_decision: true }] : [];
  });
}

async function inspectOpenXml(contents, format, limits) {
  let archive;
  // CRC verification expands entries, so load directory metadata only first.
  try { archive = await JSZip.loadAsync(contents, { checkCRC32: false, createFolders: false }); }
  catch { throw templateError("INVALID_CORPORATE_TEMPLATE_ARCHIVE", `invalid ${format.toUpperCase()} archive`); }
  inspectArchiveEntries(Object.values(archive.files), limits);
  const entries = Object.values(archive.files).filter(entry => !entry.dir);
  if (!archive.file("[Content_Types].xml") || !archive.file("ppt/presentation.xml")) {
    throw templateError("CORPORATE_TEMPLATE_MIME_MISMATCH", `archive is not a ${format.toUpperCase()} presentation package`);
  }

  const xmlEntries = readBoundedArchiveEntries(entries, limits);
  const presentation = xmlEntries.get("ppt/presentation.xml");
  const observations = [];
  const size = extractSlideSize(presentation);
  if (size) observations.push(observation("slide_dimensions", size, "structural", ["/ppt/presentation.xml/p:sldSz"]));

  const themeFiles = Object.keys(archive.files).filter((name) => /^ppt\/theme\/theme\d+\.xml$/i.test(name)).sort();
  const themeXml = themeFiles.length ? xmlEntries.get(themeFiles[0]) : "";
  const colors = unique([...themeXml.matchAll(/<a:(?:srgbClr|sysClr)\b[^>]*(?:val|lastClr)="([0-9A-Fa-f]{6})"/g)].map((match) => `#${match[1].toUpperCase()}`));
  const fonts = unique([...themeXml.matchAll(/<a:(?:latin|ea|cs)\b[^>]*typeface="([^"]+)"/g)].map((match) => decodeXml(match[1])).filter(Boolean));
  if (colors.length) observations.push(observation("theme_colors", colors, "structural", [themeFiles[0]]));
  if (fonts.length) observations.push(observation("theme_fonts", fonts, "structural", [themeFiles[0]]));

  const layoutFiles = Object.keys(archive.files).filter((name) => /^ppt\/slideLayouts\/slideLayout\d+\.xml$/i.test(name)).sort(naturalOrder);
  const layouts = [];
  for (const file of layoutFiles) {
    const xml = xmlEntries.get(file);
    layouts.push({
      id: path.basename(file, ".xml").toLowerCase(),
      name: decodeXml(attribute(xml.match(/<p:cSld\b[^>]*>/)?.[0], "name") || attribute(xml.match(/<p:sldLayout\b[^>]*>/)?.[0], "type") || path.basename(file, ".xml")),
      evidence_type: "structural",
      locator: `/${file}`,
      placeholders: extractPlaceholders(xml)
    });
  }
  const masterFiles = Object.keys(archive.files).filter((name) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/i.test(name)).sort(naturalOrder);
  observations.push(observation("master_count", masterFiles.length, "structural", masterFiles.map((file) => `/${file}`)));
  observations.push(observation("layout_count", layouts.length, "structural", layoutFiles.map((file) => `/${file}`)));

  const assets = Object.keys(archive.files).filter((name) => /^ppt\/media\/.+/i.test(name) && !archive.files[name].dir).sort().map((file) => ({ locator: `/${file}`, name: path.posix.basename(file), evidence_type: "structural" }));
  const findings = [];
  const names = Object.keys(archive.files);
  if (names.some((name) => /vbaProject\.bin$/i.test(name))) findings.push(finding("macro_present", "blocked", "The package contains VBA and it will not be executed or preserved as trusted behavior."));
  if (names.some((name) => /^ppt\/embeddings\//i.test(name))) findings.push(finding("embedded_object_present", "blocked", "The package contains embedded/OLE objects."));
  for (const file of names.filter((name) => name.endsWith(".rels"))) {
    const xml = xmlEntries.get(file);
    if (/TargetMode="External"/i.test(xml)) findings.push(finding("external_relationship_present", "warning", `External relationship found in /${file}.`));
  }
  return {
    observations, layouts, assets, findings,
    limitations: ["Import is a proposed profile; masters and layouts are not yet applied to a renderer.", "Package inspection does not prove visual fidelity in Microsoft PowerPoint."]
  };
}

function inspectHtml(contents) {
  const html = contents.toString("utf8");
  if (!/<(?:!doctype\s+html|html|body|section|div)\b/i.test(html)) {
    throw templateError("CORPORATE_TEMPLATE_HTML_INVALID", "HTML template/reference does not contain recognizable document or layout markup");
  }
  const observations = [];
  const title = decodeXml(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "");
  if (title) observations.push(observation("document_title", title, "structural", ["/html/head/title"]));
  const colors = unique([...html.matchAll(/(?:#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\))/gi)].map((match) => match[0].toLowerCase()));
  const fonts = unique([...html.matchAll(/font-family\s*:\s*([^;}]+)/gi)].flatMap((match) => match[1].split(",")).map((value) => value.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean));
  if (colors.length) observations.push(observation("theme_colors", colors, "observed", ["/html/style"]));
  if (fonts.length) observations.push(observation("theme_fonts", fonts, "observed", ["/html/style"]));
  const dimensions = extractHtmlDimensions(html);
  if (dimensions) observations.push(observation("slide_dimensions", dimensions, "inferred", ["/html/style"]));
  const sectionCount = (html.match(/<section\b/gi) ?? []).length;
  observations.push(observation("page_count", sectionCount || 1, "inferred", ["/html/body"]));

  const references = [...html.matchAll(/\b(?:src|href)\s*=\s*(["'])(.*?)\1/gi)].map((match) => match[2]);
  const assets = references.filter((value) => !/^(?:https?:|\/\/|data:|#|mailto:|javascript:)/i.test(value)).map((value) => ({ locator: value, name: path.posix.basename(value.replaceAll("\\", "/")), evidence_type: "structural" }));
  const findings = [];
  if (/<script\b/i.test(html)) findings.push(finding("active_script_present", "blocked", "Scripts are recorded but never executed during inspection."));
  if (/\son[a-z]+\s*=/i.test(html)) findings.push(finding("inline_event_handler_present", "blocked", "Inline event handlers are not executed."));
  if (/<(?:iframe|object|embed)\b/i.test(html)) findings.push(finding("embedded_active_content_present", "blocked", "Embedded active content is not loaded."));
  if (/<meta\b[^>]*http-equiv\s*=\s*["']?refresh/i.test(html)) findings.push(finding("html_refresh_present", "blocked", "HTML refresh navigation is not followed."));
  const cssReferences = [...html.matchAll(/(?:url\(\s*|@import\s+)(["']?)(https?:\/\/|\/\/)([^\s)'";]+)/gi)].map((match) => `${match[2]}${match[3]}`);
  const remote = unique([...references.filter((value) => /^(?:https?:|\/\/)/i.test(value)), ...cssReferences]);
  if (remote.length) findings.push({ ...finding("remote_resource_present", "warning", "Remote resources are not fetched during inspection."), evidence: remote });
  return {
    observations, layouts: [], assets, findings,
    limitations: ["HTML DOM and CSS are not native PowerPoint masters or placeholders.", "No scripts or remote resources were executed or fetched.", "Rendered visual comparison is not part of this first inspection slice."]
  };
}

function inspectPdf(contents) {
  const source = contents.toString("latin1");
  const observations = [];
  const pageCount = (source.match(/\/Type\s*\/Page(?!s)\b/g) ?? []).length;
  if (pageCount < 1) throw templateError("CORPORATE_TEMPLATE_PDF_INVALID", "PDF template/reference does not contain a page object");
  observations.push(observation("page_count", pageCount, "structural", ["/pdf/catalog/pages"]));
  const mediaBoxes = unique([...source.matchAll(/\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/g)].map((match) => ({ x1: Number(match[1]), y1: Number(match[2]), x2: Number(match[3]), y2: Number(match[4]), unit: "pt" })));
  if (mediaBoxes.length) observations.push(observation("page_dimensions", mediaBoxes, "structural", ["/pdf/pages/MediaBox"]));
  const fonts = unique([...source.matchAll(/\/BaseFont\s*\/([^\s/<>{}\[\]()]+)/g)].map((match) => match[1]));
  if (fonts.length) observations.push(observation("font_names", fonts, "structural", ["/pdf/resources/font"]));
  const findings = [];
  if (/\/JavaScript\b|\/JS\b/.test(source)) findings.push(finding("pdf_javascript_present", "blocked", "PDF JavaScript is not executed."));
  if (/\/Launch\b/.test(source)) findings.push(finding("pdf_launch_action_present", "blocked", "PDF launch actions are not executed."));
  if (/\/EmbeddedFile\b/.test(source)) findings.push(finding("pdf_embedded_file_present", "blocked", "Embedded PDF files are not opened."));
  if (/\/URI\b/.test(source)) findings.push(finding("pdf_external_uri_present", "warning", "External PDF links are not opened."));
  return {
    observations, layouts: [], assets: [], findings,
    limitations: ["PDF is fixed-page reference evidence and cannot prove editable placeholders, semantic layout intent, or PowerPoint master identity.", "No rendered visual comparison is performed in this first inspection slice."]
  };
}

function extractSlideSize(xml) {
  const tag = xml.match(/<p:sldSz\b[^>]*>/)?.[0];
  const cx = Number(attribute(tag, "cx")); const cy = Number(attribute(tag, "cy"));
  if (!(cx > 0 && cy > 0)) return undefined;
  return { width: Number((cx / 914400).toFixed(4)), height: Number((cy / 914400).toFixed(4)), unit: "in" };
}

function extractHtmlDimensions(html) {
  const width = html.match(/(?:--slide-width|width)\s*:\s*([\d.]+)px/i)?.[1];
  const height = html.match(/(?:--slide-height|height)\s*:\s*([\d.]+)px/i)?.[1];
  return width && height ? { width: Number(width), height: Number(height), unit: "px" } : undefined;
}

function extractPlaceholders(xml) {
  return [...xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)].flatMap((match, index) => {
    const placeholder = match[0].match(/<p:ph\b[^>]*\/?>(?:<\/p:ph>)?/)?.[0];
    if (!placeholder) return [];
    const offset = match[0].match(/<a:off\b[^>]*>/)?.[0];
    const extent = match[0].match(/<a:ext\b[^>]*>/)?.[0];
    const geometry = offset && extent ? {
      x: Number(attribute(offset, "x")), y: Number(attribute(offset, "y")),
      cx: Number(attribute(extent, "cx")), cy: Number(attribute(extent, "cy")), unit: "emu"
    } : undefined;
    return [{ id: attribute(placeholder, "idx") || `placeholder-${index + 1}`, type: attribute(placeholder, "type") || "body", ...(geometry ? { geometry } : {}) }];
  });
}

function inspectArchiveEntries(entries, limits) {
  if (entries.length > limits.maxEntries) throw templateError("CORPORATE_TEMPLATE_ENTRY_LIMIT", "archive has too many entries");
  let expanded = 0;
  for (const entry of entries) {
    const original = entry.unsafeOriginalName ?? entry.name;
    if (path.posix.isAbsolute(original) || original.split(/[\\/]+/).includes("..")) throw templateError("CORPORATE_TEMPLATE_ZIP_SLIP", `unsafe archive path: ${original}`);
    if (entry.dir) continue;
    const size = entry._data?.uncompressedSize;
    if (!Number.isSafeInteger(size) || size < 0) throw templateError("INVALID_CORPORATE_TEMPLATE_ARCHIVE", "archive entry has invalid size metadata");
    if (size > limits.maxEntryBytes) throw templateError("CORPORATE_TEMPLATE_ENTRY_TOO_LARGE", `archive entry is too large: ${entry.name}`);
    expanded += size;
    if (expanded > limits.maxExpandedBytes) throw templateError("CORPORATE_TEMPLATE_EXPANDED_LIMIT", "archive expands beyond the configured limit");
  }
}

function readBoundedArchiveEntries(entries, limits) {
  const xml = new Map();
  let expanded = 0;
  for (const entry of entries) {
    const data = entry._data;
    const budget = Math.min(limits.maxEntryBytes, limits.maxExpandedBytes - expanded);
    const limitCode = budget < limits.maxEntryBytes ? "CORPORATE_TEMPLATE_EXPANDED_LIMIT" : "CORPORATE_TEMPLATE_ENTRY_TOO_LARGE";
    let bytes;
    try {
      if (data.compression.magic === "\x08\x00") {
        bytes = inflateRawSync(data.compressedContent, { maxOutputLength: Math.max(1, budget) });
      } else if (data.compression.magic === "\x00\x00") {
        bytes = Buffer.from(data.compressedContent);
      } else throw new Error("unsupported compression");
    } catch (error) {
      if (error.code === "ERR_BUFFER_TOO_LARGE") throw templateError(limitCode, `archive entry exceeds the expansion budget: ${entry.name}`);
      throw templateError("INVALID_CORPORATE_TEMPLATE_ARCHIVE", `invalid compressed entry: ${entry.name}`);
    }
    if (bytes.length > budget) throw templateError(limitCode, `archive entry exceeds the expansion budget: ${entry.name}`);
    if (bytes.length !== data.uncompressedSize || (crc32(bytes) >>> 0) !== (data.crc32 >>> 0)) {
      throw templateError("INVALID_CORPORATE_TEMPLATE_ARCHIVE", `archive entry size or CRC mismatch: ${entry.name}`);
    }
    expanded += bytes.length;
    if (/\.(?:xml|rels)$/i.test(entry.name)) xml.set(entry.name, bytes.toString("utf8"));
  }
  return xml;
}

function verifySignature(contents, format) {
  if (format === "html") {
    if (contents.includes(0)) throw templateError("CORPORATE_TEMPLATE_MIME_MISMATCH", "HTML template/reference contains binary data");
    return;
  }
  if (format === "pdf") {
    if (!contents.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw templateError("CORPORATE_TEMPLATE_MIME_MISMATCH", "PDF template/reference has an invalid signature");
    return;
  }
  if (contents[0] !== 0x50 || contents[1] !== 0x4b) throw templateError("CORPORATE_TEMPLATE_MIME_MISMATCH", `${format.toUpperCase()} template/reference is not an Open XML ZIP package`);
}

function observation(field, value, evidenceType, locators) { return { field, value, evidence_type: evidenceType, locators }; }
function finding(code, severity, message) { return { code, severity, message }; }
function attribute(tag, name) { return tag?.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]; }
function decodeXml(value) { return value.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&").replaceAll("&quot;", "\"").replaceAll("&apos;", "'"); }
function naturalOrder(left, right) { return Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]); }
function unique(values) { return [...new Map(values.map((value) => [stableJson(value), value])).values()]; }
function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
async function readOptionalJson(file) {
  try { return JSON.parse(await fs.readFile(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}
async function writeImmutable(root, relativePath, contents) {
  const file = resolveProjectPath(root, relativePath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  try { await fs.writeFile(file, contents, { flag: "wx" }); }
  catch (error) { if (error.code !== "EEXIST") throw error; await assertFileMatches(file, contents); }
}
async function assertFileMatches(file, expected) {
  const actual = await fs.readFile(file);
  const bytes = Buffer.isBuffer(expected) ? expected : Buffer.from(expected);
  if (!actual.equals(bytes)) throw templateError("CORPORATE_TEMPLATE_IMMUTABLE_CONFLICT", `immutable corporate template evidence changed: ${file}`);
}
function templateError(code, message) { return Object.assign(new Error(message), { code }); }
