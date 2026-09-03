import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { analyzeHtmlGeometry, inspectHtmlPresentation, removeBrowserProfile } from "../src/qa/html.js";

const page = (elements, extra = {}) => ({ page: 6, policy: "advisory", rect: { x: 0, y: 0, width: 1600, height: 900 }, elements, ...extra });
const element = (id, role, rect, extra = {}) => ({ id, explicitId: true, role, rect, allowAll: false, allowWith: [], ancestors: [], ...extra });

test("HTML QA rejects a connector that crosses a protected node", () => {
  const result = analyzeHtmlGeometry([page([
    element("line", "connector", { x: 100, y: 300, width: 900, height: 2 }),
    element("content-card", "node", { x: 450, y: 200, width: 300, height: 260 })
  ])]);
  assert.equal(result.status, "failed");
  assert.deepEqual(result.findings.map(({ check, evidence }) => [check, evidence.reason]), [["html-unintended-overlap", "connector-crosses-protected-element"]]);
});

test("HTML QA allows a connector that stops at the node edge", () => {
  const result = analyzeHtmlGeometry([page([
    element("line", "connector", { x: 100, y: 300, width: 350, height: 2 }),
    element("content-card", "node", { x: 450, y: 200, width: 300, height: 260 })
  ])]);
  assert.equal(result.status, "passed");
  assert.equal(result.findings.length, 0);
});

test("HTML QA requires an explicit pair allowlist for intentional overlap", () => {
  const result = analyzeHtmlGeometry([page([
    element("badge", "node", { x: 480, y: 260, width: 160, height: 100 }, { allowWith: ["panel"] }),
    element("panel", "node", { x: 450, y: 200, width: 300, height: 260 })
  ])]);
  assert.equal(result.status, "passed");
});

test("HTML QA ignores declared parent-child containment but reports out-of-bounds nodes", () => {
  const result = analyzeHtmlGeometry([page([
    element("panel", "node", { x: 450, y: 200, width: 300, height: 260 }),
    element("panel-copy", "content", { x: 480, y: 240, width: 220, height: 100 }, { ancestors: ["panel"] }),
    element("escaped", "node", { x: 1550, y: 100, width: 100, height: 100 })
  ])]);
  assert.equal(result.status, "failed");
  assert.deepEqual(result.findings.map(({ check }) => check), ["html-out-of-bounds"]);
});

test("HTML QA fails strict pages that remove their geometry contract", () => {
  const result = analyzeHtmlGeometry([page([], { policy: "strict" })]);
  assert.equal(result.status, "failed");
  assert.deepEqual(result.findings.map(({ check }) => check), ["html-qa-coverage"]);
});

test("HTML QA rejects unstable identifiers and broken allowlists", () => {
  const result = analyzeHtmlGeometry([page([
    element("generated-id", "node", { x: 20, y: 20, width: 100, height: 100 }, { explicitId: false, allowWith: ["missing"] })
  ])]);
  assert.equal(result.status, "failed");
  assert.deepEqual(result.findings.map(({ evidence }) => evidence.reason), ["stable-data-qa-id-required", "allowlist-target-not-found"]);
});

test("HTML QA reports an unannotated advisory deck as degraded, never passed", () => {
  const result = analyzeHtmlGeometry([page([])]);
  assert.equal(result.status, "degraded");
  assert.match(result.reason, /No data-qa geometry annotations/);
});

test("browser profile cleanup retries transient Chromium directory races", async () => {
  let attempts = 0;
  const waits = [];
  await removeBrowserProfile("/tmp/pptops-html-qa-profile", {
    rm: async (_profile, options) => {
      attempts += 1;
      assert.deepEqual(options, { recursive: true, force: true, maxRetries: 0 });
      if (attempts < 3) {
        const error = new Error("profile is still busy");
        error.code = "ENOTEMPTY";
        throw error;
      }
    },
    wait: async (milliseconds) => waits.push(milliseconds),
  });
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [200, 200]);
});

test("headless HTML QA emits page-addressable evidence for a rendered collision", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-html-qa-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "collision.html");
  await fs.writeFile(file, `<!doctype html><style>.slide{position:relative;width:800px;height:450px}.line{position:absolute;left:40px;top:220px;width:700px;height:2px;background:#000}.node{position:absolute;left:300px;top:150px;width:240px;height:160px;background:#fff}</style><section class="slide" data-page="7" data-qa-policy="strict"><div class="line" data-qa-id="flow" data-qa-role="connector"></div><div class="node" data-qa-id="decision" data-qa-role="node"></div></section>`);
  const result = await inspectHtmlPresentation({ htmlFile: file });
  if (result.status === "degraded") return t.skip(result.reason);
  assert.equal(result.status, "failed");
  assert.deepEqual(result.findings.map(({ page, check, evidence }) => [page, check, evidence.reason]), [[7, "html-unintended-overlap", "connector-crosses-protected-element"]]);
});
