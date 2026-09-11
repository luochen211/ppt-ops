import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { readDeliverySelection } from "../delivery/selection.js";
import { outputDir } from "../core/project.js";

export const HANDOFF_DIR = "handoff";
export const HANDOFF_MANIFEST_FILE = "manifest.json";

export async function createHandoff(project, reviewReport, options = {}) {
  if (!options.deliverySelection?.id) throw Object.assign(new Error("handoff requires an explicit stored delivery selection"), { code: "DELIVERY_SELECTION_REQUIRED" });
  const selection = await readDeliverySelection(project.root, options.deliverySelection.id);
  if (selection.artifact_type !== "presentation") throw Object.assign(new Error("handoff requires a presentation selection"), { code: "DELIVERY_SELECTION_MISMATCH" });
  const outputs = outputDir(project);

  const sourceFiles = (options.sourceFiles ?? await availableOutputFiles(outputs)).filter(source => source.name === "review-report.json" || selection.formats.some(format => source.name === `slides.${format}`));
  if (selection.formats.some(format => !sourceFiles.some(source => source.name === `slides.${format}`))) throw Object.assign(new Error("a selected artifact is missing"), { code: "EXPORTER_UNAVAILABLE" });
  const packageDir = await nextPackageDirectory(outputs);
  await fs.mkdir(packageDir, { recursive: true });
  sourceFiles.sort((left, right) => left.name.localeCompare(right.name));
  const packagedOutputs = [];
  for (const source of sourceFiles) {
    const destination = path.join(packageDir, source.name);
    await fs.copyFile(source.path, destination, constants.COPYFILE_EXCL);
    const contents = await fs.readFile(destination);
    packagedOutputs.push({
      name: source.name,
      source: path.relative(project.root, source.path),
      packaged: path.relative(project.root, destination),
      bytes: contents.byteLength,
      sha256: createHash("sha256").update(contents).digest("hex")
    });
  }
  const accessibility = accessibilityHandoff(reviewReport);

  const manifest = {
    schema_version: "0.1",
    command: "handoff",
    project: project.project.name,
    source_outputs_preserved: true,
    outputs: packagedOutputs,
    acceptance: reviewReport.summary,
    review: {
      passed: reviewReport.passed,
      required_failure_count: reviewReport.required_failure_count
    },
    delivery_selection: selection,
    ...(options.variant ? { variant: options.variant } : {}),
    ...(options.corporateProfile ? { corporate_profile: options.corporateProfile } : {}),
    ...(accessibility ? { accessibility } : {}),
    ...(options.boundaryImages ? { boundary_images: options.boundaryImages.boundaries.map(({ boundary, roles, page_id, asset_id, generation_id, sha256 }) => ({ boundary, roles, page_id, asset_id, generation_id, sha256 })) } : {})
  };
  const manifestFile = path.join(packageDir, HANDOFF_MANIFEST_FILE);
  await fs.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return { manifest, manifestFile, packageDir };
}

function accessibilityHandoff(reviewReport) {
  const audit = reviewReport.automated_checks?.find(({ id }) => id === "accessibility-audit")?.evidence;
  if (!audit) return undefined;
  return {
    declared_profile: audit.declared_profile,
    source_revision: audit.source_revision,
    build_revision: audit.build_revision,
    status: audit.status,
    unresolved_findings: audit.findings,
    format_capabilities: audit.format_capabilities,
    artifact_audits: audit.artifacts ?? [],
    evidence: audit.evidence,
    claims: audit.claims
  };
}

async function availableOutputFiles(outputs) {
  let entries;
  try {
    entries = await fs.readdir(outputs, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => ({ name: entry.name, path: path.join(outputs, entry.name) }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function nextPackageDirectory(outputs) {
  const handoffRoot = path.join(outputs, HANDOFF_DIR);
  await fs.mkdir(handoffRoot, { recursive: true });
  for (let number = 1; ; number += 1) {
    const candidate = path.join(handoffRoot, `package-${String(number).padStart(3, "0")}`);
    try {
      await fs.access(candidate);
    } catch (error) {
      if (error.code === "ENOENT") return candidate;
      throw error;
    }
  }
}
