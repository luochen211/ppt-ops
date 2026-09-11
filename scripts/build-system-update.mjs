#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSystemArchive } from "../src/update/distribution.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
console.log(JSON.stringify(await buildSystemArchive({
  repositoryRoot,
  outputFile: path.resolve(process.argv[2] ?? path.join(repositoryRoot, "dist/ppt-ops-system.tar.gz"))
}), null, 2));
