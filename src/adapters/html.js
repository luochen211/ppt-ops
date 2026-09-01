import fs from "node:fs/promises";
import path from "node:path";
import { compileProjectLayout } from "../layout/catalog.js";

const MIME_TYPES = new Map([
  [".avif", "image/avif"], [".gif", "image/gif"], [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"], [".png", "image/png"], [".svg", "image/svg+xml"],
  [".webp", "image/webp"], [".mp4", "video/mp4"], [".webm", "video/webm"],
  [".json", "application/json"], [".csv", "text/csv"], [".txt", "text/plain"]
]);

/** Build a deterministic, directly openable HTML presentation. */
export async function buildHtml(project) {
  const embeddedAssets = await embedAssets(project);
  const plans = compileProjectLayout(project);
  const slides = project.pages.map((page, index) => renderSlide(page, plans[index], index, project.pages.length, embeddedAssets)).join("\n");
  const theme = project.theme;
  const title = escapeHtml(project.project.title);
  const headingFont = cssString(theme.typography.heading_font);
  const bodyFont = cssString(theme.typography.body_font);
  const margin = Math.round((theme.spacing.page_margin / theme.dimensions.width) * 1920);

  return `<!doctype html>
<html lang="en">
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
figure{width:100%;height:100%;max-height:650px;margin:0;display:grid;place-items:center;overflow:hidden}
figure img,figure video{display:block;width:100%;height:100%;object-fit:var(--fit,contain)}
.asset-link{display:inline-flex;align-items:center;justify-content:center;padding:24px 32px;border:3px solid var(--accent);border-radius:999px;color:var(--text);font-size:28px;text-decoration:none}
.slide-footer{display:flex;justify-content:space-between;gap:40px;font-size:21px;letter-spacing:.04em;opacity:.56}
.controls{position:fixed;z-index:5;right:24px;bottom:20px;display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:999px;background:rgba(0,0,0,.72);color:#fff;font:600 14px/1 sans-serif}
.controls button{width:36px;height:36px;border:1px solid rgba(255,255,255,.38);border-radius:50%;background:transparent;color:inherit;font-size:20px;cursor:pointer}.controls button:focus-visible{outline:3px solid #fff;outline-offset:2px}
.controls progress{width:120px;height:6px;accent-color:var(--accent)}
@media (prefers-reduced-motion:reduce){.slide{transition:none}}
</style>
</head>
<body>
<div class="viewport"><main class="stage" aria-label="${title}">${slides}</main></div>
<nav class="controls" aria-label="Slide navigation"><button type="button" data-nav="previous" aria-label="Previous slide">&#8592;</button><progress value="1" max="${project.pages.length}" aria-label="Presentation progress"></progress><output aria-live="polite">1 / ${project.pages.length}</output><button type="button" data-nav="next" aria-label="Next slide">&#8594;</button></nav>
<script>
(()=>{const slides=[...document.querySelectorAll('.slide')],stage=document.querySelector('.stage'),progress=document.querySelector('progress'),output=document.querySelector('output');let current=0;function scale(){stage.style.transform='translate(-50%,-50%) scale('+Math.min(innerWidth/1920,innerHeight/1080)+')'}function show(index){current=Math.max(0,Math.min(slides.length-1,index));slides.forEach((slide,i)=>{const active=i===current;slide.setAttribute('aria-hidden',String(!active));slide.toggleAttribute('inert',!active)});progress.value=current+1;output.value=(current+1)+' / '+slides.length;location.hash='slide-'+slides[current].dataset.page}function move(delta){show(current+delta)}addEventListener('resize',scale);addEventListener('keydown',event=>{if(['ArrowRight','ArrowDown','PageDown',' '].includes(event.key)){event.preventDefault();move(1)}else if(['ArrowLeft','ArrowUp','PageUp'].includes(event.key)){event.preventDefault();move(-1)}else if(event.key==='Home'){event.preventDefault();show(0)}else if(event.key==='End'){event.preventDefault();show(slides.length-1)}});document.querySelector('[data-nav="previous"]').addEventListener('click',()=>move(-1));document.querySelector('[data-nav="next"]').addEventListener('click',()=>move(1));const requested=slides.findIndex(slide=>'slide-'+slide.dataset.page===location.hash.slice(1));scale();show(requested<0?0:requested)})();
</script>
</body>
</html>\n`;
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
  const subtitle = screen.subtitle ? `<p class="subtitle">${escapeHtml(screen.subtitle)}</p>` : "";
  const body = screen.body?.length ? `<ul class="body-copy">${screen.body.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` : "";
  const figures = page.asset_slots.map((slot) => renderAsset(slot, assets.get(slot.asset_id))).join("");
  const slideTheme = `--bg:${plan.theme.colors.background};--text:${plan.theme.colors.text};--accent:${plan.theme.colors.accent};--heading:${cssString(plan.theme.typography.heading_font)};--body:${cssString(plan.theme.typography.body_font)}`;
  return `<section class="slide relation-${escapeAttribute(page.relation)} template-${escapeAttribute(plan.template_id)}" style="${escapeAttribute(slideTheme)}" data-page="${page.page}" data-html-layout="${escapeAttribute(plan.renderer.html)}" aria-labelledby="slide-title-${page.page}" aria-hidden="${index !== 0}">
  <header class="slide-header"><h1 id="slide-title-${page.page}">${escapeHtml(screen.title)}</h1><span class="slide-number">${String(index + 1).padStart(2, "0")} / ${String(count).padStart(2, "0")}</span></header>
  <div class="slide-content"><div class="slide-copy">${subtitle}<p class="message">${escapeHtml(page.three_second_message)}</p>${body}</div><div class="assets">${figures}</div></div>
  <footer class="slide-footer"><span>${escapeHtml(page.task)}</span><span>${escapeHtml(page.visual_job)}</span></footer>
</section>`;
}

function renderAsset(slot, asset) {
  if (!asset) throw new Error(`unknown asset: ${slot.asset_id}`);
  const label = escapeAttribute(asset.alt ?? slot.role);
  const style = `--fit:${slot.fit === "cover" ? "cover" : "contain"}`;
  if (asset.mime.startsWith("image/")) return `<figure aria-label="${label}" style="${style}"><img src="${asset.uri}" alt="${label}"></figure>`;
  if (asset.mime.startsWith("video/")) return `<figure aria-label="${label}" style="${style}"><video controls preload="metadata" src="${asset.uri}"></video></figure>`;
  return `<a class="asset-link" href="${asset.uri}" download="${escapeAttribute(path.basename(asset.file))}">${label}</a>`;
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function escapeAttribute(value) { return escapeHtml(value); }
function cssString(value) { return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`; }
