#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { runLargeDeckAcceptance } from "../src/acceptance/large-deck.js";

const input = process.argv[2];
const project = process.argv[3];
const render = process.argv.includes("--render");
if (!input || !project) throw new Error("usage: run-large-deck-acceptance <input.pptx> <project-dir> [--render]");
const result = await runLargeDeckAcceptance({ inputFile: path.resolve(input), projectDir: path.resolve(project), render });
await fs.mkdir(path.join(project, "acceptance"), { recursive: true });
const report = path.join(project, "acceptance", "large-deck-report.json");
await fs.writeFile(report, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ ...result, report }, null, 2));
