import test from "node:test";
import assert from "node:assert/strict";
import { validatePage, validateProject } from "../src/core/validate.js";

test("valid page-spec passes", () => {
  assert.deepEqual(validatePage({
    page: 1,
    task: "建立预期",
    three_second_message: "观众三秒内知道重点",
    relation: "hero",
    screen_text: { title: "标题" },
    visual_job: "建立记忆点",
    status: "draft"
  }), []);
});

test("invalid page-spec reports missing and invalid fields", () => {
  const errors = validatePage({ page: 0, relation: "unknown", screen_text: {}, status: "done" });
  assert.ok(errors.includes("page must be a positive integer"));
  assert.ok(errors.includes("relation is invalid: unknown"));
  assert.ok(errors.includes("screen_text.title is required"));
});

test("project validation catches duplicate pages", () => {
  const errors = validateProject({ project: { name: "demo" }, pages: [
    { page: 1, task: "a", three_second_message: "b", relation: "hero", screen_text: { title: "c" }, visual_job: "d", status: "draft" },
    { page: 1, task: "e", three_second_message: "f", relation: "hero", screen_text: { title: "g" }, visual_job: "h", status: "draft" }
  ] });
  assert.deepEqual(errors, ["duplicate page number: 1"]);
});
