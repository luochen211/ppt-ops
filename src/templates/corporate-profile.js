import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { CorporateTemplateIntake, detectCorporateTemplateConflicts } from "./corporate-intake.js";
import { resolveProjectPath } from "../core/project.js";
import { renderCorporateReference } from "./corporate-preview.js";
import { TEMPLATE_CATALOG } from "../layout/catalog.js";

const COLORS = new Set(["colors.background", "colors.text", "colors.accent"]);
const FONTS = new Set(["typography.heading_font", "typography.body_font"]);
export const corporateRevision = value => crypto.createHash("sha256").update(stableJson(value)).digest("hex");
const fileHash = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const failure = (code, message) => Object.assign(new Error(message), { code });

export async function manageCorporateProfile(service, action, input = {}) {
  const intake = new CorporateTemplateIntake({ projectRoot: service.project.root });
  if (action === "import") return intake.importFile(input.file);
  if (action === "preview") { const item = await verifiedInspection(service.project.root, input.inspection_file); return renderCorporateReference(service, item); }
  if (action === "status") return { project_revision: corporateRevision(service.project.contracts.project), active: service.project.contracts.project.corporate_profile ?? null };
  if (action === "compare" || action === "accept") {
    const files = input.inspection_files;
    if (!Array.isArray(files) || !files.length || new Set(files).size !== files.length) throw failure("CORPORATE_INSPECTIONS_REQUIRED", "select unique inspection files");
    const inspections = await Promise.all(files.map(file => verifiedInspection(service.project.root, file)));
    const conflicts = detectCorporateTemplateConflicts(inspections.map(item => item.profile));
    if (action === "compare") return { inspections, conflicts };
    userDecision(input);
    for (const item of inspections) if (input.inspection_revisions?.[item.file] !== item.sha256) throw failure("CORPORATE_INSPECTION_STALE", "review the exact inspection revision before accepting");
    for (const conflict of conflicts) {
      const winner = input.precedence?.[conflict.field];
      if (!conflict.values.some(value => value.profile_id === winner)) throw failure("CORPORATE_PRECEDENCE_REQUIRED", `choose the source for conflicting ${conflict.field}`);
    }
    const tokens = {}, selections = [];
    for (const choice of input.selections ?? []) {
      const item = inspections.find(item => item.file === choice.inspection_file);
      const observation = item?.profile.observations[choice.observation_index];
      if (!observation) throw failure("CORPORATE_SELECTION_INVALID", "choose a recorded observation");
      if (input.precedence?.[observation.field] && input.precedence[observation.field] !== item.profile.id) throw failure("CORPORATE_SELECTION_CONFLICT", "selected rule contradicts the recorded precedence");
      const value = choice.value_index === undefined ? observation.value : observation.value?.[choice.value_index];
      const target = choice.target;
      if (selections.some(selection => selection.target === target)) throw failure("CORPORATE_SELECTION_CONFLICT", `duplicate target: ${target}`);
      let acceptedValue = value;
      if (COLORS.has(target)) {
        if (observation.field !== "theme_colors" || typeof value !== "string" || !/^#[\da-f]{6}$/i.test(value)) throw failure("CORPORATE_RULE_UNSUPPORTED", "select a six-digit theme color; other color expressions require a reviewed normalized observation");
      } else if (FONTS.has(target)) {
        if (!["theme_fonts", "font_names"].includes(observation.field) || typeof value !== "string" || !value.trim() || /[<>;{}]/.test(value)) throw failure("CORPORATE_RULE_UNSUPPORTED", "select a recorded font family");
      } else if (target === "dimensions") {
        if (!["slide_dimensions", "page_dimensions"].includes(observation.field)) throw failure("CORPORATE_RULE_UNSUPPORTED", "select recorded slide/page dimensions");
        const unit = { in: 1, px: 96, pt: 72 }[value?.unit];
        const width = value?.width ?? value?.x2 - value?.x1, height = value?.height ?? value?.y2 - value?.y1;
        if (!unit || !(width > 0 && height > 0) || Math.abs(width / height - 16 / 9) > .01) throw failure("CORPORATE_DIMENSIONS_UNSUPPORTED", "this renderer supports 16:9 corporate dimensions only");
        acceptedValue = { width: width / unit, height: height / unit };
      } else throw failure("CORPORATE_RULE_UNSUPPORTED", `unsupported design rule: ${target}`);
      if (target === "dimensions") tokens.dimensions = acceptedValue;
      else { const [group, key] = target.split("."); (tokens[group] ??= {})[key] = acceptedValue; }
      selections.push({ ...choice, value: acceptedValue, evidence_type: observation.evidence_type, locators: observation.locators, source_sha256: item.profile.source.sha256 });
    }
    const layouts = [];
    for (const mapping of input.layout_mappings ?? []) {
      const item = inspections.find(item => item.file === mapping.inspection_file);
      const native = item?.profile.layouts.find(layout => layout.id === mapping.layout_id);
      const pageCount = item?.profile.observations.find(value => value.field === "page_count")?.value;
      const reference = Number.isInteger(mapping.reference_page) && mapping.reference_page > 0 && mapping.reference_page <= pageCount;
      const template = TEMPLATE_CATALOG.find(template => template.name === mapping.semantic_family);
      if (!item || (!native && !reference) || !template || !Array.isArray(mapping.page_ids) || !mapping.page_ids.length) throw failure("CORPORATE_LAYOUT_INVALID", "choose an inspected layout or reference page, semantic family, and target pages");
      for (const id of mapping.page_ids) {
        const page = service.project.contracts.pages.find(page => page.id === id);
        if (!page || !template.relations.includes(page.relation) || layouts.some(layout => layout.page_ids.includes(id))) throw failure("CORPORATE_LAYOUT_INVALID", "each selected page must match one compatible semantic family");
      }
      layouts.push({ ...mapping, template_id: template.id, evidence_type: "inferred", locator: native?.locator ?? `/reference/page/${mapping.reference_page}`, source_sha256: item.profile.source.sha256 });
    }
    if (!selections.length && !layouts.length) throw failure("CORPORATE_SELECTION_REQUIRED", "select at least one design rule or layout");
    const limitations = [...new Set(inspections.flatMap(item => item.profile.limitations)), "Semantic layouts use editable PPT-Ops objects; arbitrary masters, logos and active features are not copied.", "Font availability and substitution require inspection on the delivery computer."];
    const accepted = { schema_version: "1.0", kind: "accepted_corporate_profile", state: "accepted", inspections, conflicts, precedence: input.precedence ?? {}, tokens, selections, layout_mappings: layouts, limitations, findings: [...inspections.flatMap(item => item.profile.findings), ...selections.filter(item => FONTS.has(item.target)).map(item => ({ code: "font_availability_unverified", severity: "warning", font: item.value, message: "Check font installation and substitution on the delivery computer." }))],
      evidence: { rendered_comparison: "pending", real_powerpoint: "pending", user_brand_acceptance: "recorded" },
      decision: { actor: input.actor, raw_feedback: input.raw_feedback, at: new Date().toISOString() } };
    const sha256 = corporateRevision(accepted);
    const file = `.pptops/templates/corporate/accepted/${sha256}.json`;
    await service.files.writeImmutable(file, JSON.stringify(accepted, null, 2) + "\n");
    return { file, sha256, profile: accepted };
  }
  if (action === "apply") {
    userDecision(input);
    await service.refresh();
    const contract = service.project.contracts.project;
    if (input.expected_revision !== corporateRevision(contract)) throw failure("CORPORATE_PROJECT_STALE", "project changed since the profile decision");
    const binding = { file: input.file, sha256: input.sha256 };
    await readAccepted(service.project.root, binding);
    const decision = { binding, actor: input.actor, raw_feedback: input.raw_feedback, project_revision: input.expected_revision, at: new Date().toISOString() };
    const decisionFile = `.pptops/templates/corporate/decisions/${corporateRevision(decision)}.json`;
    await service.files.writeImmutable(decisionFile, JSON.stringify(decision, null, 2) + "\n");
    const file = path.join(service.project.root, "project.json"), temporary = `${file}.tmp-${crypto.randomUUID()}`;
    // Single pointer update; source facts, pages and base theme remain unchanged.
    try { await fs.writeFile(temporary, JSON.stringify({ ...contract, corporate_profile: { ...binding, decision_file: decisionFile } }, null, 2) + "\n", { flag: "wx" }); await fs.rename(temporary, file); }
    finally { await fs.rm(temporary, { force: true }); }
    await service.refresh();
    return { active: service.project.contracts.project.corporate_profile, project_revision: corporateRevision(service.project.contracts.project) };
  }
  throw failure("CORPORATE_ACTION_INVALID", `unknown corporate profile action: ${action}`);
}

export async function materializeCorporateProfile(root, snapshot) {
  const binding = snapshot["project.json"]?.corporate_profile;
  if (!binding) return snapshot;
  const accepted = snapshot["corporate-profile.json"] ?? await readAccepted(root, binding);
  if (corporateRevision(accepted) !== binding.sha256 || accepted.state !== "accepted") throw failure("CORPORATE_PROFILE_CHANGED", "accepted profile no longer matches its recorded revision");
  if (snapshot["corporate-profile.json"]) return snapshot;
  const result = structuredClone(snapshot);
  result["corporate-profile.json"] = accepted;
  const theme = result["theme.json"].tokens;
  for (const [group, values] of Object.entries(accepted.tokens)) theme[group] = { ...theme[group], ...values };
  for (const mapping of accepted.layout_mappings) for (const id of mapping.page_ids) {
    const page = result["pages.json"].find(page => page.id === id);
    if (page) {
      const template = TEMPLATE_CATALOG.find(template => template.id === mapping.template_id);
      if (!template?.relations.includes(page.relation)) throw failure("CORPORATE_LAYOUT_STALE", `page ${id} no longer supports the accepted layout`);
      page.template_id = mapping.template_id;
    }
  }
  return result;
}

async function readAccepted(root, binding) {
  if (!binding?.file?.startsWith(".pptops/templates/corporate/accepted/") || !/^[a-f0-9]{64}$/.test(binding.sha256 ?? "")) throw failure("CORPORATE_PROFILE_INVALID", "select an accepted profile identity");
  const accepted = JSON.parse(await fs.readFile(resolveProjectPath(root, binding.file), "utf8"));
  if (corporateRevision(accepted) !== binding.sha256 || accepted.state !== "accepted") throw failure("CORPORATE_PROFILE_CHANGED", "accepted profile revision changed");
  userDecision(accepted.decision ?? {});
  for (const item of accepted.inspections) { const current = await verifiedInspection(root, item.file); if (current.sha256 !== item.sha256) throw failure("CORPORATE_INSPECTION_STALE", "accepted inspection changed"); }
  return accepted;
}
async function verifiedInspection(root, file) {
  if (typeof file !== "string" || !/^\.pptops\/templates\/corporate\/(pptx|potx|html|pdf)\/[a-f0-9]{64}\/inspection\.json$/.test(file)) throw failure("CORPORATE_INSPECTION_INVALID", "select a stored inspection file");
  const bytes = await fs.readFile(resolveProjectPath(root, file));
  const profile = JSON.parse(bytes);
  if (profile.state !== "proposed" || path.posix.dirname(profile.source?.file ?? "") !== path.posix.dirname(file)) throw failure("CORPORATE_INSPECTION_INVALID", "inspection is not a proposed immutable source");
  const source = await fs.readFile(resolveProjectPath(root, profile.source.file));
  if (fileHash(source) !== profile.source.sha256) throw failure("CORPORATE_SOURCE_CHANGED", "corporate source no longer matches its hash");
  return { file, sha256: fileHash(bytes), profile };
}
function userDecision(input) { if (!/^user(?::[^\s]+)?$/.test(input.actor ?? "") || typeof input.raw_feedback !== "string" || !input.raw_feedback.trim()) throw failure("CORPORATE_USER_REQUIRED", "an explicit supplied user decision is required"); }

function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
