#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { evaluateReleaseReadiness } from "../src/release/readiness.js";

const file = path.resolve(process.argv[2] ?? "docs/acceptance/v1.0-matrix.json");
const result = evaluateReleaseReadiness(JSON.parse(await fs.readFile(file, "utf8")));
console.log(JSON.stringify({ matrix: file, ...result }, null, 2));
if (!result.ready) process.exitCode = 1;
