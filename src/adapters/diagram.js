import { compileDiagram } from "../layout/diagram.js";

export function renderNativeDiagram(slide, diagram, bounds, theme, colors) {
  const plan = compileDiagram(diagram);
  for (const edge of plan.edges) {
    const x1 = bounds.x + edge.start.x * bounds.w, y1 = bounds.y + edge.start.y * bounds.h;
    const x2 = bounds.x + edge.end.x * bounds.w, y2 = bounds.y + edge.end.y * bounds.h;
    slide.addShape("line", { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1), flipH: x1 > x2, flipV: y1 > y2,
      line: { color: colors.accent, width: 1.8, beginArrowType: "none", endArrowType: "triangle" }, objectName: `Diagram connector ${edge.from} to ${edge.to}` });
    if (edge.label) slide.addText(edge.label, { x: (x1 + x2) / 2 - 0.32, y: (y1 + y2) / 2 - 0.3, w: 0.64, h: 0.27,
      fontFace: theme.typography.body_font, fontSize: 14, color: colors.accent, margin: 0, align: "center", objectName: `Diagram connector label ${edge.id}` });
  }
  for (const node of plan.nodes) {
    const box = { x: bounds.x + node.x * bounds.w, y: bounds.y + node.y * bounds.h, w: node.w * bounds.w, h: node.h * bounds.h };
    if (node.role === "condition") slide.addShape("diamond", { ...box, fill: { color: colors.accent, transparency: 92 }, line: { color: colors.accent, width: 1.4 }, objectName: `Diagram condition ${node.id}` });
    else slide.addShape("line", { x: box.x + box.w * 0.15, y: box.y + box.h, w: box.w * 0.7, h: 0, line: { color: colors.accent, transparency: 50, width: node.role === "output" ? 2 : 0.7 }, objectName: `Decorative diagram baseline ${node.id}` });
    const condition = node.role === "condition";
    const inset = condition ? box.w * 0.18 : 0.08;
    slide.addText(node.text, { x: box.x + inset, y: box.y + (condition ? box.h * 0.2 : 0.04), w: box.w - inset * 2, h: box.h * (condition ? 0.6 : 0.88),
      fontFace: theme.typography.body_font, fontSize: node.text.length > 42 ? 17 : node.text.length > 24 ? 18 : 21, color: colors.text,
      bold: ["input", "output", "condition"].includes(node.role), margin: 0, align: "center", valign: "mid", breakLine: false, objectName: `Diagram ${node.role} ${node.id}` });
  }
}

export function renderHtmlDiagram(diagram, page) {
  const plan = compileDiagram(diagram);
  const arrowId = `diagram-arrow-${page}`;
  const edges = plan.edges.map(edge => `<line x1="${edge.start.x * 1000}" y1="${edge.start.y * 500}" x2="${edge.end.x * 1000}" y2="${edge.end.y * 500}" marker-end="url(#${arrowId})"/>${edge.label ? `<text x="${(edge.start.x + edge.end.x) * 500}" y="${(edge.start.y + edge.end.y) * 250 - 12}" text-anchor="middle">${escapeHtml(edge.label)}</text>` : ""}`).join("");
  const nodes = plan.nodes.map(node => `<div class="diagram-node diagram-${node.role}" style="left:${node.x * 100}%;top:${node.y * 100}%;width:${node.w * 100}%;height:${node.h * 100}%" data-qa-id="page-${page}-diagram-${node.id}" data-qa-role="node"><span>${escapeHtml(node.text)}</span></div>`).join("");
  return `<div class="relation-diagram" aria-label="Information relationship"><svg class="diagram-connectors" viewBox="0 0 1000 500" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="${arrowId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"/></marker></defs>${edges}</svg>${nodes}</div>`;
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]); }
