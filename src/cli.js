#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { readProject, outputDir } from "./core/project.js";
import { validateProject } from "./core/validate.js";
import { planHtmlBuild } from "./adapters/html.js";
import { planPptxBuild } from "./adapters/pptx.js";

const [command, projectDir = "examples/demo-project", ...args] = process.argv.slice(2);

if (!command || command === "help") {
  console.log("Usage: pptops <intake|outline|prototype|build|review> <project-dir> [options]");
  process.exit(0);
}

try {
  const project = await readProject(projectDir);
  const errors = validateProject(project);
  if (errors.length > 0) {
    console.error(errors.map((error) => `- ${error}`).join("\n"));
    process.exit(1);
  }

  if (command === "intake") {
    console.log(JSON.stringify({ command, project: project.project, source_files: project.project.source_files ?? [] }, null, 2));
  } else if (command === "outline") {
    console.log(JSON.stringify({ command, pages: project.pages.map(({ page, task, relation }) => ({ page, task, relation })) }, null, 2));
  } else if (command === "prototype") {
    const requested = getOption(args, "--pages");
    const pages = requested ? project.pages.filter((page) => requested.split(",").includes(String(page.page))) : project.pages.slice(0, 3);
    console.log(JSON.stringify({ command, pages: pages.map(({ page, three_second_message, visual_job }) => ({ page, three_second_message, visual_job })) }, null, 2));
  } else if (command === "build") {
    const format = getOption(args, "--format") ?? "html";
    if (!(["html", "pptx"].includes(format))) throw new Error("--format must be html or pptx");
    const plan = format === "html" ? planHtmlBuild(project) : planPptxBuild(project);
    const dir = outputDir(project);
    await fs.mkdir(dir, { recursive: true });
    const output = path.join(dir, `${format}-build-plan.json`);
    await fs.writeFile(output, `${JSON.stringify(plan, null, 2)}\n`);
    console.log(`Build plan written: ${output}`);
  } else if (command === "review") {
    console.log(JSON.stringify({ command, valid: true, page_count: project.pages.length }, null, 2));
  } else {
    throw new Error(`unknown command: ${command}`);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

function getOption(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}
