import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { assertAudienceVariantManifest, reportAudienceVariantImpact, resolveAudienceVariant } from "./index.js";

export async function readVariantState(service) {
  let manifest;
  try { manifest = JSON.parse(await fs.readFile(path.join(service.project.root, "variants.json"), "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; manifest = { schema_version: "1.0", variants: [] }; }
  if (manifest.schema_version !== "1.0" || !Array.isArray(manifest.variants)) throw failure("AUDIENCE_VARIANTS_INVALID", "invalid variant manifest");
  return { manifest, revision: digest(manifest), implicit_default: manifest.variants.length === 0 };
}

export async function manageAudienceVariants(service, action, input = {}) {
  const state = await readVariantState(service);
  if (action === "list") return state;
  if (action === "save") return saveVariant(service, input.variant, input, "save");
  if (action === "impact" && !input.variant_id) {
    const reports = await Promise.all(state.manifest.variants.filter(variant => !variant.archived).map(variant => manageAudienceVariants(service, action, { ...input, variant_id: variant.id })));
    return { proposed_base_version_id: input.base_version_id, variants: reports.flatMap(report => report.variants), source_comparisons: reports.map(report => ({ before: report.before_base_revision, after: report.after_base_revision, shared_component_changes: report.shared_component_changes })) };
  }
  const variant = state.manifest.variants.find(item => item.id === input.variant_id);
  if (!variant) throw failure("AUDIENCE_VARIANT_NOT_FOUND", `unknown audience variant: ${input.variant_id}`);
  if (action === "archive") return saveVariant(service, { ...variant, archived: true }, input, "archive");
  if (action === "rebase") return saveVariant(service, { ...variant, base: { ...variant.base, revision: input.base_version_id } }, input, "rebase");
  const before = await pinnedBase(service, variant.base.revision);
  if (action === "resolve") return resolveAudienceVariant(before.contracts, variant);
  if (action === "impact") {
    const after = await pinnedBase(service, input.base_version_id);
    const report = reportAudienceVariantImpact(before.contracts, after.contracts, { schema_version: "1.0", variants: [variant] }, {
      frozen_variant_ids: service.store.listEntities(service.projectId, "version").filter(version => version.variant?.variant_id === variant.id).map(() => variant.id)
    });
    report.before_base_revision = before.version.snapshot_hash;
    report.after_base_revision = after.version.snapshot_hash;
    report.shared_component_changes = Object.keys(before.snapshot).filter(key => digest(before.snapshot[key]) !== digest(after.snapshot[key]));
    report.variants[0].requires_explicit_adoption = report.shared_component_changes.length > 0;
    report.variants[0].stale_frozen_output = report.shared_component_changes.length > 0 && service.store.listEntities(service.projectId, "version").some(version => version.variant?.variant_id === variant.id);
    return report;
  }
  if (action === "compare") {
    const other = state.manifest.variants.find(item => item.id === input.other_variant_id);
    if (!other) throw failure("AUDIENCE_VARIANT_NOT_FOUND", `unknown audience variant: ${input.other_variant_id}`);
    const rightBase = await pinnedBase(service, other.base.revision);
    const left = resolveAudienceVariant(before.contracts, variant), right = resolveAudienceVariant(rightBase.contracts, other);
    const leftPages = new Map(left.pages.map(page => [page.id, page]));
    const rightPages = new Map(right.pages.map(page => [page.id, page]));
    return {
      left_variant_id: variant.id, right_variant_id: other.id,
      added_page_ids: right.pages.filter(page => !leftPages.has(page.id)).map(page => page.id),
      removed_page_ids: left.pages.filter(page => !rightPages.has(page.id)).map(page => page.id),
      changed_page_ids: left.pages.filter(page => rightPages.has(page.id) && digest(page) !== digest(rightPages.get(page.id))).map(page => page.id),
      left_inheritance: left.inheritance, right_inheritance: right.inheritance,
      page_diffs: left.pages.filter(page => rightPages.has(page.id)).flatMap(page => fieldDiff(page, rightPages.get(page.id)).map(diff => ({ page_id: page.id, ...diff })))
    };
  }
  throw failure("AUDIENCE_VARIANT_ACTION_INVALID", `unknown variant action: ${action}`);
}

export async function freezeAudienceVariant(service, variantId) {
  const { manifest } = await readVariantState(service);
  const variant = manifest.variants.find(item => item.id === variantId);
  if (!variant) throw failure("AUDIENCE_VARIANT_NOT_FOUND", `unknown audience variant: ${variantId}`);
  if (variant.archived) throw failure("AUDIENCE_VARIANT_ARCHIVED", "archived variants cannot create new outputs");
  const base = await pinnedBase(service, variant.base.revision);
  const overrideRevision = digest(variant);
  const decisionFile = path.join(".pptops", "variant-decisions", `${overrideRevision}.json`);
  let decision;
  try { decision = JSON.parse(await fs.readFile(path.join(service.project.root, decisionFile), "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; throw failure("AUDIENCE_VARIANT_NOT_ACCEPTED", "save the exact variant with an explicit user decision before freezing"); }
  if (decision.variant_revision !== overrideRevision || decision.base_revision !== base.version.snapshot_hash || !isUser(decision.actor) || !decision.raw_feedback?.trim()) throw failure("AUDIENCE_VARIANT_NOT_ACCEPTED", "variant acceptance does not match the selected source");
  const resolved = resolveAudienceVariant(base.contracts, variant);
  const identity = { variant_id: variant.id, base_version_id: base.version.id, base_revision: base.version.snapshot_hash, override_revision: overrideRevision, decision_file: decisionFile };
  const snapshot = { ...structuredClone(base.snapshot), "project.json": resolved.project, "outline.json": resolved.outline, "pages.json": resolved.pages, "variant.json": { identity, definition: variant } };
  return service.freezeSnapshot(snapshot, { variant: identity });
}

async function saveVariant(service, variant, input, action) {
  if (!isUser(input.actor) || typeof input.raw_feedback !== "string" || !input.raw_feedback.trim()) throw failure("AUDIENCE_VARIANT_USER_REQUIRED", "a supplied user decision is required");
  const base = await pinnedBase(service, variant?.base?.revision);
  assertAudienceVariantManifest({ schema_version: "1.0", variants: [variant] }, base.contracts);
  const lockFile = path.join(service.project.root, ".pptops", "variant-write.lock");
  const lock = await fs.open(lockFile, "wx").catch(error => { if (error.code === "EEXIST") throw failure("AUDIENCE_VARIANT_BUSY", "another variant edit is in progress"); throw error; });
  const temporary = path.join(service.project.root, `variants.json.tmp-${crypto.randomUUID()}`);
  try {
    const state = await readVariantState(service);
    if (input.expected_revision !== state.revision) throw failure("AUDIENCE_VARIANT_STALE", "variant manifest changed; inspect the latest revision before deciding");
    const previous = state.manifest.variants.find(item => item.id === variant.id);
    const next = { ...state.manifest, variants: [...state.manifest.variants.filter(item => item.id !== variant.id), structuredClone(variant)].sort((a, b) => a.id.localeCompare(b.id)) };
    const revision = digest(variant);
    const decisionPath = path.join(".pptops", "variant-decisions", `${revision}.json`);
    const decision = { schema_version: "1.0", action, actor: input.actor, raw_feedback: input.raw_feedback, decided_at: new Date().toISOString(), variant_revision: revision, base_revision: base.version.snapshot_hash, previous_variant_revision: previous ? digest(previous) : null };
    try { await service.files.writeImmutable(decisionPath, JSON.stringify(decision, null, 2) + "\n"); }
    catch (error) {
      if (!error.message.startsWith("immutable file already exists:")) throw error;
      const existing = JSON.parse(await fs.readFile(path.join(service.project.root, decisionPath), "utf8"));
      if (existing.variant_revision !== revision || existing.base_revision !== decision.base_revision) throw failure("AUDIENCE_VARIANT_NOT_ACCEPTED", "stored decision conflicts with this variant");
    }
    await fs.writeFile(temporary, JSON.stringify(next, null, 2) + "\n", { flag: "wx" });
    await fs.rename(temporary, path.join(service.project.root, "variants.json"));
    return { manifest: next, revision: digest(next), variant_revision: revision, decision_file: decisionPath, action };
  } finally { await lock.close(); await fs.rm(lockFile, { force: true }); await fs.rm(temporary, { force: true }); }
}

async function pinnedBase(service, versionId) {
  const version = service.requireEntity("version", versionId);
  if (version.state !== "frozen" || version.variant) throw failure("AUDIENCE_VARIANT_BASE_INVALID", "a variant must reference a frozen shared-base Version");
  const snapshot = await service.files.readVersionSnapshot(versionId);
  if (digest(snapshot) !== version.snapshot_hash) throw failure("AUDIENCE_VARIANT_BASE_CHANGED", "the frozen base snapshot no longer matches its hash");
  const contracts = service.projectFromSnapshot(snapshot).contracts;
  return { version, snapshot, contracts };
}

function fieldDiff(left, right, prefix = "") {
  if (digest(left) === digest(right)) return [];
  if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) || Array.isArray(right)) return [{ field: prefix, before: left, after: right }];
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap(key => fieldDiff(left[key], right[key], prefix ? `${prefix}.${key}` : key));
}
function isUser(actor) { return typeof actor === "string" && /^user(?::[^\s]+)?$/.test(actor); }
function digest(value) { return crypto.createHash("sha256").update(stableJson(value) ?? "undefined").digest("hex"); }
function stableJson(value) { if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`; if (value && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`; return JSON.stringify(value); }
function failure(code, message) { return Object.assign(new Error(message), { code }); }
