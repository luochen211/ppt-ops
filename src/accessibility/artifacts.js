import crypto from "node:crypto";
import fs from "node:fs/promises";
import { readBoundedPresentationXml } from "../templates/corporate-intake.js";
import { auditAccessibility, contrastRatio } from "./index.js";
import { withHtmlPage } from "../qa/html.js";
import { resolveProjectPath } from "../core/project.js";
import { normalizeSnapshot } from "../core/snapshot.js";

/** Reads immutable artifacts without changing project files or database state. */
export async function auditAccessibilityArtifacts(project, options = {}) {
  const base = auditAccessibility(project, options);
  if (base.status === "not_requested") return base;
  const findings = [...base.findings], artifacts = [];
  for (const [format, file] of [["html", options.htmlFile], ["pptx", options.pptxFile]]) {
    if (!file) continue;
    const bytes = await fs.readFile(file);
    const identity = { format, sha256: hash(bytes), bytes: bytes.length };
    try {
      const observed = format === "html" ? await inspectHtml(file, Boolean(options.trustedGeneratedArtifact)) : await inspectPptx(bytes);
      artifacts.push({ ...identity, status: "inspected", ...observed });
      for (const control of observed.controls ?? []) {
        if (!control.name?.trim()) findings.push(finding(format, null, "control-name", "blocking", "An interactive control has no accessible name.", control));
        if (!control.keyboard_focusable) findings.push(finding(format, null, "keyboard-control", "major", "A presentation control is not reachable by keyboard.", control));
      }
      for (const sample of observed.focus_contrast ?? []) {
        const ratio = contrastRatio(sample.foreground, sample.background);
        if (parseFloat(sample.width) <= 0) findings.push(finding(format, null, "visible-focus", "major", "A keyboard control has no visible focus outline.", sample));
        if (ratio === null || ratio < 3) findings.push(finding(format, null, "focus-contrast", "major", "Verify the focus indicator against its adjacent background.", { ...sample, ratio }, ratio === null ? "human_required" : "automated"));
      }
      if (observed.reduced_motion === false) findings.push(finding(format, null, "reduced-motion", "major", "Slide transitions remain active under reduced-motion preference.", {}));
      if (observed.pages.length !== project.pages.length) findings.push(finding(format, null, "page-count", "blocking", "Artifact pages do not match the audited PageSpecs.", { expected: project.pages.length, actual: observed.pages.length }));
      if (observed.language !== base.declared_profile.document_language) findings.push(finding(format, null, "document-language", "major", "The artifact document language differs from the declared language.", { actual: observed.language, expected: base.declared_profile.document_language }));
      for (const page of project.pages) {
        const actual = observed.pages.find(item => item.page === page.page);
        if (!actual) continue;
        const expectedLanguage = page.accessibility?.language ?? base.declared_profile.document_language;
        if (actual.languages.some(language => language !== expectedLanguage) || !actual.languages.length) findings.push(finding(format, page, "page-language", "major", "Rendered language metadata does not match this page.", { expected: expectedLanguage, actual: actual.languages }));
        const expectedOrder = page.accessibility?.reading_order ?? [];
        const relevant = actual.reading_order.filter(key => expectedOrder.includes(key));
        if (expectedOrder.length && JSON.stringify(relevant) !== JSON.stringify(expectedOrder)) findings.push(finding(format, page, "reading-order", "major", "The rendered reading order differs from the authored semantic order.", { expected: expectedOrder, actual: actual.reading_order }));
        for (const media of actual.media ?? []) {
          if (!media.caption_tracks) findings.push(finding(format, page, "media-captions", "blocking", "Rendered media has no caption track.", { id: media.id }));
          if (!media.transcript) findings.push(finding(format, page, "media-transcript", "major", "Rendered media needs an accessible transcript.", { id: media.id }));
        }
        if (actual.shrinking) findings.push(finding(format, page, "automatic-shrinking", "blocking", "The artifact enables automatic text shrinking.", {}));
        for (const asset of actual.images) {
          const id = String(asset.id ?? "unmapped-image").replace(/^Asset /, "");
          const slot = page.asset_slots?.find(slot => slot.asset_id === id), declared = project.assets.find(asset => asset.id === id);
          const decorative = slot?.decorative ?? declared?.decorative ?? asset.decorative;
          if (decorative && format === "pptx") findings.push(finding(format, page, "decorative-metadata", "major", "PowerPoint decorative metadata is unsupported; confirm the object is skipped by assistive technology.", { id }, "human_required"));
          else if (!decorative && !asset.alt?.trim()) findings.push(finding(format, page, "image-description", "blocking", "A rendered image lacks alternative text.", { id }));
        }
        for (const sample of actual.contrast ?? []) {
          if (sample.uncertain) { findings.push(finding(format, page, "contrast-human-review", "major", "An image, gradient or transparent region needs visual contrast review.", sample, "human_required")); continue; }
          const ratio = contrastRatio(sample.foreground, sample.background);
          if (ratio === null) findings.push(finding(format, page, "contrast-human-review", "major", "The rendered color pair needs manual resolution.", sample, "human_required"));
          else if (ratio < sample.minimum) findings.push(finding(format, page, "rendered-contrast", "major", `Rendered contrast is ${ratio.toFixed(2)}:1.`, { ...sample, ratio }));
        }
        if (format === "pptx" && (page.accessibility?.tables?.length || page.accessibility?.charts?.length || page.accessibility?.links?.length)) findings.push(finding(format, page, "semantic-alternatives", "major", "Check that declared chart/table/link alternatives exist in the editable PowerPoint objects; this renderer cannot claim full semantic equivalence.", {}, "human_required"));
      }
    } catch (error) {
      artifacts.push({ ...identity, status: "degraded", reason: error.message });
      findings.push(finding(format, null, "inspection-unavailable", "major", `Artifact inspection is unavailable: ${error.message}`, {}, "human_required"));
    }
  }
  return { ...base, status: findings.some(item => item.severity === "blocking") ? "failed" : findings.length ? "needs_review" : "passed", finding_count: findings.length, findings, artifacts,
    evidence: base.evidence.map(item => item.kind === "automated" ? { ...item, status: findings.some(finding => finding.severity === "blocking") ? "failed" : "completed", finding_count: findings.length } : item) };
}

export async function auditStoredBuild(project, buildId) {
  if (!/^build-\d+$/.test(buildId)) throw new Error("invalid Build ID");
  const read = async relative => JSON.parse(await fs.readFile(resolveProjectPath(project.root, relative), "utf8"));
  const build = await read(`.pptops/builds/${buildId}/manifest.json`);
  if (build.id !== buildId || build.state !== "succeeded" || !/^version-\d+$/.test(build.version_id)) throw new Error("audit requires a succeeded immutable Build");
  const snapshot = await read(`.pptops/versions/${build.version_id}/snapshot.json`);
  const version = await read(`.pptops/versions/${build.version_id}/manifest.json`);
  if (hash(stableJson(snapshot)) !== version.snapshot_hash || version.state !== "frozen") throw new Error("frozen snapshot does not match its recorded revision");
  const frozen = normalizeSnapshot(project.root, snapshot);
  const file = format => build.targets.includes(format) ? resolveProjectPath(project.root, `.pptops/builds/${buildId}/${format}/slides.${format}`) : undefined;
  return auditAccessibilityArtifacts(frozen, { buildRevision: buildId, htmlFile: file("html"), pptxFile: file("pptx"), trustedGeneratedArtifact: true });
}

async function inspectHtml(file, trustedGeneratedArtifact) {
  return withHtmlPage({ htmlFile: file, isolatedDocument: !trustedGeneratedArtifact }, async client => {
    await client.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    const { result, exceptionDetails } = await client.send("Runtime.evaluate", { expression: `(() => {
      const priorFocus = document.activeElement;
      const focus = [...document.querySelectorAll('button')].map(button => { button.focus(); const style = getComputedStyle(button), parent = getComputedStyle(button.closest('nav') || button.parentElement); return { foreground: style.outlineColor, background: parent.backgroundColor, width: style.outlineWidth }; });
      priorFocus?.focus();
      return { reduced_motion: [...document.querySelectorAll('.slide')].every(slide => getComputedStyle(slide).transitionDuration.split(',').every(value => parseFloat(value) === 0)), focus_contrast: focus, language: document.documentElement.lang, direction: document.documentElement.dir, pages: [...document.querySelectorAll('section[data-page]')].map(section => ({
        page: Number(section.dataset.page), languages: [section.lang || document.documentElement.lang],
        reading_order: [...section.querySelectorAll('[data-reading-key]')].filter(node => node.dataset.readingKey !== 'assets' || [...node.querySelectorAll('img,video,a')].some(element => !element.closest('figure[aria-hidden="true"]'))).map(node => node.dataset.readingKey),
        images: [...section.querySelectorAll('img')].map((image, index) => ({ id: image.dataset.assetId || image.id || 'image-' + (index + 1), alt: image.getAttribute('alt'), decorative: image.closest('[aria-hidden="true"]') !== section && Boolean(image.closest('figure[aria-hidden="true"]')) })),
        media: [...section.querySelectorAll('video,audio')].map(media => ({ id: media.dataset.assetId, caption_tracks: media.querySelectorAll('track[kind="captions"],track[kind="subtitles"]').length, transcript: Boolean(section.querySelector('[data-transcript-for="'+media.dataset.assetId+'"]')) })),
        contrast: [...section.querySelectorAll('h1,p,li,th,td,.slide-footer,.slide-number')].filter(node => node.textContent.trim()).map(node => {
          const style = getComputedStyle(node); let ancestor = node, background, uncertain = false;
          while (ancestor && !background) { const parentStyle = getComputedStyle(ancestor); if (parentStyle.backgroundImage !== 'none' || (ancestor !== section && Number(parentStyle.opacity) < 1)) uncertain = true; if (!['rgba(0, 0, 0, 0)','transparent'].includes(parentStyle.backgroundColor)) background = parentStyle.backgroundColor; ancestor = ancestor.parentElement; }
          return { foreground: style.color, background: background || 'rgb(255, 255, 255)', minimum: parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.67 && parseFloat(style.fontWeight) >= 700) ? 3 : 4.5, uncertain };
        })
      })), controls: [...document.querySelectorAll('button')].map(button => ({ name: button.getAttribute('aria-label') || button.textContent, keyboard_focusable: button.tabIndex >= 0 && button.getBoundingClientRect().width > 0 })) };
    })()`, returnByValue: true });
    if (exceptionDetails) throw new Error("HTML semantic inspection failed");
    return result.value;
  });
}

async function inspectPptx(bytes) {
  const xmlEntries = await readBoundedPresentationXml(bytes);
  const core = xmlEntries.get("docProps/core.xml") ?? "";
  const entries = [...xmlEntries.keys()].filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name)).sort((a, b) => Number(a.match(/slide(\d+)/)[1]) - Number(b.match(/slide(\d+)/)[1]));
  const pages = [];
  for (const [index, file] of entries.entries()) {
    const xml = xmlEntries.get(file);
    const objects = [...xml.matchAll(/<p:(sp|pic)\b[\s\S]*?<\/p:\1>/g)].map(match => { const name = attr(match[0], "name"); return { name, type: match[1], alt: attr(match[0], "descr"), has_text: /<a:t>/.test(match[0]) }; });
    const order = objects.map(object => object.type === "pic" ? "assets" : / title$/.test(object.name) ? "title" : /body|Body/.test(object.name) ? "body" : /message/i.test(object.name) ? "message" : /^Diagram /.test(object.name) && object.has_text ? "diagram" : undefined).filter(Boolean);
    pages.push({ page: index + 1, languages: [...new Set([...xml.matchAll(/\blang="([^"]+)"/g)].map(match => decode(match[1])))], reading_order: order.filter((key, i) => i === 0 || key !== order[i - 1]), images: objects.filter(object => object.type === "pic").map(object => ({ id: object.name, alt: object.alt, decorative: false })), objects, shrinking: /<a:normAutofit\b/.test(xml) });
  }
  return { language: decode(core.match(/<dc:language>([^<]*)<\/dc:language>/)?.[1] ?? ""), pages, independent_reading_order: "unsupported", decorative_metadata: "unsupported" };
}
const decode = value => String(value).replaceAll("&quot;", '"').replaceAll("&apos;", "'").replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&");
const attr = (xml, name) => decode(xml.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? "");
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function finding(format, page, rule, severity, message, evidence, verification = "automated") { return { id: `${format}-${rule}-${page?.id ?? "document"}`, rule: `${format}-${rule}`, severity, target: page ? { kind: "page", id: page.id, page: page.page } : { kind: "format", id: format }, message, evidence, verification, remediation: { kind: "candidate_required", automatically_applied: false } }; }
