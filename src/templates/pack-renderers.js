// Independent implementation registries. Each adapter interprets its own mode;
// no HTML output or geometry is converted into PowerPoint shapes.
export const PACK_HTML_RENDERERS = Object.freeze({ "html-pack-split": "split", "html-pack-stacked": "stacked" });
export const PACK_PPTX_RENDERERS = Object.freeze({ "pptx-pack-split": "split", "pptx-pack-stacked": "stacked" });
