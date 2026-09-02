import fs from "node:fs/promises";
import path from "node:path";

export async function inspectGraphicConception(projectDir) {
  const root = path.resolve(projectDir);
  const [pages, design, templates, html] = await Promise.all([
    readJson(path.join(root, "pages.json")),
    readJson(path.join(root, "design-direction.json")),
    readJson(path.join(root, "templates.json")),
    fs.readFile(path.join(root, "ppt", "index.html"), "utf8")
  ]);
  return { project: root, ...validateGraphicConception({ pages, design, templates, html }) };
}

export function validateGraphicConception({ pages, design, templates, html }) {
  const findings = [];
  const fail = (code, detail = {}) => findings.push({ severity: "error", code, ...detail });
  const pageList = Array.isArray(pages) ? pages : [];
  const decisionList = Array.isArray(design?.page_decisions) ? design.page_decisions : [];
  const templateList = Array.isArray(templates) ? templates : [];
  const motifList = Array.isArray(design?.motifs) ? design.motifs : [];

  if (!Array.isArray(pages)) fail("pages-not-array");
  if (!design || typeof design !== "object") fail("design-not-object");
  if (!Array.isArray(design?.page_decisions)) fail("decisions-not-array");
  if (!Array.isArray(templates)) fail("templates-not-array");
  if (!Array.isArray(design?.motifs)) fail("motifs-not-array");
  if (motifList.length === 0 || motifList.length > 4) fail("motif-count-out-of-range", { actual: motifList.length, maximum: 4 });

  const motifIds = uniqueIndex(motifList, "id", "duplicate-motif", fail);
  for (const motif of motifList) {
    requireText(motif, "id", "motif-field-missing", fail);
    requireText(motif, "purpose", "motif-field-missing", fail, motif.id);
    requireText(motif, "avoid", "motif-field-missing", fail, motif.id);
  }

  const templatesById = uniqueIndex(templateList, "id", "duplicate-template", fail);
  for (const template of templateList) {
    requireText(template, "id", "template-field-missing", fail);
    requireText(template, "name", "template-field-missing", fail, template.id);
    if (!hasText(template?.renderers?.html)) fail("template-html-layout-missing", { template_id: template?.id });
  }

  uniqueIndex(pageList, "page", "duplicate-page-spec-number", fail);
  uniqueIndex(pageList, "id", "duplicate-page-spec-id", fail);
  const decisionsByPage = uniqueIndex(decisionList, "page", "duplicate-design-page", fail);
  uniqueIndex(decisionList, "page_id", "duplicate-design-page-id", fail);

  const layouts = extractHtmlLayouts(html);
  if (layouts.length !== pageList.length) fail("html-page-count-mismatch", { expected: pageList.length, actual: layouts.length });
  if (decisionList.length !== pageList.length) fail("decision-count-mismatch", { expected: pageList.length, actual: decisionList.length });

  for (const [index, page] of pageList.entries()) {
    const decision = decisionsByPage.get(page.page);
    if (!decision) {
      fail("design-decision-missing", { page: page.page, page_id: page.id });
      continue;
    }
    if (decision.page_id !== page.id) fail("page-id-mismatch", { page: page.page, expected: page.id, actual: decision.page_id });
    if (decision.relation !== page.relation) fail("relation-mismatch", { page: page.page, expected: page.relation, actual: decision.relation });
    if (decision.visual_job !== page.visual_job) fail("visual-job-mismatch", { page: page.page, expected: page.visual_job, actual: decision.visual_job });
    if (!motifIds.has(decision.motif)) fail("unknown-motif", { page: page.page, motif: decision.motif });
    const template = templatesById.get(decision.template_id);
    if (!template) {
      fail("unknown-template", { page: page.page, template_id: decision.template_id });
    } else if (layouts[index] !== template.renderers.html) {
      fail("html-layout-mismatch", { page: page.page, template_id: decision.template_id, expected: template.renderers.html, actual: layouts[index] });
    }
    if (!Array.isArray(decision.reading_path) || decision.reading_path.length < 2 || decision.reading_path.some((item) => !hasText(item))) {
      fail("reading-path-incomplete", { page: page.page });
    }
    requireText(decision, "rationale", "rationale-missing", fail, page.page);
    requireText(decision, "avoid", "avoid-rule-missing", fail, page.page);
  }

  for (const decision of decisionList) {
    if (!pageList.some((page) => page.page === decision.page)) fail("orphan-design-decision", { page: decision.page, page_id: decision.page_id });
  }

  return {
    status: findings.length === 0 ? "passed" : "failed",
    metrics: {
      pages: pageList.length,
      decisions: decisionList.length,
      motifs: motifList.length,
      templates: templateList.length,
      html_layouts: layouts.length
    },
    findings
  };
}

export function extractHtmlLayouts(html) {
  if (typeof html !== "string") return [];
  return [...html.matchAll(/<section\b[^>]*\bdata-layout=(['"])(.*?)\1/gi)].map((match) => match[2]);
}

function uniqueIndex(values, field, code, fail) {
  const result = new Map();
  for (const value of values) {
    const key = value?.[field];
    if (result.has(key)) fail(code, { field, value: key });
    else result.set(key, value);
  }
  return result;
}

function requireText(value, field, code, fail, subject) {
  if (!hasText(value?.[field])) fail(code, { subject, field });
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}
