import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateV1Entity } from "../contracts/v1.js";
import { buildHtml } from "../adapters/html.js";
import { buildPptx } from "../adapters/pptx.js";
import { compileProjectLayout, compilePageLayout } from "../layout/catalog.js";
import { indexDesignSystemPack, resolveDesignSystemResource } from "../templates/design-system-pack.js";

export function inspectDesignSystemPack(project) {
  const findings = [];
  const pack = project.designSystemPack;
  if (!pack) {
    for (const page of project.pages.filter((page) => page.design_system_layout_id !== undefined)) {
      findings.push({ severity: "error", code: "DESIGN_PACK_REQUIRED", page: page.page, page_id: page.id, layout_id: page.design_system_layout_id, detail: "Selected layout requires a design system pack" });
    }
    return findings.length ? report(project, findings) : { status: "not_applicable", findings, metrics: { pages: project.pages.length, selected: 0 } };
  }
  if (pack.migration?.requires_review) findings.push({ severity: "warning", code: "DESIGN_PACK_MIGRATION_REVIEW_REQUIRED", pack_id: pack.id, source_template_id: pack.migration.source_template_id });
  let index;
  try { index = indexDesignSystemPack(pack); }
  catch (error) { findings.push({ severity: "error", code: error.code ?? "DESIGN_PACK_INVALID", detail: error.message }); return report(project, findings); }
  for (const page of project.pages) {
    if (page.design_system_layout_id === undefined) continue;
    try {
      const layout = resolveDesignSystemResource(index, page.design_system_layout_id, "layout");
      for (const id of layout.component_ids ?? []) resolveDesignSystemResource(index, id, "component");
      for (const id of layout.asset_ids ?? []) resolveDesignSystemResource(index, id, "asset");
      compilePageLayout(page, project.theme, { assets: project.assets, designSystemPack: pack, projectThemeOverride: project.project.theme_override });
    } catch (error) {
      findings.push({ severity: "error", code: error.code ?? "DESIGN_PACK_SELECTION_INVALID", page: page.page, page_id: page.id, layout_id: page.design_system_layout_id, detail: error.message });
    }
  }
  return report(project, findings);
}

// Builds both independent outputs; these machine checks never imply a real
// PowerPoint observation or a human visual decision.
export async function validateDesignSystemCase({ pack, pages, root, theme, project, acceptance = {} }) {
  const gates = { powerpoint: acceptance.powerpoint === "accepted" ? "accepted" : "pending", human_visual_review: acceptance.human_visual_review === "accepted" ? "accepted" : "pending" };
  const automated = { passed: false, semantic_layouts: 0, asset_types: 0, reused_resource_ids: [], renderers: { html: "pending", pptx: "pending" } };
  let directory;
  try {
    indexDesignSystemPack(pack);
    if (!Array.isArray(pages) || !pages.length) throw new Error("case needs selected pages");
    const pageIds = new Set(); const pageNumbers = new Set();
    for (const page of pages) {
      const errors = validateV1Entity(page, "page_spec");
      if (errors.length) throw new Error(errors.join("; "));
      if (pageIds.has(page.id) || pageNumbers.has(page.page)) throw new Error("case page identities must be unique");
      pageIds.add(page.id); pageNumbers.add(page.page);
      if (!page.design_system_layout_id) throw new Error("every case page needs a selected layout");
    }
    const input = { root, theme, project, pages, assets: [], designSystemPack: pack };
    const plans = compileProjectLayout(input);
    const uses = new Map(); const assetTypes = new Set();
    for (const plan of plans) {
      for (const id of new Set([...plan.design_system.component_ids, ...plan.design_system.asset_ids])) uses.set(id, (uses.get(id) ?? 0) + 1);
      for (const asset of plan.design_resources.assets) assetTypes.add(asset.type);
    }
    automated.semantic_layouts = new Set(plans.map(plan => plan.relation)).size;
    automated.asset_types = assetTypes.size;
    automated.reused_resource_ids = [...uses].filter(([, count]) => count > 1).map(([id]) => id).sort();
    if (automated.semantic_layouts < 6 || assetTypes.size < 3 || !automated.reused_resource_ids.length) throw new Error("case needs six selected semantic layouts, three used asset types and cross-page reuse");
    await buildHtml(input);
    automated.renderers.html = "passed";
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-case-"));
    await buildPptx(input, path.join(directory, "case.pptx"));
    automated.renderers.pptx = "passed";
    automated.passed = true;
    return { status: gates.powerpoint === "accepted" && gates.human_visual_review === "accepted" ? "accepted" : "automated_passed_human_pending", automated, gates };
  } catch (error) {
    return { status: "failed", automated, gates, findings: [{ code: error.code ?? "DESIGN_PACK_CASE_INVALID", detail: error.message }] };
  } finally {
    if (directory) await fs.rm(directory, { recursive: true, force: true });
  }
}

function report(project, findings) {
  return { status: findings.some(({ severity }) => severity === "error") ? "failed" : findings.length ? "review_required" : "passed", findings, metrics: { pages: project.pages.length, selected: project.pages.filter(({ design_system_layout_id }) => design_system_layout_id !== undefined).length } };
}
