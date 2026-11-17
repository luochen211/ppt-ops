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

test("prototype validation rejects incompatible versions and malformed contract fields", () => {
  const invalidFields = {
    contract_version: [undefined, "99.0", 1],
    kind: [undefined, "template"],
    id: [undefined, "NOT A STABLE ID", "prototype-", 42],
    name: [undefined, "", 42],
    purpose: [undefined, "", {}],
    relations: [undefined, "process", [], [""], [42], ["process", "process"]],
    content_mode: [undefined, "automatic"],
    capacity: [undefined, null, [], "capacity"],
    material_requirements: [undefined, "image", [""], [42]],
    renderers: [undefined, null, [], "html", {}, { html: "html" }, { html: 42, pptx: "pptx" }, { html: "html", pptx: "" }]
  };
  for (const [field, values] of Object.entries(invalidFields)) for (const value of values) {
    const prototype = structuredClone(PAGE_PROTOTYPE_CATALOG[0]);
    if (value === undefined) delete prototype[field]; else prototype[field] = value;
    assert.ok(validatePagePrototype(prototype).length > 0, `must reject ${field}=${JSON.stringify(value)}`);
  }
  for (const value of [undefined, null, [], "prototype", 42]) assert.ok(validatePagePrototype(value).length > 0);
  for (const field of ["title_chars", "body_items", "body_item_chars", "asset_slots"]) {
    for (const value of [undefined, -1, 0.5, "1", null, NaN, Infinity]) {
      const prototype = structuredClone(PAGE_PROTOTYPE_CATALOG[0]);
      if (value === undefined) delete prototype.capacity[field]; else prototype.capacity[field] = value;
      assert.ok(validatePagePrototype(prototype).length > 0, `must reject capacity.${field}=${value}`);
    }
  }
});

test("prototype validation preserves schema-permitted extension and boundary values", () => {
  const prototype = structuredClone(PAGE_PROTOTYPE_CATALOG[0]);
  prototype.capacity = { title_chars: 0, body_items: 0, body_item_chars: 0, asset_slots: 0 };
  prototype.material_requirements = [];
  prototype.relations = ["custom-relation"];
  prototype.renderers = { html: "shared-renderer", pptx: "shared-renderer" };
  prototype.extension = { future: true };
  // The schema specifies minLength, not trimming or a renderer-name registry.
  prototype.name = " ";
  assert.deepEqual(validatePagePrototype(prototype), []);
});
