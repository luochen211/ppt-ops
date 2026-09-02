#!/usr/bin/env node
import path from "node:path";
import { inspectGraphicConception } from "../src/qa/visual-design.js";

const project = path.resolve(process.argv[2] ?? "projects/ai-delivery-first-order");

try {
  const result = await inspectGraphicConception(project);
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "passed") process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ project, status: "failed", error: error.message }, null, 2));
  process.exitCode = 1;
}
