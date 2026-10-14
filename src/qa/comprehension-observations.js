const KINDS = new Set(["label", "frame", "connector", "content", "image"]);
const ROLES = new Set(["title", "message", "supporting_content", "annotation", "relationship", "decoration", "interaction_cue"]);

export function collectComprehensionObservations(pages, { source }) {
  if (!Array.isArray(pages) || !source) throw new TypeError("pages and source are required");
  return pages.flatMap(({ page, elements = [] }) => elements.map((element, index) => ({
    page,
    element_id: stableId(element, page, index),
    kind: KINDS.has(element.kind) ? element.kind : "content",
    semantic_role: ROLES.has(element.semantic_role) ? element.semantic_role : null,
    container_id: clean(element.container_id), target_id: clean(element.target_id),
    emphasis: element.emphasis === "primary" ? "primary" : null,
    interaction_affordance: element.interaction_affordance === true,
    evidence_source: source,
    confidence: Number.isFinite(element.confidence) ? element.confidence : 1
  })));
}

export const collectHtmlComprehensionObservations = (pages) => collectComprehensionObservations(pages, { source: "html-dom-contract" });
export const collectPptxComprehensionObservations = (pages) => collectComprehensionObservations(pages, { source: "pptx-ooxml-contract" });

function stableId(element, page, index) { return clean(element.element_id) ?? clean(element.name) ?? `page-${page}-element-${index + 1}`; }
function clean(value) { return typeof value === "string" && value.trim() ? value.trim() : null; }
