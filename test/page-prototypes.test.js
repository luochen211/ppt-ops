import assert from "node:assert/strict";
import test from "node:test";
import { PAGE_PROTOTYPE_CATALOG, prototypesForRelation, validatePagePrototype } from "../src/layout/prototypes.js";

test("starter catalog exposes ten stable semantic prototypes", () => {
  assert.equal(PAGE_PROTOTYPE_CATALOG.length, 10);
  assert.equal(new Set(PAGE_PROTOTYPE_CATALOG.map(({ id }) => id)).size, 10);
  for (const prototype of PAGE_PROTOTYPE_CATALOG) {
    assert.deepEqual(validatePagePrototype(prototype), []);
    assert.match(prototype.id, /^prototype-[a-z0-9-]+$/);
    assert.notEqual(prototype.renderers.html, prototype.renderers.pptx);
  }
});

test("catalog covers text, image, interaction and comparison work", () => {
  assert.deepEqual(new Set(PAGE_PROTOTYPE_CATALOG.map(({ content_mode }) => content_mode)), new Set(["text-led", "image-led", "interaction", "comparison"]));
});

test("one relation can expose multiple prototypes without selecting one", () => {
  const comparison = prototypesForRelation("comparison");
  assert.ok(comparison.length >= 3);
  assert.ok(comparison.some(({ id }) => id === "prototype-before-after"));
  assert.ok(comparison.some(({ id }) => id === "prototype-assessment-checkpoint"));
});

test("invalid capacity and renderer contracts fail visibly", () => {
  const invalid = structuredClone(PAGE_PROTOTYPE_CATALOG[0]);
  invalid.capacity.body_items = -1;
  delete invalid.renderers.pptx;
  assert.deepEqual(validatePagePrototype(invalid), ["capacity.body_items must be a non-negative integer", "independent html and pptx renderer mappings are required"]);
});
