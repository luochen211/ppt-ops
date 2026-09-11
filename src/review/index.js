import fs from "node:fs/promises";
import path from "node:path";
import { outputDir } from "../core/project.js";
import { validateProject } from "../core/validate.js";
import { inspectPresentation } from "../qa/index.js";
import { inspectHtmlPresentation } from "../qa/html.js";
import { inspectDeliveryModeFit } from "../contracts/delivery.js";
import { auditAccessibility } from "../accessibility/index.js";

export const REVIEW_REPORT_FILE = "review-report.json";

export async function reviewProject(project, options = {}) {
  const directory = outputDir(project);
  const validationErrors = validateProject(project);
  const artifacts = await listOutputArtifacts(directory);
  const deliveryModeFit = inspectDeliveryModeFit(project);
  const automatedChecks = [
    {
      id: "project-validation",
      kind: "automated",
      required: true,
      status: validationErrors.length === 0 ? "passed" : "failed",
      evidence: validationErrors.length === 0
        ? { error_count: 0, page_count: project.pages.length }
        : { error_count: validationErrors.length, errors: validationErrors }
    },
    {
      id: "available-output-files",
      kind: "automated",
      required: false,
      status: "passed",
      evidence: { count: artifacts.length, files: artifacts }
    },
    {
      id: "delivery-mode-fit",
      kind: "automated",
      required: false,
      status: deliveryModeFit.status,
      evidence: deliveryModeFit
    }
  ];
  let accessibility;
  try {
    accessibility = auditAccessibility(project, { buildRevision: options.buildRevision });
  } catch (error) {
    accessibility = {
      schema_version: "1.0", kind: "accessibility_audit", intent: "audit_only", mutation_performed: false,
      project: project.project.name, source_revision: null, build_revision: options.buildRevision ?? null,
      status: "failed", finding_count: 1,
      findings: [{ id: "invalid-accessibility-profile", rule: "profile-contract", severity: "blocking", target: { kind: "project", id: project.project.name }, message: error.message, verification: "automated", evidence: {}, remediation: { kind: "candidate_required", automatically_applied: false } }],
      format_capabilities: {}, evidence: [{ kind: "automated", status: "failed" }, { kind: "legal_policy_conformance", status: "not_claimed" }],
      claims: { automated_conformance: false, legal_or_policy_conformance: "not_claimed", separate_accessible_variant_created: false }
    };
  }
  if (accessibility.status !== "not_requested") automatedChecks.push({
    id: "accessibility-audit",
    kind: "automated",
    required: project.project.accessibility_profile?.intent !== "audit_only",
    status: accessibility.status === "failed" ? "failed" : accessibility.status === "passed" ? "passed" : "pending",
    evidence: accessibility
  });
  const pptxFile = options.pptxFile ?? path.join(directory, "slides.pptx");
  try {
    await fs.access(pptxFile);
    const qa = await inspectPresentation({ project, pptxFile, evidenceDir: options.evidenceDir ?? path.join(directory, "review-evidence"), render: options.render ?? process.env.PPT_OPS_RENDER_QA !== "0" });
    automatedChecks.push({
      id: "pptx-visual-qa",
      kind: "automated",
      required: true,
      status: qa.status === "failed" ? "failed" : qa.status === "degraded" ? "pending" : "passed",
      evidence: qa
    });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    automatedChecks.push({ id: "pptx-visual-qa", kind: "automated", required: false, status: "pending", evidence: { reason: "No PPTX build selected for visual QA." } });
  }
  if (options.htmlQa) {
    const htmlFile = options.htmlFile ?? await firstExisting([
      path.join(directory, "slides.html"),
      path.join(project.root, "ppt", "index.html")
    ]);
    if (htmlFile) {
      const qa = await inspectHtmlPresentation({ htmlFile, browserPath: options.browserPath, timeoutMs: options.htmlQaTimeoutMs });
      automatedChecks.push({
        id: "html-visual-qa",
        kind: "automated",
        required: true,
        status: qa.status === "failed" ? "failed" : qa.status === "degraded" ? "pending" : "passed",
        evidence: qa
      });
    } else {
      automatedChecks.push({ id: "html-visual-qa", kind: "automated", required: false, status: "pending", evidence: { reason: "No HTML build selected for visual QA." } });
    }
  }
  const acceptance = [
    pendingAcceptance("visual-acceptance", "visual", "Requires human visual inspection of rendered slides."),
    pendingAcceptance("real-powerpoint-acceptance", "real_powerpoint", "Requires opening and presenting the PPTX in Microsoft PowerPoint.")
  ];
  if (accessibility.status !== "not_requested") acceptance.push(
    pendingAcceptance("human-accessibility-review", "human_accessibility_review", "Requires a human accessibility review."),
    pendingAcceptance("assistive-technology-testing", "assistive_technology", "Requires testing with the declared assistive technology."),
    pendingAcceptance("powerpoint-accessibility-checker", "powerpoint_accessibility_checker", "Requires a real Microsoft PowerPoint Accessibility Checker result when PPTX is requested.")
  );
  const requiredFailures = automatedChecks.filter((check) => check.required && check.status === "failed");

  return {
    schema_version: project.contractModel === "v1" ? "1.0" : "0.1",
    command: "review",
    project: project.project.name,
    passed: requiredFailures.length === 0,
    required_failure_count: requiredFailures.length,
    automated_checks: automatedChecks,
    acceptance,
    summary: summarizeAcceptance(automatedChecks, acceptance)
  };
}

export async function writeReviewReport(project, report) {
  const directory = outputDir(project);
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, REVIEW_REPORT_FILE);
  await fs.writeFile(file, `${JSON.stringify(report, null, 2)}\n`, { flag: "w" });
  return file;
}

export function summarizeAcceptance(automatedChecks, acceptance) {
  return {
    automated: summarizeStatuses(automatedChecks),
    visual: summarizeStatuses(acceptance.filter((item) => item.kind === "visual")),
    real_powerpoint: summarizeStatuses(acceptance.filter((item) => item.kind === "real_powerpoint"))
  };
}

async function listOutputArtifacts(directory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name !== REVIEW_REPORT_FILE)
    .map((entry) => entry.name)
    .sort();
}

async function firstExisting(files) {
  for (const file of files) {
    try { await fs.access(file); return file; } catch {}
  }
  return undefined;
}

function pendingAcceptance(id, kind, note) {
  return { id, kind, required: false, status: "pending", evidence: { note } };
}

function summarizeStatuses(items) {
  return Object.fromEntries(["passed", "failed", "pending"].map((status) => [status, items.filter((item) => item.status === status).length]));
}
