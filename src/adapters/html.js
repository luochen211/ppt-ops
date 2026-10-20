import { assertAccessibleTextCapacity } from "../accessibility/index.js";
import { applyAccessibilityHtml } from "../accessibility/html.js";
import { renderHtmlDiagram } from "./diagram.js";
import fs from "node:fs/promises";
import path from "node:path";
import { compileProjectLayout } from "../layout/catalog.js";
import { applyCitationManifest } from "../citations/manifest.js";
import { compileImageSemanticLayout } from "../layout/image-semantics.js";
import { DECK_KEYMAP, PRESENTER_KEYMAP, deckRuntimeScript } from "./html-runtime.js";
import { latestRehearsedDuration } from "../delivery/retro.js";

const MIME_TYPES = new Map([
  [".avif", "image/avif"], [".gif", "image/gif"], [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"], [".png", "image/png"], [".svg", "image/svg+xml"],
  [".webp", "image/webp"], [".mp4", "video/mp4"], [".webm", "video/webm"],
  [".json", "application/json"], [".csv", "text/csv"], [".txt", "text/plain"]
]);

/** Build a deterministic, directly openable HTML presentation. */
export async function buildHtml(project) {
  project = applyCitationManifest(project);
  assertAccessibleTextCapacity(project);
  const embeddedAssets = await embedAssets(project);
  const plans = compileProjectLayout(project);
  const slides = project.pages.map((page, index) => renderSlide(page, plans[index], index, project.pages.length, embeddedAssets)).join("\n");
  const hasNotes = project.pages.some((page) => page.speaker_notes);
  // Notes live in an inert <template>: the main deck never instantiates them; only ?view=notes and ?view=presenter read them.
  const notes = hasNotes ? `<template id="speaker-notes-data"><aside id="speaker-notes" aria-label="Speaker notes"><h1>${escapeHtml(project.project.title)} — Speaker notes</h1>${project.pages.map((page) => `<article id="notes-${page.page}" data-page="${page.page}"><h2>${page.page}. ${escapeHtml(page.screen_text.title)}</h2>${page.estimated_duration_seconds ? `<p class="notes-duration">Estimated duration: ${page.estimated_duration_seconds} seconds (unrehearsed)</p>` : ""}<div class="notes-copy">${escapeHtml(page.speaker_notes ?? "No authored notes.")}</div></article>`).join("")}</aside></template>` : "";
  const runtimeConfig = {
    deck_id: deckId(project), project: project.project.name ?? null, title: project.project.title,
    pages: project.pages.map((page) => ({ page: page.page, ...(page.id ? { id: page.id } : {}), title: page.screen_text.title })),
    estimates: project.pages.map((page) => page.estimated_duration_seconds ?? null),
    rehearsed: project.pages.map((page) => { const latest = latestRehearsedDuration(page); return latest ? { seconds: latest.seconds, date: latest.date } : null; }),
    budget: presenterBudget(project)
  };
  const keymapList = (entries) => entries.map(([keys, action]) => `<dt>${escapeHtml(keys)}</dt><dd>${escapeHtml(action)}</dd>`).join("");
  const keymap = keymapList(DECK_KEYMAP);
  const presenterKeys = `<div class="presenter-keys"><h3>Presenter window</h3><dl>${keymapList(PRESENTER_KEYMAP)}</dl></div>`;
  const theme = project.theme;
  const title = escapeHtml(project.project.title);
  const headingFont = cssString(theme.typography.heading_font);
  const bodyFont = cssString(theme.typography.body_font);
  const margin = Math.round((theme.spacing.page_margin / theme.dimensions.width) * 1920);

  const result = `<!doctype html>
<html lang="${escapeAttribute(project.project.accessibility_profile?.document_language ?? "en")}" dir="${escapeAttribute(project.project.accessibility_profile?.reading_direction ?? "ltr")}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
:root{--bg:${theme.colors.background};--text:${theme.colors.text};--accent:${theme.colors.accent};--heading:${headingFont};--body:${bodyFont};--margin:${margin}px;color-scheme:light dark}
*{box-sizing:border-box}
html,body{width:100%;height:100%;margin:0;overflow:hidden;background:#111;color:var(--text);font-family:var(--body),sans-serif}
body{display:grid;place-items:center}
.viewport{position:relative;width:100vw;height:100vh;overflow:hidden}
.stage{position:absolute;left:50%;top:50%;width:1920px;height:1080px;transform-origin:center center;background:var(--bg);overflow:hidden}
.slide{position:absolute;inset:0;visibility:hidden;opacity:0;pointer-events:none;padding:var(--margin);display:grid;grid-template-rows:auto 1fr auto;gap:48px;background:var(--bg);transition:opacity .32s ease}
.slide[aria-hidden="false"]{visibility:visible;opacity:1;pointer-events:auto}
.slide::before{content:"";position:absolute;inset:0 0 auto;height:12px;background:var(--accent)}
.slide-header{display:flex;align-items:baseline;justify-content:space-between;gap:40px}
.slide-number{font-size:24px;font-variant-numeric:tabular-nums;letter-spacing:.08em;opacity:.58}
h1{max-width:1500px;margin:0;font-family:var(--heading),sans-serif;font-size:76px;line-height:1.08;letter-spacing:-.025em}
.slide-content{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(420px,.65fr);align-items:center;gap:88px;min-height:0}
.template-template-comparison .slide-content{grid-template-columns:1fr 1fr}.template-template-sequence .body-copy,.template-template-process .body-copy{grid-template-columns:repeat(3,1fr)}.template-template-cycle .slide-content{border:3px solid var(--accent);border-radius:50%;padding:64px}.template-template-hero h1{font-size:92px}.template-template-data .message{font-size:58px}
.slide-copy{align-self:center}
.subtitle{margin:0 0 24px;color:var(--accent);font:600 30px/1.3 var(--heading),sans-serif;letter-spacing:.04em}
.message{margin:0;max-width:1120px;font-size:46px;line-height:1.25;font-weight:600}
.body-copy{margin:38px 0 0;padding:0;list-style:none;display:grid;gap:18px;font-size:31px;line-height:1.4}
.body-copy li{display:flex;gap:18px;align-items:flex-start}.body-copy li::before{content:"";flex:none;width:12px;height:12px;margin-top:.55em;border-radius:50%;background:var(--accent)}
.assets{height:100%;min-height:360px;display:grid;place-items:center;gap:28px}
.assets:empty{display:none}.slide-content:not(:has(.assets > *)){grid-template-columns:1fr}
figure{position:relative;width:100%;height:100%;max-height:650px;margin:0;display:grid;place-items:center;overflow:hidden}
figure img,figure video{display:block;width:100%;height:100%;object-fit:var(--fit,contain)}
.semantic-label{position:absolute;z-index:2;display:grid;place-items:center;padding:6px;border:2px solid var(--accent);background:var(--bg);font:600 18px/1.2 var(--body);text-align:center}.semantic-connectors{position:absolute;z-index:1;inset:0;width:100%;height:100%;pointer-events:none}.semantic-connectors line{stroke:var(--accent);stroke-width:.5}
.asset-link{display:inline-flex;align-items:center;justify-content:center;padding:24px 32px;border:3px solid var(--accent);border-radius:999px;color:var(--text);font-size:28px;text-decoration:none}
.slide-footer{display:flex;justify-content:space-between;gap:40px;font-size:21px;letter-spacing:.04em;opacity:.56}
.slide-citations{display:flex;flex-wrap:wrap;gap:8px 22px;min-height:28px;font-size:16px;line-height:1.35;opacity:.78}.slide-citations span{white-space:nowrap}
.relation-diagram{position:relative;width:100%;height:650px;align-self:center}.diagram-connectors{position:absolute;inset:0;width:100%;height:100%;overflow:visible;fill:var(--accent);stroke:none}.diagram-connectors line{stroke:var(--accent);stroke-width:2}.diagram-connectors text{font-size:17px;font-family:var(--body)}.diagram-node{position:absolute;display:grid;place-items:center;text-align:center;font-size:31px;line-height:1.45;white-space:pre-line;padding:10px}.diagram-node:after{content:"";position:absolute;left:15%;right:15%;bottom:0;border-bottom:1px solid var(--accent);opacity:.5}.diagram-input,.diagram-output,.diagram-condition{font-weight:700}.diagram-output:after{border-width:3px}.diagram-condition{padding:20px;background:color-mix(in srgb,var(--accent) 8%,transparent);clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%)}.diagram-condition span{max-width:64%}.diagram-condition:after{display:none}.slide-content:has(.relation-diagram){display:block}
.controls{position:fixed;z-index:5;right:24px;bottom:20px;display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:999px;background:rgba(0,0,0,.72);color:#fff;font:600 14px/1 sans-serif}
.controls button{min-width:36px;height:36px;padding:0 10px;border:1px solid rgba(255,255,255,.38);border-radius:999px;background:transparent;color:inherit;font-size:20px;cursor:pointer}.controls button:focus-visible{outline:3px solid #fff;outline-offset:2px}
.controls progress{width:120px;height:6px;accent-color:var(--accent)}
.notes-link{position:fixed;z-index:6;top:12px;right:16px;padding:8px 12px;background:#111;color:#fff;border-radius:6px;font:14px sans-serif}
body.notes-view{display:block;overflow:auto;background:var(--bg)}.notes-view .viewport,.notes-view .controls,.notes-view .notes-link{display:none}#speaker-notes{max-width:960px;margin:0 auto;padding:40px}#speaker-notes h1{font-size:32px}#speaker-notes article{margin:32px 0;border-top:1px solid currentColor;padding-top:16px}.notes-copy{white-space:pre-wrap;font-size:20px;line-height:1.6}.notes-duration{font-size:14px}
.blackout{position:fixed;inset:0;z-index:30;background:#000;cursor:none}
.keymap,.overview,.jump-indicator{position:fixed;z-index:25;color:#fff;font:15px/1.4 system-ui,sans-serif}.keymap[hidden],.overview[hidden],.jump-indicator[hidden],.blackout[hidden]{display:none}
.keymap{left:50%;top:50%;transform:translate(-50%,-50%);width:min(440px,92vw);padding:20px 24px;border-radius:12px;background:rgba(17,17,17,.95);box-shadow:0 12px 40px rgba(0,0,0,.5)}.keymap h2{margin:0 0 12px;font-size:18px}.keymap dl{display:grid;grid-template-columns:auto 1fr;gap:6px 16px;margin:0 0 16px}.keymap dt{font-weight:700;font-variant-numeric:tabular-nums}.keymap dd{margin:0;opacity:.85}
.keymap button,.overview button[data-close],.presenter button{padding:6px 12px;border:1px solid rgba(255,255,255,.38);border-radius:6px;background:transparent;color:inherit;font:inherit;cursor:pointer}
.overview{inset:0;overflow:auto;padding:24px;background:rgba(10,10,10,.96)}.overview-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}.overview-head h2{margin:0;font-size:18px}.overview-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(420px,100%),1fr));gap:16px}
.overview-tile{display:grid;gap:6px;padding:6px;border:2px solid transparent;border-radius:8px;background:rgba(255,255,255,.06);color:#fff;font:13px/1.3 system-ui,sans-serif;text-align:left;cursor:pointer}.overview-tile[aria-current="true"]{border-color:var(--accent)}.overview-tile:focus-visible{outline:3px solid #fff}
.thumb-frame{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;background:var(--bg);pointer-events:none}.thumb-stage{position:absolute;left:0;top:0;width:1920px;height:1080px;transform-origin:0 0;overflow:hidden;background:var(--bg)}.thumb-stage .slide{visibility:visible;opacity:1;transition:none;pointer-events:none;color:var(--text)}
.jump-indicator{left:50%;bottom:72px;transform:translateX(-50%);padding:8px 16px;border-radius:999px;background:rgba(0,0,0,.8);font-weight:600}
body.presenter-view{display:block;overflow:auto;background:#141414;color:#eee}.presenter-view .viewport,.presenter-view .controls,.presenter-view .notes-link{display:none}
.presenter{display:grid;grid-template-rows:auto auto 1fr auto;gap:12px;min-height:100vh;padding:12px 16px;font:15px/1.45 system-ui,sans-serif}.presenter h2{margin:0 0 8px;font-size:14px;font-weight:600;letter-spacing:.04em;opacity:.8}
.presenter-bar,.presenter-nav{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px}.presenter-title{margin-right:auto}.presenter-status{opacity:.7}.presenter-clock b{font-size:22px;font-variant-numeric:tabular-nums}.presenter-clock.over b{color:#ff8a80}.presenter-clock[hidden]{display:none}
.presenter-main{display:grid;grid-template-columns:minmax(0,3fr) minmax(260px,2fr);gap:16px;min-height:0}.presenter-side{display:grid;grid-template-rows:auto auto auto auto 1fr;min-height:0}.presenter-side>div[data-p="next"]{margin-bottom:12px}
.presenter-blackout{margin-left:8px;padding:2px 8px;border-radius:4px;background:#b00020;color:#fff}.presenter-blackout[hidden]{display:none}.presenter-estimate{margin:0 0 8px;font-size:13px;opacity:.75}.presenter-end{margin:0;padding:24px;border:1px dashed rgba(255,255,255,.3);text-align:center;opacity:.7}
.presenter-notes{overflow:auto;white-space:pre-wrap;font-size:20px;line-height:1.6}.presenter-notes.empty{opacity:.6;font-style:italic}.presenter-jump-hint{opacity:.6;font-size:13px}
.presenter-keys{display:none}.presenter-view .presenter-keys{display:block}.presenter-keys h3{margin:0 0 8px;font-size:15px}
.presenter-record{display:flex;flex-wrap:wrap;align-items:center;gap:8px 16px;font-size:13px}.presenter-record label{display:inline-flex;align-items:center;gap:6px;opacity:.85}.presenter-record select,.presenter-record input{padding:4px 6px;border:1px solid rgba(255,255,255,.38);border-radius:6px;background:#222;color:inherit;font:inherit}.presenter-marks{margin-right:auto;font-weight:600}.presenter button:disabled{opacity:.45;cursor:not-allowed}
@media (max-width:760px){.presenter-main{grid-template-columns:1fr}}
@media print{.notes-link,.controls,.blackout,.keymap,.overview,.jump-indicator{display:none}}
@media (prefers-reduced-motion:reduce){.slide{transition:none}}
</style>
</head>
<body>
<div class="viewport"><main class="stage" aria-label="${title}">${slides}</main></div>
<nav class="controls" lang="en" aria-label="Slide navigation"><button type="button" data-nav="previous" aria-label="Previous slide">&#8592;</button><progress value="1" max="${project.pages.length}" aria-label="Presentation progress"></progress><output aria-live="polite">1 / ${project.pages.length}</output><button type="button" data-nav="next" aria-label="Next slide">&#8594;</button><button type="button" data-nav="fullscreen" aria-label="Enter fullscreen" title="Fullscreen (F)">&#x26F6;</button><button type="button" data-nav="overview" aria-label="Slide overview" title="Slide overview (I / G / Esc)">&#x25A6;</button><button type="button" data-nav="presenter" aria-label="Open presenter view" title="Presenter view (N)">&#x25EB;</button><button type="button" data-nav="help" aria-label="Keyboard shortcuts" title="Keyboard shortcuts (?)">?</button></nav>
<div class="blackout" hidden aria-hidden="true"></div>
<div class="jump-indicator" hidden role="status" lang="en"></div>
<div class="overview" hidden role="dialog" aria-label="Slide overview" lang="en"><div class="overview-head"><h2>Slide overview</h2><button type="button" data-close>Close (Esc)</button></div><div class="overview-grid"></div></div>
<div class="keymap" hidden role="dialog" aria-labelledby="keymap-title" lang="en"><h2 id="keymap-title">Keyboard shortcuts</h2><dl>${keymap}</dl>${presenterKeys}<button type="button" data-close>Close (Esc)</button></div>
${notes}
${hasNotes ? '<a class="notes-link" href="?view=notes" target="_blank" rel="noopener">Speaker notes ↗</a>' : ""}
<script type="application/json" id="deck-runtime-config">${jsonForScript(runtimeConfig)}</script>
<script>
${deckRuntimeScript()}
</script>
</body>
</html>\n`;
  return applyAccessibilityHtml(result, project);
}

async function embedAssets(project) {
  const entries = await Promise.all(project.assets.map(async (asset) => {
    const file = path.resolve(project.root, asset.file);
    const relative = path.relative(project.root, file);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`asset escapes project root: ${asset.file}`);
    const bytes = await fs.readFile(file);
    const mime = MIME_TYPES.get(path.extname(file).toLowerCase()) ?? "application/octet-stream";
    return [asset.id, { ...asset, mime, uri: `data:${mime};base64,${bytes.toString("base64")}` }];
  }));
  return new Map(entries);
}

function renderSlide(page, plan, index, count, assets) {
  const screen = page.screen_text;
  const subtitle = screen.subtitle ? `<p class="subtitle" data-reading-key="subtitle">${escapeHtml(screen.subtitle)}</p>` : "";
  const body = screen.body?.length ? `<ul class="body-copy" data-reading-key="body">${screen.body.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` : "";
  const figures = page.asset_slots.map((slot) => renderAsset(slot, assets.get(slot.asset_id), page.page)).join("");
  const citations = page.citation_entries?.length ? `<div class="slide-citations" aria-label="Sources">${page.citation_entries.map((entry) => `<span>[${entry.number}] ${escapeHtml(entry.public_label || entry.title || "Citation metadata pending")}</span>`).join("")}</div>` : "";
  const slideTheme = `--bg:${plan.theme.colors.background};--text:${plan.theme.colors.text};--accent:${plan.theme.colors.accent};--heading:${cssString(plan.theme.typography.heading_font)};--body:${cssString(plan.theme.typography.body_font)}`;
  return `<section class="slide relation-${escapeAttribute(page.relation)} template-${escapeAttribute(plan.template_id)}" style="${escapeAttribute(slideTheme)}" data-page="${page.page}" lang="${escapeAttribute(page.accessibility?.language ?? "")}" data-html-layout="${escapeAttribute(plan.renderer.html)}" data-qa-policy="strict" aria-labelledby="slide-title-${page.page}" aria-hidden="${index !== 0}">
  <header class="slide-header" data-qa-id="page-${page.page}-header" data-qa-role="content"><h1 id="slide-title-${page.page}" data-reading-key="title">${escapeHtml(screen.title)}</h1><span class="slide-number">${String(index + 1).padStart(2, "0")} / ${String(count).padStart(2, "0")}</span></header>
  <div class="slide-content">${page.diagram ? renderHtmlDiagram(page.diagram, page.page) : `<div class="slide-copy" data-qa-id="page-${page.page}-copy" data-qa-role="node">${subtitle}<p class="message" data-reading-key="message">${escapeHtml(page.three_second_message)}</p>${body}</div>`}<div class="assets" data-reading-key="assets" data-qa-id="page-${page.page}-assets" data-qa-role="node">${figures}</div></div>
  ${citations}<footer class="slide-footer" data-qa-id="page-${page.page}-footer" data-qa-role="content"><span>${escapeHtml(page.task)}</span><span>${escapeHtml(page.visual_job)}</span></footer>
</section>`;
}

function renderAsset(slot, asset, pageNumber) {
  if (!asset) throw new Error(`unknown asset: ${slot.asset_id}`);
  const decorative = slot.decorative ?? asset.decorative ?? false;
  const description = slot.long_description ?? asset.long_description;
  const label = escapeAttribute(decorative ? "" : slot.alt ?? asset.alt ?? description ?? slot.role);
  const assetId = escapeAttribute(asset.id);
  const style = `--fit:${slot.fit === "cover" ? "cover" : "contain"}`;
  if (asset.mime.startsWith("image/")) return `<figure ${decorative ? 'aria-hidden="true"' : 'role="group"'} style="${style}"><img data-asset-id="${assetId}" src="${asset.uri}" alt="${label}"${description && !decorative ? ` aria-describedby="description-${assetId}-${pageNumber}"` : ""}>${renderSemanticAnnotations(asset, slot)}${description && !decorative ? `<figcaption class="a11y-description" id="description-${assetId}-${pageNumber}">${escapeHtml(description)}</figcaption>` : ""}</figure>`;
  if (asset.mime.startsWith("video/")) return `<figure aria-label="${label}" style="${style}"><video data-asset-id="${assetId}" controls preload="metadata" src="${asset.uri}"></video></figure>`;
  return `<a class="asset-link" href="${asset.uri}" download="${escapeAttribute(path.basename(asset.file))}">${label}</a>`;
}

function renderSemanticAnnotations(asset, slot) {
  const layout = compileImageSemanticLayout(asset, slot, { x: 0, y: 0, w: 100, h: 100 }, { units: "percent" });
  if (!layout.annotations.length) return "";
  const labels = layout.annotations.map(({ id, text, geometry }) => `<span class="semantic-label" data-content-id="${escapeAttribute(id)}" style="left:${geometry.x}%;top:${geometry.y}%;width:${geometry.w}%;height:${geometry.h}%">${escapeHtml(text)}</span>`).join("");
  const lines = layout.connections.map(({ from, to }) => `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"/>`).join("");
  return `<svg class="semantic-connectors" viewBox="0 0 100 100" aria-hidden="true">${lines}</svg>${labels}`;
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function escapeAttribute(value) { return escapeHtml(value); }
function jsonForScript(value) { return JSON.stringify(value).replaceAll("<", "\\u003c").replaceAll("\u2028", "\\u2028").replaceAll("\u2029", "\\u2029"); }

/** Stable per-deck id so presenter sync never crosses between different decks open in one browser. */
function deckId(project) {
  let hash = 0x811c9dc5;
  for (const char of `${project.project.name ?? ""}|${project.project.title}|${project.pages.length}`) hash = Math.imul(hash ^ char.codePointAt(0), 0x01000193) >>> 0;
  return hash.toString(36);
}

/**
 * Total used by the presenter's remaining-time clock: a declared project talk budget
 * (`talk_budget.total_minutes`) wins; otherwise the sum of per-page planning estimates
 * when every page has one; otherwise no remaining time is shown.
 */
function presenterBudget(project) {
  const minutes = Number((project.contracts?.project?.talk_budget ?? project.project.talk_budget)?.total_minutes);
  if (Number.isFinite(minutes) && minutes > 0) return { seconds: Math.round(minutes * 60), source: "talk_budget" };
  const estimates = project.pages.map((page) => page.estimated_duration_seconds);
  if (estimates.length && estimates.every((value) => Number.isInteger(value) && value > 0)) return { seconds: estimates.reduce((sum, value) => sum + value, 0), source: "page_estimates" };
  return null;
}
function cssString(value) { return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`; }
