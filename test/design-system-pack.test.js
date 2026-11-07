import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import { migrateLegacyTemplate, normalizeDesignSystemPack } from "../src/templates/design-system-pack.js";

test("normalizes the versioned Design System Pack contract", () => {
  const pack = normalizeDesignSystemPack({ kind: "design_system_pack", id: "design-pack-blue", name: "Blue", tokens: { colors: {}, typography: {}, spacing: {} }, components: [], layouts: [], assets: [] });
  assert.equal(pack.contract_version, "1.0");
  assert.equal(pack.kind, "design_system_pack");
});

test("migrates a legacy reference without claiming a complete system", () => {
  const pack = migrateLegacyTemplate({ id: "legacy-blue", name: "Legacy Blue", reference_image: "references/blue.png" });
  assert.equal(pack.assets[0].type, "reference");
  assert.deepEqual(pack.layouts, []);
  assert.deepEqual(pack.migration, { status: "legacy-reference-only", source_template_id: "legacy-blue", requires_review: true });
});

test("rejects incomplete packs explicitly", () => {
  assert.throws(() => normalizeDesignSystemPack({ kind: "design_system_pack", id: "x", name: "X", tokens: {}, components: [], layouts: [], assets: [] }), (error) => error.code === "DESIGN_PACK_INVALID");
});

// Validate persisted documents independently of the normalizer as well: schema
// consumers must enforce the same boundary without relying on normalization.
const schema = JSON.parse(readFileSync(new URL("../schemas/v1/design-system-pack.schema.json", import.meta.url), "utf8"));
const validateDocument = new Ajv2020({ allErrors: true }).compile(schema);

function completePack() {
  return {
    contract_version: "1.0", kind: "design_system_pack", id: "design-pack-blue", name: "Blue",
    tokens: { colors: { background: "#000080" }, typography: { heading: "Arial" }, spacing: { page_margin: 0.4 } },
    components: [{ id: "title", capacity: { title_chars: 90 }, renderers: { html: "html-title", pptx: "pptx-title" } }],
    layouts: [{ id: "cover", capacity: { body_items: 0, asset_slots: 1 }, renderers: { html: "html-cover", pptx: "pptx-cover" } }],
    assets: [{ id: "reference", type: "reference", source: "references/blue.png" }],
    relationships: [{ from: "cover", to: "title", relation: "uses" }]
  };
}

test("preserves independent mappings, capacity units and detached data", () => {
  const input = completePack();
  assert.equal(validateDocument(input), true);
  const normalized = normalizeDesignSystemPack(input);
  assert.deepEqual(normalized, input);
  normalized.layouts[0].capacity.body_items = 3;
  assert.equal(input.layouts[0].capacity.body_items, 0);
  assert.notEqual(normalized.layouts[0].renderers.html, normalized.layouts[0].renderers.pptx);
  assert.equal(validateDocument(migrateLegacyTemplate({ id: "old", name: "Old", reference: "old.png" })), true);
});

test("defaults only an absent version and rejects explicit unsupported or invalid versions", () => {
  const input = completePack();
  delete input.contract_version;
  assert.equal(validateDocument(input), false); // Persisted documents require a version.
  assert.equal(validateDocument(normalizeDesignSystemPack(input)), true);
  for (const version of ["9.0", "1.1", "", null, undefined, 1, {}, []]) {
    const invalid = { ...completePack(), contract_version: version };
    assert.equal(validateDocument(invalid), false);
    assert.throws(() => normalizeDesignSystemPack(invalid), { code: "DESIGN_PACK_INVALID" });
  }
});

const malformed = [
  ["missing resource ID", { components: [{}] }],
  ["null layout", { layouts: [null] }],
  ["non-object asset", { assets: ["reference"] }],
  ["unstable ID", { components: [{ id: "Bad ID" }] }],
  ["blank pack name", { name: "   " }],
  ["missing asset type", { assets: [{ id: "a" }] }],
  ["null asset type", { assets: [{ id: "a", type: null }] }],
  ["blank asset source", { assets: [{ id: "a", type: "reference", source: " " }] }],
  ["array tokens", { tokens: [] }],
  ["array token group", { tokens: { colors: [], typography: {}, spacing: {} } }],
  ["null token group", { tokens: { colors: {}, typography: null, spacing: {} } }],
  ["non-array relationships", { relationships: "broken" }],
  ["missing relationship end", { relationships: [{ from: "cover", relation: "uses" }] }],
  ["invalid relationship values", { relationships: [{ from: [], to: null, relation: 42 }] }],
  ["blank relationship", { relationships: [{ from: "cover", to: "title", relation: " " }] }],
  ["unstructured capacity", { layouts: [{ id: "cover", capacity: "unlimited" }] }],
  ["negative capacity", { components: [{ id: "title", capacity: { title_chars: -1 } }] }],
  ["fractional capacity", { layouts: [{ id: "cover", capacity: { body_items: 1.5 } }] }],
  ["string capacity", { layouts: [{ id: "cover", capacity: { asset_slots: "2" } }] }],
  ["unknown capacity unit", { layouts: [{ id: "cover", capacity: { items: 2 } }] }],
  ["empty capacity", { layouts: [{ id: "cover", capacity: {} }] }],
  ["unstructured renderers", { layouts: [{ id: "cover", renderers: 123 }] }],
  ["missing independent renderer", { layouts: [{ id: "cover", renderers: { html: "html-cover" } }] }],
  ["invalid renderer mapping", { layouts: [{ id: "cover", renderers: { html: "html-cover", pptx: null } }] }],
  ["unsupported renderer", { layouts: [{ id: "cover", renderers: { html: "html-cover", pptx: "pptx-cover", pdf: "pdf-cover" } }] }]
];
for (const [label, patch] of malformed) {
  test(`rejects ${label} in both runtime and standalone schema`, () => {
    const input = { ...completePack(), ...patch };
    assert.equal(validateDocument(input), false, label);
    assert.throws(() => normalizeDesignSystemPack(input), { code: "DESIGN_PACK_INVALID" });
  });
}
