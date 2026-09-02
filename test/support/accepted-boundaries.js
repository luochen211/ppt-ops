import fs from "node:fs/promises";
import path from "node:path";
import { VisualAssetPipeline } from "../../src/visual-assets/pipeline.js";

export const ALPHA_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X0Y8WQAAAABJRU5ErkJggg==", "base64");
export const VISUAL_PASS = Object.freeze({
  semantic_action: true,
  subject_count: true,
  identity_boundary: true,
  visible_text_or_logo: true,
  reference_invariants: true,
  edge_integration: true,
  copy_safe_space: true
});

export async function seedAcceptedBoundaryImages(projectRoot, options = {}) {
  const pages = JSON.parse(await fs.readFile(path.join(projectRoot, "pages.json"), "utf8"));
  const selected = options.pageIds ?? [...new Set([pages[0]?.id, pages.at(-1)?.id].filter(Boolean))];
  const source = path.join(projectRoot, ".pptops", "test-boundary-image.png");
  await fs.mkdir(path.dirname(source), { recursive: true });
  await fs.writeFile(source, ALPHA_PNG);
  let counter = 0;
  const runTag = selected.join("-");
  const pipeline = new VisualAssetPipeline(projectRoot, {
    now: () => "2026-09-02T08:00:00.000Z",
    idFactory: () => `boundary-fixture-${runTag}-${++counter}`
  });
  const results = [];
  for (const pageId of selected) {
    const page = pages.find((candidate) => candidate.id === pageId);
    if (!page) throw new Error(`unknown fixture page: ${pageId}`);
    const slotRole = page.asset_slots?.[0]?.role ?? "boundary-hero";
    const prepared = await pipeline.prepare({
      role: "background", mode: "fresh", page_id: pageId, slot_role: slotRole,
      semantic_goal: `Provide the required generated boundary visual for ${pageId}`,
      three_second_message: page.three_second_message,
      subject_count: 0, identity_boundary: "no identifiable person",
      action: "A restrained abstract editorial composition establishes the boundary page",
      prohibited_interpretations: ["photographic evidence", "generated presentation text"],
      copy_safe_zones: ["center"], aspect_ratio: "1:1", text_policy: "none", transparency_required: true
    });
    const generation = await pipeline.ingest(prepared.brief.id, { sourceFile: source, provider: "test-fixture", model: "deterministic-alpha-png", mime: "image/png" });
    const observation = await pipeline.recordVisualObservation(generation.id, { actor: "agent", verdict: "pass", checks: VISUAL_PASS, notes: "Deterministic test fixture only; not live visual acceptance." });
    const decision = await pipeline.recordUserDecision(generation.id, { decision: "accept", raw_feedback: "Explicit test-fixture acceptance; not business acceptance." });
    const registration = await pipeline.registerAccepted(generation.id, {
      asset_id: `generated-${pageId}-boundary`, page_id: pageId, slot_role: slotRole,
      alt: `Generated boundary fixture for ${pageId}`, fit: "cover"
    });
    results.push({ generation, observation, decision, registration });
  }
  await fs.rm(source, { force: true });
  return results;
}
