const ROLES = new Set(["input", "process", "output", "condition", "evidence", "context"]);
const SIDES = new Set(["left", "right", "top", "bottom"]);

/** A bounded, opt-in relation graph. Text is authored visible content, not an inferred fact. */
export function validateDiagram(diagram) {
  if (diagram === undefined) return [];
  const errors = [];
  if (!diagram || typeof diagram !== "object" || Array.isArray(diagram)) return ["diagram must be an object"];
  if (!Array.isArray(diagram.nodes) || diagram.nodes.length < 2 || diagram.nodes.length > 12) return ["diagram.nodes must contain 2–12 nodes"];
  if (!Array.isArray(diagram.edges) || diagram.edges.length < 1 || diagram.edges.length > 16) return ["diagram.edges must contain 1–16 connections"];
  const ids = new Set();
  for (const [index, node] of diagram.nodes.entries()) {
    const prefix = `diagram.nodes[${index}]`;
    if (!node || !/^[a-z][a-z0-9-]*$/.test(node.id ?? "") || ids.has(node.id)) errors.push(`${prefix}.id must be unique and stable`);
    ids.add(node?.id);
    if (typeof node?.text !== "string" || !node.text.trim() || node.text.length > 100) errors.push(`${prefix}.text must contain 1–100 characters`);
    if (!ROLES.has(node?.role)) errors.push(`${prefix}.role is invalid`);
    if (!["x", "y", "w", "h"].every(key => Number.isFinite(node?.[key])) || node.x < 0 || node.y < 0 || node.w <= 0 || node.h <= 0 || node.x + node.w > 1.000001 || node.y + node.h > 1.000001) errors.push(`${prefix} must fit within normalized diagram bounds`);
  }
  for (const [index, edge] of diagram.edges.entries()) {
    if (!edge || !ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) errors.push(`diagram.edges[${index}] must connect distinct existing nodes`);
    for (const field of ["from_side", "to_side"]) if (edge?.[field] !== undefined && !SIDES.has(edge[field])) errors.push(`diagram.edges[${index}].${field} is invalid`);
    if (edge?.label !== undefined && (typeof edge.label !== "string" || !edge.label.trim() || edge.label.length > 12)) errors.push(`diagram.edges[${index}].label must contain 1–12 characters`);
  }
  return errors;
}

export function compileDiagram(diagram) {
  const errors = validateDiagram(diagram);
  if (errors.length) throw Object.assign(new Error(errors.join("; ")), { code: "DIAGRAM_INVALID" });
  const byId = new Map(diagram.nodes.map(node => [node.id, node]));
  const edges = diagram.edges.map((edge, index) => {
    const from = byId.get(edge.from), to = byId.get(edge.to);
    const dx = (to.x + to.w / 2) - (from.x + from.w / 2), dy = (to.y + to.h / 2) - (from.y + from.h / 2);
    const horizontal = Math.abs(dx) >= Math.abs(dy);
    const fromSide = edge.from_side ?? (horizontal ? dx >= 0 ? "right" : "left" : dy >= 0 ? "bottom" : "top");
    const toSide = edge.to_side ?? (horizontal ? dx >= 0 ? "left" : "right" : dy >= 0 ? "top" : "bottom");
    return { ...edge, id: `edge-${index + 1}`, start: anchor(from, fromSide), end: anchor(to, toSide) };
  });
  return { nodes: diagram.nodes, edges };
}
function anchor(node, side) {
  if (side === "left") return { x: node.x, y: node.y + node.h / 2 };
  if (side === "right") return { x: node.x + node.w, y: node.y + node.h / 2 };
  if (side === "top") return { x: node.x + node.w / 2, y: node.y };
  return { x: node.x + node.w / 2, y: node.y + node.h };
}
