#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildHtml } from "./adapters/html.js";
import { buildPptx } from "./adapters/pptx.js";
import { initializeProject } from "./core/init.js";
import { outputDir, readProject } from "./core/project.js";
import { validateProject } from "./core/validate.js";
import { createHandoff } from "./handoff/index.js";
import { writeMigratedProject } from "./migrations/foundation-to-v1.js";
import { reviewProject, writeReviewReport } from "./review/index.js";

const HELP = `PPT-Ops 1.0

Usage:
  pptops init <project-dir> [--name <id>] [--title <title>]
  pptops migrate <foundation-project-dir> --to <v1-project-dir>
  pptops import <project-dir> --file <markdown|docx|pptx>
  pptops validate <project-dir>
  pptops intake <project-dir>
  pptops outline <project-dir>
  pptops prototype <project-dir> [--pages <list>]
  pptops build <project-dir> [--format html|pptx|all]
  pptops review <project-dir>
  pptops handoff <project-dir>
  pptops deliver <project-dir>
  pptops --version`;

const argv = process.argv.slice(2);
const command = argv[0];

if (!command || ["help", "--help", "-h"].includes(command)) {
  console.log(HELP);
  process.exit(0);
}
if (["--version", "-v"].includes(command)) {
  const packageFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../package.json");
  console.log(JSON.parse(await fs.readFile(packageFile, "utf8")).version);
  process.exit(0);
}

try {
  const projectDir = argv[1];
  if (!projectDir || projectDir.startsWith("--")) throw new Error(`${command} requires <project-dir>`);
  const options = parseOptions(argv.slice(2));

  if (command === "init") {
    const result = await initializeProject(projectDir, { name: options.name, title: options.title });
    console.log(JSON.stringify({ command, ...result }, null, 2));
  } else if (command === "migrate") {
    if (!options.to) throw new Error("migrate requires --to <v1-project-dir>");
    const result = await writeMigratedProject(projectDir, options.to);
    console.log(JSON.stringify({ command, source: path.resolve(projectDir), destination: result.destination, contract_version: result.contract_version, warnings: result.warnings }, null, 2));
  } else {
    const project = await readProject(projectDir);
    const errors = validateProject(project);
    if (!["review", "handoff"].includes(command) && errors.length > 0) failValidation(errors);

    if (command === "import") {
      if (!options.file) throw new Error("import requires --file <markdown|docx|pptx>");
      const [{ InfrastructureStore }, { SourceIntake }] = await Promise.all([import("./infrastructure/store.js"), import("./sources/intake.js")]);
      const store = new InfrastructureStore(path.join(project.root, ".pptops", "metadata.sqlite"));
      try {
        store.registerProject({ id: project.project.name, root: project.root, title: project.project.title });
        const result = await new SourceIntake({ projectRoot: project.root, store, projectId: project.project.name }).importFile(options.file);
        console.log(JSON.stringify({ command, project: project.project.name, duplicate: result.duplicate, source: result.source, extracted: result.extracted }, null, 2));
      } finally { store.close(); }
    } else if (command === "validate") {
      console.log(JSON.stringify({ command, project: project.project.name, valid: true, error_count: 0, page_count: project.pages.length }, null, 2));
    } else if (command === "intake") {
      console.log(JSON.stringify({ command, project: project.project, source_files: project.project.source_files ?? [] }, null, 2));
    } else if (command === "outline") {
      console.log(JSON.stringify({ command, pages: project.pages.map(({ page, task, relation }) => ({ page, task, relation })) }, null, 2));
    } else if (command === "prototype") {
      const pageNumbers = options.pages ? parsePageNumbers(options.pages) : undefined;
      const pages = pageNumbers ? project.pages.filter((page) => pageNumbers.has(page.page)) : project.pages.slice(0, 3);
      if (options.pages && pages.length === 0) throw new Error("--pages did not match any project pages");
      console.log(JSON.stringify({ command, pages: pages.map(({ page, three_second_message, visual_job }) => ({ page, three_second_message, visual_job })) }, null, 2));
    } else if (command === "build") {
      console.log(JSON.stringify({ command, project: project.project.name, outputs: await buildFormats(project, resolveFormats(options.format ?? "html")) }, null, 2));
    } else if (command === "review") {
      await runReview(project);
    } else if (command === "handoff") {
      await runHandoff(project);
    } else if (command === "deliver") {
      const configured = project.project.outputs.filter((format) => ["html", "pptx"].includes(format));
      if (configured.length === 0) throw new Error("project.outputs must include html or pptx for deliver");
      const outputs = await buildFormats(project, configured);
      const report = await reviewProject(project);
      const reportFile = await writeReviewReport(project, report);
      const handoff = await createHandoff(project, report);
      console.log(JSON.stringify({ command, project: project.project.name, outputs, review: { passed: report.passed, report_file: reportFile }, handoff: { manifest_file: handoff.manifestFile, package_dir: handoff.packageDir } }, null, 2));
      if (!report.passed) process.exitCode = 1;
    } else {
      throw new Error(`unknown command: ${command}`);
    }
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

async function buildFormats(project, formats) {
  const directory = outputDir(project);
  await fs.mkdir(directory, { recursive: true });
  const results = [];
  for (const format of formats) {
    const output = path.join(directory, `slides.${format}`);
    if (format === "html") await fs.writeFile(output, await buildHtml(project));
    else await buildPptx(project, output);
    results.push({ format, file: output });
  }
  return results;
}

async function runReview(project) {
  const report = await reviewProject(project);
  const reportFile = await writeReviewReport(project, report);
  console.log(JSON.stringify({ ...report, report_file: reportFile }, null, 2));
  if (!report.passed) process.exitCode = 1;
}

async function runHandoff(project) {
  const report = await reviewProject(project);
  const reportFile = await writeReviewReport(project, report);
  const handoff = await createHandoff(project, report);
  console.log(JSON.stringify({ ...handoff.manifest, review_report: reportFile, manifest_file: handoff.manifestFile }, null, 2));
  if (!report.passed) process.exitCode = 1;
}

function resolveFormats(format) {
  if (format === "all") return ["html", "pptx"];
  if (["html", "pptx"].includes(format)) return [format];
  throw new Error("--format must be html, pptx, or all");
}

function parsePageNumbers(value) {
  const values = value.split(",").map((item) => Number(item.trim()));
  if (values.some((item) => !Number.isInteger(item) || item < 1)) throw new Error("--pages must be a comma-separated list of positive integers");
  return new Set(values);
}

function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!key?.startsWith("--") || value === undefined || value.startsWith("--")) throw new Error(`invalid option: ${key ?? ""}`.trim());
    const name = key.slice(2);
    if (!["name", "title", "pages", "format", "to", "file"].includes(name)) throw new Error(`unknown option: ${key}`);
    options[name] = value;
  }
  return options;
}

function failValidation(errors) { throw new Error(errors.map((error) => `- ${error}`).join("\n")); }
