import fs from "node:fs/promises";
import path from "node:path";
import { outputDir } from "../core/project.js";
import { validateProject } from "../core/validate.js";

export const REVIEW_REPORT_FILE = "review-report.json";

export async function reviewProject(project) {
  const validationErrors = validateProject(project);
  const artifacts = await listOutputArtifacts(outputDir(project));
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
    }
  ];
  const acceptance = [
    pendingAcceptance("visual-acceptance", "visual", "Requires human visual inspection of rendered slides."),
    pendingAcceptance("real-powerpoint-acceptance", "real_powerpoint", "Requires opening and presenting the PPTX in Microsoft PowerPoint.")
  ];
  const requiredFailures = automatedChecks.filter((check) => check.required && check.status === "failed");

  return {
    schema_version: "0.1",
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

function pendingAcceptance(id, kind, note) {
  return { id, kind, required: false, status: "pending", evidence: { note } };
}

function summarizeStatuses(items) {
  return Object.fromEntries(["passed", "failed", "pending"].map((status) => [status, items.filter((item) => item.status === status).length]));
}
