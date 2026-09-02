import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { inspectGraphicConception, validateGraphicConception } from "../src/qa/visual-design.js";

const project = path.resolve("projects/ai-delivery-first-order");

test("AI delivery graphic conception is traceable across project artifacts", async () => {
  const result = await inspectGraphicConception(project);
  assert.equal(result.status, "passed");
  assert.deepEqual(result.metrics, { pages: 22, decisions: 22, motifs: 4, templates: 19, html_layouts: 22 });
  assert.deepEqual(result.findings, []);
});

test("traceability rejects missing decisions, semantic drift, and incomplete reasoning", async () => {
  const fixture = await loadFixture();
  fixture.design.page_decisions.shift();
  Object.assign(fixture.design.page_decisions[0], {
    relation: "comparison",
    visual_job: "Drifted visual job",
    motif: "decoration",
    template_id: "template-missing",
    reading_path: [],
    rationale: "",
    avoid: ""
  });
  const result = validateGraphicConception(fixture);
  assert.equal(result.status, "failed");
  for (const code of ["decision-count-mismatch", "design-decision-missing", "relation-mismatch", "visual-job-mismatch", "unknown-motif", "unknown-template", "reading-path-incomplete", "rationale-missing", "avoid-rule-missing"]) {
    assert.ok(result.findings.some((finding) => finding.code === code), code);
  }
});

test("traceability rejects duplicate pages and HTML layout-order drift", async () => {
  const fixture = await loadFixture();
  fixture.design.page_decisions[1].page = 1;
  fixture.html = fixture.html.replace('data-layout="AGENDA-4"', 'data-layout="PROOF-4"');
  const result = validateGraphicConception(fixture);
  assert.equal(result.status, "failed");
  assert.ok(result.findings.some(({ code }) => code === "duplicate-design-page"));
  assert.ok(result.findings.some(({ code, page }) => code === "html-layout-mismatch" && page === 3));
});

async function loadFixture() {
  const [pages, design, templates, html] = await Promise.all([
    readJson("pages.json"),
    readJson("design-direction.json"),
    readJson("templates.json"),
    fs.readFile(path.join(project, "ppt", "index.html"), "utf8")
  ]);
  return { pages: structuredClone(pages), design: structuredClone(design), templates: structuredClone(templates), html };
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(path.join(project, file), "utf8"));
}
