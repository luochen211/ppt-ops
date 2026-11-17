import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { bindVisualRepairEvidence, createVisualFailureRecord, VISUAL_FAILURE_CATEGORIES } from "../src/qa/visual-regression.js";

const base = { id: "failure-001", raw_feedback: "The label is too quiet.", target: { page_id: "page-002", element_id: "label-risk", bounds: { x: 1, y: 2, width: 3, height: 1 } }, version: { id: "version-001", revision: "rev-a" }, evidence: { screenshot_sha256: "a".repeat(64), locator: "page-2.png" }, classification: { category: "hierarchy", confidence: 0.8 } };

test("Stage 1 records raw feedback separately from inferred visual classification", () => {
  const record = createVisualFailureRecord(base);
  assert.equal(record.raw_feedback, base.raw_feedback);
  assert.deepEqual(record.classification, { category: "hierarchy", confidence: 0.8, source: "system_inference" });
  assert.equal(record.rule_activation, "none");
  assert.deepEqual(VISUAL_FAILURE_CATEGORIES, ["layout", "hierarchy", "alignment", "clarity", "imagery", "repetition"]);
});

const sha = (value) => createHash("sha256").update(value).digest("hex");
const authorization = { failure_record_id: base.id, page_id: base.target.page_id, element_id: base.target.element_id, fields: ["font_size"] };
function repairFixture(mutate = () => {}) {
  const before = { title: "deck", pages: [{ id: "page-002", elements: [{ id: "label-risk", fields: { font_size: 12, text: "Keep" } }, { id: "other", fields: { text: "Unchanged" } }] }, { id: "page-003", elements: [{ id: "title", fields: { text: "Original" } }] }] };
  const after = structuredClone(before);
  after.pages[0].elements[0].fields.font_size = 18;
  mutate(after);
  const input = { changed_targets: [{ page_id: "page-002", element_id: "label-risk", fields: ["font_size"] }] };
  for (const [side, snapshot] of [["before", before], ["after", after]]) {
    input[`${side}_artifact_json`] = JSON.stringify(snapshot);
    input[`${side}_artifact_sha256`] = sha(input[`${side}_artifact_json`]);
    input[`${side}_page_sha256`] = sha(JSON.stringify(snapshot.pages[0]));
  }
  return input;
}
const bind = (input, auth = authorization) => bindVisualRepairEvidence(createVisualFailureRecord(base), input, auth);

test("Stage 2 verifies an authorized repair and detaches returned evidence", () => {
  const input = repairFixture();
  const auth = structuredClone(authorization);
  const evidence = bind(input, auth);
  assert.equal(evidence.failure_record_id, base.id);
  assert.equal(evidence.unrelated_pages_unchanged, true);
  assert.match(evidence.acceptance_boundary, /not rendered artifact or visual acceptance/);
  auth.fields.push("text"); input.changed_targets[0].fields.push("text");
  assert.deepEqual(evidence.authorization.fields, ["font_size"]);
  assert.deepEqual(evidence.changed_targets[0].fields, ["font_size"]);
});

test("Stage 2 rejects malformed fields and independent authorization mismatches", () => {
  for (const fields of [undefined, [], "font_size", [""], [null], ["font_size", "font_size"]]) {
    const input = repairFixture(); input.changed_targets[0].fields = fields;
    assert.throws(() => bind(input), { code: "VISUAL_REPAIR_EVIDENCE_INVALID" });
  }
  for (const auth of [null, { ...authorization, fields: [] }, { ...authorization, failure_record_id: "another" }, { ...authorization, element_id: "other" }]) {
    assert.throws(() => bind(repairFixture(), auth), { code: "VISUAL_REPAIR_SCOPE_VIOLATION" });
  }
  const input = repairFixture(); input.changed_targets[0].fields = ["text"];
  assert.throws(() => bind(input), { code: "VISUAL_REPAIR_SCOPE_VIOLATION" });
});

test("Stage 2 rejects real unrelated deltas even with valid hashes and caller flags", () => {
  for (const mutate of [
    (deck) => { deck.pages[1].elements[0].fields.text = "Regenerated"; },
    (deck) => { deck.pages[0].elements[1].fields.text = "Changed"; },
    (deck) => { deck.title = "Replaced"; },
    (deck) => { deck.pages.pop(); },
    (deck) => { deck.pages.reverse(); }
  ]) {
    const input = repairFixture(mutate);
    // Reversal changes the target page index; hash its actual bound page.
    const after = JSON.parse(input.after_artifact_json);
    input.after_page_sha256 = sha(JSON.stringify(after.pages.find((page) => page.id === "page-002")));
    input.unrelated_pages_unchanged = true; input.unrelated_fields_unchanged = true;
    assert.throws(() => bind(input), { code: "VISUAL_REPAIR_SCOPE_VIOLATION" });
  }
  const input = repairFixture((deck) => { deck.pages[0].elements[0].fields.text = "Unauthorized"; });
  input.changed_targets[0].fields.push("text");
  assert.throws(() => bind(input), { code: "VISUAL_REPAIR_SCOPE_VIOLATION" });
  input.changed_targets[0].fields = ["font_size"];
  assert.throws(() => bind(input), { code: "VISUAL_REPAIR_EVIDENCE_INVALID" });
});

test("Stage 2 rejects substituted hashes, incomplete manifests, and fictitious changes", () => {
  for (const key of ["before_artifact_sha256", "after_artifact_sha256", "before_page_sha256", "after_page_sha256"]) {
    assert.throws(() => bind({ ...repairFixture(), [key]: "f".repeat(64) }), { code: "VISUAL_REPAIR_EVIDENCE_INVALID" });
  }
  for (const mutate of [
    (deck) => { deck.pages[0].elements[0].fields.font_size = 12; },
    (deck) => { deck.pages.push(structuredClone(deck.pages[0])); },
    (deck) => { delete deck.pages[0].elements[0].fields; },
    (deck) => { deck.pages[0].elements.push(structuredClone(deck.pages[0].elements[0])); }
  ]) assert.throws(() => bind(repairFixture(mutate)), { code: "VISUAL_REPAIR_EVIDENCE_INVALID" });
  const input = repairFixture(); delete input.before_artifact_json;
  assert.throws(() => bind(input), { code: "VISUAL_REPAIR_EVIDENCE_INVALID" });
});

test("Stage 1 rejects missing evidence and unsupported categories", () => {
  assert.throws(() => createVisualFailureRecord({ ...base, evidence: { screenshot_sha256: "bad" } }), { code: "VISUAL_FAILURE_EVIDENCE_INVALID" });
  assert.throws(() => createVisualFailureRecord({ ...base, classification: { category: "taste", confidence: 1 } }), { code: "VISUAL_FAILURE_CATEGORY_INVALID" });
});

test("feedback retains formatting and whitespace remains part of record identity", () => {
  const raw_feedback = "  标签不够醒目。\r\n\t保留缩进。\n";
  const record = createVisualFailureRecord({ ...base, raw_feedback });
  assert.equal(record.raw_feedback, raw_feedback);
  assert.notEqual(record.record_sha256, createVisualFailureRecord({ ...base, raw_feedback: raw_feedback.trim() }).record_sha256);
  assert.throws(() => createVisualFailureRecord({ ...base, raw_feedback: " \t\r\n" }), { code: "VISUAL_FAILURE_FEEDBACK_REQUIRED" });
});

test("optional bounds accept absence and zero coordinates but reject malformed evidence", () => {
  for (const bounds of [undefined, null]) {
    assert.equal(createVisualFailureRecord({ ...base, target: { ...base.target, bounds } }).target.bounds, null);
  }
  const zeroBounds = { x: 0, y: 0, width: 0, height: 0 };
  assert.deepEqual(createVisualFailureRecord({ ...base, target: { ...base.target, bounds: zeroBounds } }).target.bounds, zeroBounds);
  for (const bounds of [false, true, 0, "", "bounds", [], {}, { x: 0, y: 0, width: -1, height: 1 }, { x: 0, y: 0, width: 1, height: NaN }]) {
    assert.throws(() => createVisualFailureRecord({ ...base, target: { ...base.target, bounds } }), { code: "VISUAL_FAILURE_BOUNDS_INVALID" }, `reject bounds ${JSON.stringify(bounds)}`);
  }
});
