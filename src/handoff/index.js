import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { outputDir } from "../core/project.js";

export const HANDOFF_DIR = "handoff";
export const HANDOFF_MANIFEST_FILE = "manifest.json";

export async function createHandoff(project, reviewReport) {
  const outputs = outputDir(project);
  const packageDir = await nextPackageDirectory(outputs);
  await fs.mkdir(packageDir, { recursive: true });

  const sourceFiles = await availableOutputFiles(outputs);
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
    }
  };
  const manifestFile = path.join(packageDir, HANDOFF_MANIFEST_FILE);
  await fs.writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
  return { manifest, manifestFile, packageDir };
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
