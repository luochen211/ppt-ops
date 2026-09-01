const baseCapacity = { title_chars: 90, message_chars: 180, body_items: 6, body_item_chars: 180, total_body_chars: 720, asset_slots: 2 };

export const TEMPLATE_CATALOG = Object.freeze([
  template("hero", ["hero"], { body_items: 3, asset_slots: 1 }, "hero"),
  template("statement", ["parallel"], { body_items: 4, asset_slots: 1 }, "statement"),
  template("comparison", ["comparison", "before_after"], { body_items: 4, asset_slots: 2 }, "two-column"),
  template("sequence", ["sequence"], { body_items: 6, asset_slots: 1 }, "horizontal-flow"),
  template("process", ["process"], { body_items: 6, asset_slots: 1 }, "stepped-flow"),
  template("hierarchy", ["hierarchy"], { body_items: 6, asset_slots: 1 }, "tree"),
  template("data", ["cause_effect"], { body_items: 5, asset_slots: 2 }, "evidence"),
  template("cycle", ["cycle"], { body_items: 6, asset_slots: 1 }, "radial")
]);

const byId = new Map(TEMPLATE_CATALOG.map((entry) => [entry.id, entry]));

export class LayoutCapacityError extends Error {
  constructor(pageId, violations) { super(`page ${pageId} exceeds template capacity:\n${violations.map((item) => `- ${item}`).join("\n")}`); this.code = "LAYOUT_CAPACITY_EXCEEDED"; this.violations = violations; }
}

export function compileProjectLayout(project) {
  return project.pages.map((page) => compilePageLayout(page, project.theme, { projectThemeOverride: project.project.theme_override, assets: project.assets }));
}

export function compilePageLayout(page, theme, options = {}) {
  const templateId = options.templateId ?? page.template_id ?? templateForRelation(page.relation).id;
  const selected = byId.get(templateId);
  if (!selected) throw new Error(`unknown template: ${templateId}`);
  if (!selected.relations.includes(page.relation) && options.allowRelationOverride !== true) throw new Error(`template ${templateId} does not support relation ${page.relation}`);
  const violations = capacityViolations(page, selected.capacity);
  if (violations.length) throw new LayoutCapacityError(page.id ?? page.page, violations);
  const resolvedTheme = resolveTheme(theme, options.projectThemeOverride, page.theme_override);
  const width = resolvedTheme.dimensions.width; const height = resolvedTheme.dimensions.height; const margin = resolvedTheme.spacing.page_margin;
  return Object.freeze({
    version: "1", page: page.page, template_id: selected.id, relation: page.relation,
    renderer: selected.renderers, capacity: selected.capacity,
    theme: resolvedTheme, asset_checks: Object.freeze(inspectAssets(page.asset_slots ?? [], options.assets ?? [])),
    content: Object.freeze({ title: page.screen_text.title, subtitle: page.screen_text.subtitle ?? "", message: page.three_second_message, body: Object.freeze([...(page.screen_text.body ?? [])]), assets: Object.freeze([...(page.asset_slots ?? [])]) }),
    geometry: Object.freeze({
      canvas: rect(0, 0, width, height),
      title: rect(margin + 0.28, margin - 0.02, width - margin * 2 - 0.28, 0.82),
      content: rect(margin, 1.72, width - margin * 2, height - 1.72 - margin - 0.58),
      footer: rect(margin, height - margin - 0.2, width - margin * 2, 0.2)
    })
  });
}

export function templateForRelation(relation) {
  const selected = TEMPLATE_CATALOG.find((entry) => entry.relations.includes(relation));
  if (!selected) throw new Error(`no template supports relation: ${relation}`);
  return selected;
}

export function resolveTheme(base, projectOverride = {}, pageOverride = {}) {
  const merged = mergeTheme(mergeTheme(base, projectOverride), pageOverride);
  if (!(merged.dimensions?.width > 0 && merged.dimensions?.height > 0)) throw new Error("resolved theme dimensions must be positive");
  return Object.freeze(merged);
}

function template(id, relations, capacity, mapping) {
  return Object.freeze({ contract_version: "1.0", kind: "template", id: `template-${id}`, name: id, relations: Object.freeze(relations), capacity: Object.freeze({ ...baseCapacity, ...capacity }), slots: Object.freeze({ title: "text", message: "text", body: "text[]", assets: "asset[]" }), renderers: Object.freeze({ html: `layout-${mapping}`, pptx: `layout-${mapping}` }) });
}
function capacityViolations(page, capacity) {
  const body = page.screen_text.body ?? []; const violations = [];
  if (page.screen_text.title.length > capacity.title_chars) violations.push(`title has ${page.screen_text.title.length} chars; max ${capacity.title_chars}`);
  if (page.three_second_message.length > capacity.message_chars) violations.push(`message has ${page.three_second_message.length} chars; max ${capacity.message_chars}`);
  if (body.length > capacity.body_items) violations.push(`body has ${body.length} items; max ${capacity.body_items}`);
  body.forEach((line, index) => { if (line.length > capacity.body_item_chars) violations.push(`body[${index}] has ${line.length} chars; max ${capacity.body_item_chars}`); });
  const total = body.reduce((sum, line) => sum + line.length, 0); if (total > capacity.total_body_chars) violations.push(`body has ${total} chars total; max ${capacity.total_body_chars}`);
  if ((page.asset_slots ?? []).length > capacity.asset_slots) violations.push(`assets has ${page.asset_slots.length} items; max ${capacity.asset_slots}`);
  return violations;
}
function inspectAssets(slots, assets) {
  const byId = new Map(assets.map((asset) => [asset.id, asset]));
  return slots.map((slot) => {
    const asset = byId.get(slot.asset_id);
    if (!asset) return Object.freeze({ asset_id: slot.asset_id, status: "missing" });
    if (!(asset.width > 0 && asset.height > 0)) return Object.freeze({ asset_id: slot.asset_id, status: "dimensions_pending", fit: slot.fit ?? "contain" });
    const ratio = Number((asset.width / asset.height).toFixed(4));
    return Object.freeze({ asset_id: slot.asset_id, status: "checked", ratio, fit: slot.fit ?? "contain", crop: (slot.fit ?? "contain") === "cover" ? "center" : "none" });
  });
}
function mergeTheme(base, override = {}) { return { ...base, ...override, dimensions: { ...base.dimensions, ...override.dimensions }, typography: { ...base.typography, ...override.typography }, colors: { ...base.colors, ...override.colors }, spacing: { ...base.spacing, ...override.spacing } }; }
function rect(x, y, w, h) { return Object.freeze({ x, y, w, h }); }
