import { compilePageLayout } from "../layout/catalog.js";
import { indexDesignSystemPack, resolveDesignSystemResource } from "../templates/design-system-pack.js";

export function inspectDesignSystemPack(project) {
  const findings = [];
  const pack = project.designSystemPack;
  if (!pack) return { status: "not_applicable", findings, metrics: { pages: project.pages.length, selected: 0 } };
  if (pack.migration?.requires_review) findings.push({ severity: "warning", code: "DESIGN_PACK_MIGRATION_REVIEW_REQUIRED", pack_id: pack.id, source_template_id: pack.migration.source_template_id });
  let index;
  try { index = indexDesignSystemPack(pack); }
  catch (error) { findings.push({ severity: "error", code: error.code ?? "DESIGN_PACK_INVALID", detail: error.message }); return report(project, findings); }
  for (const page of project.pages) {
    if (!page.design_system_layout_id) continue;
    try {
      const layout = resolveDesignSystemResource(index, page.design_system_layout_id, "layout");
      for (const id of [...(layout.component_ids ?? []), ...(layout.asset_ids ?? [])]) resolveDesignSystemResource(index, id);
      compilePageLayout(page, project.theme, { assets: project.assets, designSystemPack: pack, projectThemeOverride: project.project.theme_override });
    } catch (error) {
      findings.push({ severity: "error", code: error.code ?? "DESIGN_PACK_SELECTION_INVALID", page: page.page, page_id: page.id, layout_id: page.design_system_layout_id, detail: error.message });
    }
  }
  return report(project, findings);
}

function report(project, findings) {
  return { status: findings.some(({ severity }) => severity === "error") ? "failed" : findings.length ? "review_required" : "passed", findings, metrics: { pages: project.pages.length, selected: project.pages.filter(({ design_system_layout_id }) => design_system_layout_id).length } };
}

