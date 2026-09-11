import assert from "node:assert/strict";
import test from "node:test";
import {
  compareAudienceVariants,
  implicitDefaultVariant,
  reportAudienceVariantImpact,
  resolveAudienceVariant,
  validateAudienceVariantManifest
} from "../src/variants/index.js";

const base = () => ({
  project: { contract_version: "1.0", kind: "project", id: "shared-deck", title: "Shared deck", delivery_mode: "live_talk" },
  outline: { contract_version: "1.0", kind: "outline", id: "outline-main", sections: [
    { id: "opening", title: "Opening", page_ids: ["page-001", "page-002"] },
    { id: "practice", title: "Practice", page_ids: ["page-003"] }
  ] },
  pages: [
    page("page-001", 1, "Shared fact", "Explain the common decision"),
    page("page-002", 2, "Evidence", "Show the common evidence"),
    page("page-003", 3, "Exercise", "Guide a workshop exercise")
  ]
});

const executive = () => ({
  id: "executive", title: "Executive brief", audience: "executive sponsor", purpose: "approve the decision",
  expected_duration_seconds: 300, delivery_mode: "pitch", base: { project_id: "shared-deck", revision: "version-001" },
  page_ids: ["page-001", "page-002"],
  page_overrides: [{ page_id: "page-001", patch: { screen_text: { title: "Decision required" } } }],
  section_overrides: [{ section_id: "opening", title: "Decision" }]
});

const workshop = () => ({
  id: "workshop", title: "Workshop", audience: "delivery team", purpose: "practice the workflow",
  expected_duration_seconds: 2700, delivery_mode: "workshop", base: { project_id: "shared-deck", revision: "version-001" },
  page_ids: ["page-001", "page-002", "page-003"], page_overrides: [], section_overrides: []
});

test("resolves sparse executive and workshop variants without copying or mutating the base", () => {
  const source = base();
  const before = structuredClone(source);
  const short = resolveAudienceVariant(source, executive());
  const long = resolveAudienceVariant(source, workshop());
  assert.deepEqual(short.pages.map(({ id, page: number }) => [id, number]), [["page-001", 1], ["page-002", 2]]);
  assert.equal(short.pages[0].screen_text.title, "Decision required");
  assert.equal(short.outline.sections[0].title, "Decision");
  assert.equal(short.project.delivery_mode, "pitch");
  assert.deepEqual(short.inheritance, {
    variant_id: "executive", base_project_id: "shared-deck", base_revision: "version-001",
    inherited_page_ids: ["page-002"], overridden_page_ids: ["page-001"]
  });
  assert.equal(long.pages[0].screen_text.title, "Shared fact");
  assert.deepEqual(source, before);
  assert.equal(short.unchanged_base, true);
});

test("rejects missing pages, duplicate ids, and identity-changing overrides", () => {
  const source = base();
  const invalid = executive();
  invalid.page_ids.push("missing-page");
  invalid.page_overrides.push({ page_id: "page-002", patch: { id: "replaced" } });
  const errors = validateAudienceVariantManifest({ schema_version: "1.0", variants: [invalid, { ...workshop(), id: "executive" }] }, source);
  assert.ok(errors.some((error) => error.includes("missing-page")));
  assert.ok(errors.some((error) => error.includes("cannot change id")));
  assert.ok(errors.some((error) => error.includes("duplicated: executive")));
});

test("reports shared changes without mutating accepted or frozen variants", () => {
  const before = base();
  const after = base();
  after.pages[0].three_second_message = "Corrected shared fact";
  after.pages[2].three_second_message = "Corrected exercise";
  const manifest = { schema_version: "1.0", variants: [executive(), workshop()] };
  const impact = reportAudienceVariantImpact(before, after, manifest, { frozen_variant_ids: ["executive"] });
  assert.deepEqual(impact.changed_page_ids, ["page-001", "page-003"]);
  assert.equal(impact.variants[0].variant_id, "executive");
  assert.deepEqual(impact.variants[0].affected_page_ids, ["page-001"]);
  assert.deepEqual(impact.variants[0].inherited_page_ids, ["page-001"]);
  assert.deepEqual(impact.variants[0].overridden_page_ids, ["page-001"]);
  assert.deepEqual(impact.variants[0].page_impacts, [{
    page_id: "page-001",
    changed_fields: ["three_second_message"],
    override_fields: ["screen_text"],
    inherited_changed_fields: ["three_second_message"],
    overridden_changed_fields: []
  }]);
  assert.equal(impact.variants[0].stale_frozen_output, true);
  assert.equal(impact.variants[0].requires_explicit_adoption, true);
  assert.deepEqual(impact.variants[1].inherited_page_ids, ["page-001", "page-003"]);
  assert.equal(before.pages[0].three_second_message, "Explain the common decision");
});

test("compares variants and supplies backward-compatible implicit default behavior", () => {
  const source = base();
  const comparison = compareAudienceVariants(source, executive(), workshop());
  assert.deepEqual(comparison.added_page_ids, ["page-003"]);
  assert.deepEqual(comparison.removed_page_ids, []);
  assert.deepEqual(comparison.changed_page_ids, ["page-001"]);
  assert.deepEqual(implicitDefaultVariant(source).page_ids, ["page-001", "page-002", "page-003"]);
});

function page(id, number, title, message) {
  return {
    contract_version: "1.0", kind: "page_spec", id, page: number, task: message, three_second_message: message,
    relation: "hero", screen_text: { title }, visual_job: "focus", source_refs: [], asset_slots: [], content_status: "approved", renderers: { html: {}, pptx: {} }
  };
}
