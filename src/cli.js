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
import { assertBoundaryGeneratedImages } from "./visual-assets/boundary-policy.js";

const APPLICATION_COMMANDS = new Set(["candidate-propose", "candidate-reconstruct-relations", "candidate-render", "candidate-diff", "candidate-accept", "candidate-reject", "candidate-auto-reject", "candidate-continue", "candidate-record-powerpoint-observation", "candidate-feedback-show", "candidate-attempts", "candidate-compare", "version-freeze", "build-create", "build-retry", "review-run", "review-record", "handoff-create"]);
const VISUAL_ASSET_COMMANDS = new Set(["visual-asset-prepare", "visual-asset-ingest", "visual-asset-observe", "visual-asset-decide", "visual-asset-register"]);
const HELP = `PPT-Ops 1.0

Usage:
  pptops init <project-dir> [--name <id>] [--title <title>]
  pptops migrate <foundation-project-dir> --to <v1-project-dir>
  pptops import <project-dir> --file <markdown|docx|pptx>
  pptops validate <project-dir>
  pptops html-qa <html-file> [--browser <path>] [--timeout <ms>]
  pptops intake <project-dir>
  pptops outline <project-dir>
  pptops prototype <project-dir> [--pages <list>]
  pptops build <project-dir> [--format html|pptx|all]
  pptops review <project-dir>
  pptops handoff <project-dir>
  pptops deliver <project-dir>
  pptops candidate-propose <project-dir> --target-kind <kind> --target-id <id> --patch <json> --base-revision <n> [--parent-candidate <id>] [--hypothesis <text>]
  pptops candidate-reconstruct-relations <project-dir> --target-kind page_spec --target-id <id> --patch <json> --base-revision <n> --parent-candidate <id> --reconstruction <json>
  pptops candidate-render <project-dir> --candidate <id> --expected-revision <n>
  pptops candidate-diff <project-dir> --candidate <id>
  pptops candidate-record-powerpoint-observation <project-dir> --candidate <id> --expected-revision <n> --status <viewed|not_viewed> --evidence <json>
  pptops candidate-accept <project-dir> --candidate <id> --expected-revision <n> [--raw-feedback <explicit acceptance>]
  pptops candidate-reject <project-dir> --candidate <id> --expected-revision <n> --raw-feedback <text> --findings <json-array>
  pptops candidate-auto-reject <project-dir> --candidate <id> --expected-revision <n> --raw-feedback <text> --findings <json-array>
  pptops candidate-continue <project-dir> --candidate <id> --expected-revision <n> --raw-feedback <text> --findings <json-array>
  pptops candidate-feedback-show <project-dir> --candidate <id>
  pptops candidate-attempts <project-dir> --target-kind <kind> --target-id <id>
  pptops candidate-compare <project-dir> --left-candidate <id> --right-candidate <id>
  pptops visual-asset-prepare <project-dir> --brief <json>
  pptops visual-asset-ingest <project-dir> --brief-id <id> --file <generated-raster> --provider <id> --model <id> [--mime <mime>]
  pptops visual-asset-observe <project-dir> --generation <id> --actor <agent|human> --verdict <pass|fail> --checks <json> [--notes <text>]
  pptops visual-asset-decide <project-dir> --generation <id> --decision <accept|continue_iteration|reject> --raw-feedback <text>
  pptops visual-asset-register <project-dir> --generation <id> --asset-id <id> --page-id <id> --slot-role <id> --alt <text> [--fit <contain|cover>]
  pptops version-freeze <project-dir>
  pptops build-create <project-dir> --version <id> --targets <html,pptx>
  pptops build-retry <project-dir> --build <id>
  pptops review-run <project-dir> --build <id>
  pptops review-record <project-dir> --review <id> --decision <accepted|rejected> --expected-revision <n> [--evidence <json>]
  pptops handoff-create <project-dir> --build <id> --review <id>
  pptops doctor [project-dir]
  pptops reindex <project-dir>
  pptops update-preview <repository-root> --source <update-root> [--data-root <path>]
  pptops update-apply <repository-root> --source <update-root> [--data-root <path>]
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
  if (command === "doctor") {
    if (argv.length > (projectDir && !projectDir.startsWith("--") ? 2 : 1)) throw new Error("doctor accepts only an optional <project-dir>");
    const { runDoctor } = await import("./doctor/index.js");
    const result = await runDoctor(projectDir && !projectDir.startsWith("--") ? projectDir : undefined);
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } else if (command === "html-qa") {
    if (!projectDir || projectDir.startsWith("--")) throw new Error("html-qa requires <html-file>");
    const options = parseOptions(argv.slice(2));
    const { inspectHtmlPresentation } = await import("./qa/html.js");
    const result = await inspectHtmlPresentation({ htmlFile: projectDir, browserPath: options.browser, timeoutMs: options.timeout ? positiveInteger(options.timeout, "timeout") : undefined });
    console.log(JSON.stringify({ command, ...result }, null, 2));
    if (result.status !== "passed") process.exitCode = 1;
  } else {
  if (!projectDir || projectDir.startsWith("--")) throw new Error(`${command} requires <project-dir>`);
  const options = parseOptions(argv.slice(2));

  if (command === "init") {
    const result = await initializeProject(projectDir, { name: options.name, title: options.title });
    console.log(JSON.stringify({ command, ...result }, null, 2));
  } else if (command === "migrate") {
    if (!options.to) throw new Error("migrate requires --to <v1-project-dir>");
    const result = await writeMigratedProject(projectDir, options.to);
    console.log(JSON.stringify({ command, source: path.resolve(projectDir), destination: result.destination, contract_version: result.contract_version, warnings: result.warnings }, null, 2));
  } else if (command === "reindex") {
    const { reindexProject } = await import("./doctor/index.js");
    console.log(JSON.stringify(await reindexProject(projectDir), null, 2));
  } else if (["update-preview", "update-apply"].includes(command)) {
    const { applyUpdate, previewUpdate } = await import("./update/index.js");
    const input = { repositoryRoot: projectDir, sourceRoot: required(options, "source"), ...(options["data-root"] ? { dataRoot: options["data-root"] } : {}) };
    console.log(JSON.stringify(await (command === "update-preview" ? previewUpdate(input) : applyUpdate(input)), null, 2));
  } else if (APPLICATION_COMMANDS.has(command)) {
    console.log(JSON.stringify({ ok: true, command, data: await runApplicationCommand(command, projectDir, options) }, null, 2));
  } else if (VISUAL_ASSET_COMMANDS.has(command)) {
    console.log(JSON.stringify({ ok: true, command, data: await runVisualAssetCommand(command, projectDir, options) }, null, 2));
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
      const boundaryImages = await assertBoundaryGeneratedImages(project);
      const outputs = await buildFormats(project, configured);
      const report = await reviewProject(project, { htmlQa: true });
      const reportFile = await writeReviewReport(project, report);
      const handoff = await createHandoff(project, report, { boundaryImages });
      console.log(JSON.stringify({ command, project: project.project.name, outputs, review: { passed: report.passed, report_file: reportFile }, handoff: { manifest_file: handoff.manifestFile, package_dir: handoff.packageDir } }, null, 2));
      if (!report.passed) process.exitCode = 1;
    } else {
      throw new Error(`unknown command: ${command}`);
    }
  }
  }
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: { code: error.code ?? "COMMAND_FAILED", message: error.message, ...(error.details ? { details: error.details } : {}) } }));
  process.exit(1);
}

async function runApplicationCommand(command, projectDir, options) {
  const { ApplicationError, ApplicationService } = await import("./application/service.js");
  const service = await ApplicationService.open(projectDir);
  try {
    if (["candidate-propose", "candidate-reconstruct-relations"].includes(command)) return await service.proposeCandidate({
      targetKind: required(options, "target-kind"), targetId: required(options, "target-id"),
      patch: jsonOption(options, "patch"), baseRevision: integerOption(options, "base-revision"),
      parentCandidateId: options["parent-candidate"], hypothesis: options.hypothesis ?? "",
      reconstruction: options.reconstruction ? jsonOption(options, "reconstruction") : undefined
    });
    if (command === "candidate-render") return await service.renderCandidate(required(options, "candidate"), integerOption(options, "expected-revision"));
    if (command === "candidate-diff") return service.diffCandidate(required(options, "candidate"));
    if (command === "candidate-record-powerpoint-observation") return service.recordPowerPointObservation(required(options, "candidate"), { expectedRevision: integerOption(options, "expected-revision"), status: required(options, "status"), evidence: jsonOption(options, "evidence") });
    if (command === "candidate-accept") return await service.acceptCandidate(required(options, "candidate"), integerOption(options, "expected-revision"), options["raw-feedback"] ?? "Explicit acceptance");
    if (command === "candidate-auto-reject") return service.rejectCandidateByAutomatedQa(required(options, "candidate"), {
      expectedRevision: integerOption(options, "expected-revision"), rawFeedback: required(options, "raw-feedback"), findings: jsonOption(options, "findings")
    });
    if (["candidate-reject", "candidate-continue"].includes(command)) return await service.decideCandidate(required(options, "candidate"), {
      decision: command === "candidate-reject" ? "reject" : "continue_iteration", expectedRevision: integerOption(options, "expected-revision"),
      rawFeedback: required(options, "raw-feedback"), findings: jsonOption(options, "findings")
    });
    if (command === "candidate-feedback-show") return service.candidateFeedback(required(options, "candidate"));
    if (command === "candidate-attempts") return service.candidateAttempts({ targetKind: required(options, "target-kind"), targetId: required(options, "target-id") });
    if (command === "candidate-compare") return service.compareCandidates(required(options, "left-candidate"), required(options, "right-candidate"));
    if (command === "version-freeze") return await service.freezeVersion();
    if (command === "build-create") return await service.createBuild({ versionId: required(options, "version"), targets: required(options, "targets").split(",").map((item) => item.trim()).filter(Boolean) });
    if (command === "build-retry") return await service.retryBuild(required(options, "build"));
    if (command === "review-run") return await service.runReview(required(options, "build"));
    if (command === "review-record") return await service.recordReview(required(options, "review"), { decision: required(options, "decision"), expectedRevision: integerOption(options, "expected-revision"), evidence: options.evidence ? jsonOption(options, "evidence") : {} });
    if (command === "handoff-create") return await service.createHandoff(required(options, "build"), required(options, "review"));
    throw new ApplicationError("COMMAND_UNKNOWN", `unknown application command: ${command}`);
  } finally { service.close(); }
}

async function runVisualAssetCommand(command, projectDir, options) {
  const { VisualAssetPipeline } = await import("./visual-assets/pipeline.js");
  const pipeline = new VisualAssetPipeline(projectDir);
  if (command === "visual-asset-prepare") return pipeline.prepare(jsonOption(options, "brief"));
  if (command === "visual-asset-ingest") return pipeline.ingest(required(options, "brief-id"), {
    sourceFile: required(options, "file"), provider: required(options, "provider"), model: required(options, "model"), mime: options.mime
  });
  if (command === "visual-asset-observe") return pipeline.recordVisualObservation(required(options, "generation"), {
    actor: required(options, "actor"), verdict: required(options, "verdict"), checks: jsonOption(options, "checks"), notes: options.notes ?? ""
  });
  if (command === "visual-asset-decide") return pipeline.recordUserDecision(required(options, "generation"), {
    decision: required(options, "decision"), raw_feedback: required(options, "raw-feedback")
  });
  if (command === "visual-asset-register") return pipeline.registerAccepted(required(options, "generation"), {
    asset_id: required(options, "asset-id"), page_id: required(options, "page-id"), slot_role: required(options, "slot-role"),
    alt: required(options, "alt"), fit: options.fit ?? "contain"
  });
  throw new Error(`unknown visual asset command: ${command}`);
}

async function buildFormats(project, formats) {
  await assertBoundaryGeneratedImages(project);
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
  await assertBoundaryGeneratedImages(project);
  const report = await reviewProject(project, { htmlQa: true });
  const reportFile = await writeReviewReport(project, report);
  console.log(JSON.stringify({ ...report, report_file: reportFile }, null, 2));
  if (!report.passed) process.exitCode = 1;
}

async function runHandoff(project) {
  const boundaryImages = await assertBoundaryGeneratedImages(project);
  const report = await reviewProject(project, { htmlQa: true });
  const reportFile = await writeReviewReport(project, report);
  const handoff = await createHandoff(project, report, { boundaryImages });
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
    if (!["name", "title", "pages", "format", "to", "file", "target-kind", "target-id", "patch", "base-revision", "candidate", "expected-revision", "parent-candidate", "hypothesis", "reconstruction", "status", "raw-feedback", "findings", "left-candidate", "right-candidate", "version", "targets", "build", "review", "decision", "evidence", "source", "data-root", "brief", "brief-id", "provider", "model", "mime", "generation", "actor", "verdict", "checks", "notes", "asset-id", "page-id", "slot-role", "alt", "fit", "browser", "timeout"].includes(name)) throw new Error(`unknown option: ${key}`);
    options[name] = value;
  }
  return options;
}

function failValidation(errors) { throw new Error(errors.map((error) => `- ${error}`).join("\n")); }
function required(options, name) {
  if (!options[name]) { const error = new Error(`--${name} is required`); error.code = "OPTION_REQUIRED"; throw error; }
  return options[name];
}
function integerOption(options, name) {
  const value = Number(required(options, name));
  if (!Number.isInteger(value) || value < 1) { const error = new Error(`--${name} must be a positive integer`); error.code = "OPTION_INVALID"; throw error; }
  return value;
}
function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) { const error = new Error(`--${name} must be a positive integer`); error.code = "OPTION_INVALID"; throw error; }
  return parsed;
}
function jsonOption(options, name) {
  try { return JSON.parse(required(options, name)); }
  catch (cause) { const error = new Error(`--${name} must be valid JSON`); error.code = "OPTION_INVALID"; error.cause = cause; throw error; }
}
