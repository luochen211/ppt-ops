const escape = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const safeLink = value => { try { const url = new URL(value); return ["https:", "http:", "mailto:"].includes(url.protocol) ? url.href : undefined; } catch { return undefined; } };

export function renderAccessibilityAlternatives(page) {
  const semantics = page.accessibility ?? {};
  const links = (semantics.links ?? []).map(link => { const url = safeLink(link.destination); return url ? `<li><a href="${escape(url)}" rel="noopener">${escape(link.label)}</a></li>` : `<li>${escape(link.label)} — destination unavailable</li>`; }).join("");
  const charts = (semantics.charts ?? []).map(chart => `<article><h3>${escape(chart.conclusion)}</h3><p>${escape(chart.long_description ?? chart.accessible_data ?? "")}</p>${chart.data_table_ref ? `<p>Data reference: ${escape(chart.data_table_ref)}</p>` : ""}</article>`).join("");
  const tables = (semantics.tables ?? []).map(table => `<table><caption>${escape(table.title ?? "Data")}</caption><thead><tr>${(table.headers ?? []).map(header => `<th scope="col">${escape(header)}</th>`).join("")}</tr></thead><tbody>${(table.rows ?? []).map(row => `<tr>${row.map(cell => `<td>${escape(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>`).join("");
  if (!links && !charts && !tables) return "";
  return `<details class="a11y-alternatives" data-reading-key="alternatives"><summary lang="en">Descriptions, data and links</summary>${links ? `<ul>${links}</ul>` : ""}${charts}${tables}</details>`;
}

export function applyAccessibilityHtml(html, project) {
  const profile = project.project.accessibility_profile;
  // An empty page lang means unknown in HTML, so let unspecified pages inherit.
  html = html.replaceAll(' lang=""', "");
  if (!profile?.enabled) return html;
  const scale = profile.text_scale ?? 1;
  html = html.replace(/<style>([\s\S]*?)<\/style>/, (_, css) => `<style>${css.replace(/font-size:(\d+(?:\.\d+)?)px/g, (_, size) => `font-size:${Number(size) * scale}px`).replace(/font:([^;{}]*?)(\d+(?:\.\d+)?)px\//g, (_, prefix, size) => `font:${prefix}${Number(size) * scale}px/`)}
    .controls{background:#111}.slide-footer,.slide-number{opacity:1}.boundary-active .controls{display:flex}
    :focus-visible{outline:3px solid currentColor;outline-offset:4px}
    .a11y-description{position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
    .a11y-alternatives{position:absolute;left:var(--margin);bottom:16px;z-index:8;max-width:85%;max-height:65%;overflow:auto;background:var(--bg);color:var(--text);padding:8px 12px;border:2px solid currentColor;font-size:${22 * scale}px}
    .a11y-alternatives a{color:inherit;text-decoration:underline}.a11y-alternatives th,.a11y-alternatives td{padding:6px;border:1px solid currentColor}.a11y-alternatives table{border-collapse:collapse}
  </style>`);
  html = html.replace(/(<section\b[^>]*data-page="(\d+)"[\s\S]*?)(<\/section>)/g, (all, content, number, end) => {
    const page = project.pages.find(page => page.page === Number(number));
    // Boundary elements are absolutely positioned, so this improves DOM order without changing geometry.
    if (content.includes('class="slide boundary-slide')) content = content.replace(/(\s*<div class="boundary-assets"[\s\S]*?<\/div>)(\s*<h1[\s\S]*?<\/h1>)/, "$2$1");
    return content + renderAccessibilityAlternatives(page) + end;
  });
  return html;
}
