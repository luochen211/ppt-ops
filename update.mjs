#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { applyUpdate, assertTargetPath, coded, previewUpdate, restoreBackup, targetDoctor } from "./src/update/index.js";
import { command, downloadSystemSnapshot, fileManifest, latestTestedCommit, snapshot } from "./src/update/distribution.js";
import { resolveDataRoot } from "./src/config/data-contract.js";

const defaultRoot = path.dirname(fileURLToPath(import.meta.url));
const help = `PPT-Ops system updater (Node.js 22+, Git, npm, tar)

  node update.mjs check                 Check the latest main commit that passed CI
  node update.mjs preview               List file changes and local conflicts
  node update.mjs apply                 Back up, update, install dependencies, run Doctor
  node update.mjs rollback              Restore the last update, including dependencies

Options:
  --root <path>       Installation directory (default: this script's directory)
  --source <path>     Extracted, checksum-verified system archive for offline use
  --data-root <path>  Explicit project data root
  --help             Show this help

Online updates follow tested main builds, not GA releases. Local changes block apply.
`;

export async function runUpdate(argv, services = {}) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    root: { type: "string" }, source: { type: "string" }, "data-root": { type: "string" }, help: { type: "boolean" }
  } });
  if (values.help) return { help };
  const action = positionals[0] ?? "check";
  if (positionals.length > 1 || !["check", "preview", "apply", "rollback"].includes(action)) throw coded("UPDATE_USAGE", help);
  if (action === "rollback" && values.source) throw coded("UPDATE_USAGE", "rollback does not accept --source");
  if (Number(process.versions.node.split(".")[0]) < 22) throw coded("UPDATE_NODE_REQUIRED", "Node.js 22 or newer is required");
  const root = await fs.realpath(values.root ?? defaultRoot);
  const data = await resolveDataRoot({ repositoryRoot: root, explicitRoot: values["data-root"] });
  const stateRoot = path.join(root, ".pptops-updates");
  const relativeData = path.relative(stateRoot, data.root);
  const relativeState = path.relative(data.root, stateRoot);
  if (![relativeData, relativeState].every((relative) => relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))) throw coded("PPT_OPS_LAYER_OVERLAP", "project data cannot overlap updater state");
  await assertTargetPath(root, ".pptops-updates/installed.json");
  await assertTargetPath(root, ".pptops-updates/backups");
  const stateFile = path.join(stateRoot, "installed.json");
  const previous = await readOptional(stateFile);
  const execute = services.command ?? command;
  const doctor = services.doctor ?? targetDoctor;
  let locked = false;
  let temporary;
  try {
    if (["apply", "rollback"].includes(action)) {
      await fs.mkdir(stateRoot, { recursive: true });
      try { await fs.mkdir(path.join(stateRoot, "lock")); locked = true; }
      catch (error) { if (error.code === "EEXIST") throw coded("UPDATE_LOCKED", "another update is active; see docs/system/updates.md for interrupted updates"); throw error; }
      // A state record read before another updater completed must not be used.
      if (JSON.stringify(await readOptional(stateFile)) !== JSON.stringify(previous)) throw coded("UPDATE_STATE_CHANGED", "update state changed; retry the command");
    }
    if (action === "rollback") {
      if (!previous?.backup) throw coded("UPDATE_NO_BACKUP", "no applied update is available to roll back");
      if (!/^[0-9a-f-]+$/.test(previous.backup)) throw coded("UPDATE_BACKUP_INVALID", "invalid backup identifier");
      const backupRoot = path.join(stateRoot, "backups", previous.backup);
      await assertTargetPath(root, `.pptops-updates/backups/${previous.backup}/manifest.json`);
      const record = JSON.parse(await fs.readFile(path.join(backupRoot, "manifest.json"), "utf8"));
      if (record.dependencies?.had_modules && !await exists(path.join(backupRoot, "node_modules"))) throw coded("UPDATE_BACKUP_INVALID", "dependency backup is missing");
      const result = await restoreBackup({ repositoryRoot: root, backupRoot });
      await restoreDependencies(root, backupRoot, record.dependencies);
      const oldState = await readOptional(path.join(backupRoot, "installed.json"));
      if (oldState) await writeJson(stateFile, oldState); else await fs.rm(stateFile, { force: true });
      const checked = await doctor(root);
      return { ...result, ok: checked.ok, doctor: checked };
    }
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-updater-"));
    const source = values.source ? path.resolve(values.source) : path.join(temporary, "source");
    let release = { source: "local" };
    if (!values.source) {
      release = await latestTestedCommit(services.fetch);
      await (services.download ?? downloadSystemSnapshot)(source, temporary, release.commit);
    }
    let baseline = previous?.files;
    if (!baseline) {
      try {
        const { stdout } = await execute("git", ["rev-parse", "--show-toplevel"], root);
        if (await fs.realpath(stdout.trim()) !== root) throw new Error("not the installation checkout");
        const baselineRoot = path.join(temporary, "baseline");
        await snapshot(root, baselineRoot);
        baseline = await fileManifest(baselineRoot);
      } catch (error) { throw coded("UPDATE_BASELINE_REQUIRED", `first update requires a Git checkout of PPT-Ops: ${error.message}`); }
    }
    const options = { repositoryRoot: root, sourceRoot: source, dataRoot: data.root, baseline };
    const preview = await previewUpdate(options);
    const incoming = JSON.parse(await fs.readFile(path.join(source, "package.json"), "utf8"));
    const current = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
    const summary = { command: `update-${action}`, current_version: current.version, target_version: incoming.version, ...release, update_available: preview.changes.length > 0, changes: preview.changes, conflicts: preview.conflicts };
    if (action !== "apply" || !preview.changes.length) return summary;
    if (preview.conflicts.length) throw coded("UPDATE_LOCAL_CHANGES", "commit or back up local system edits before updating", { paths: preview.conflicts });
    const backup = crypto.randomUUID();
    const backupRoot = path.join(stateRoot, "backups", backup);
    await fs.mkdir(backupRoot, { recursive: true });
    if (previous) await writeJson(path.join(backupRoot, "installed.json"), previous);
    // Install into staging first: failed downloads cannot damage this installation.
    const dependencyRoot = path.join(temporary, "dependencies");
    await fs.mkdir(dependencyRoot);
    for (const file of ["package.json", "package-lock.json"]) await fs.copyFile(path.join(source, file), path.join(dependencyRoot, file));
    await execute("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], dependencyRoot);
    const incomingModules = path.join(backupRoot, "incoming-node_modules");
    await fs.mkdir(path.join(dependencyRoot, "node_modules"), { recursive: true });
    await fs.cp(path.join(dependencyRoot, "node_modules"), incomingModules, { recursive: true, verbatimSymlinks: true });
    let dependencies;
    let applied = false;
    try {
      const files = await fileManifest(source);
      const result = await applyUpdate({ ...options, backupRoot, doctor: async () => {
        await assertTargetPath(root, "node_modules");
        dependencies = { had_modules: await exists(path.join(root, "node_modules")) };
        const recordPath = path.join(backupRoot, "manifest.json");
        await writeJson(recordPath, { ...await readOptional(recordPath), dependencies });
        if (dependencies.had_modules) await fs.rename(path.join(root, "node_modules"), path.join(backupRoot, "node_modules"));
        await fs.rename(incomingModules, path.join(root, "node_modules"));
        return doctor(root);
      } });
      applied = true;
      await writeJson(stateFile, { ...release, files, backup });
      return { ...summary, ...result };
    } catch (error) {
      if (applied) {
        await restoreBackup({ repositoryRoot: root, backupRoot, allowChanged: true });
        error.rolledBack = true;
      }
      if (dependencies && (!dependencies.had_modules || await exists(path.join(backupRoot, "node_modules")))) await restoreDependencies(root, backupRoot, dependencies);
      throw error;
    }
  } finally {
    if (temporary) await fs.rm(temporary, { recursive: true, force: true });
    if (locked) await fs.rmdir(path.join(stateRoot, "lock"));
  }
}

async function restoreDependencies(root, backupRoot, dependencies) {
  if (!dependencies) return;
  const saved = path.join(backupRoot, "node_modules");
  await assertTargetPath(root, "node_modules");
  if (dependencies.had_modules && !await exists(saved)) throw coded("UPDATE_BACKUP_INVALID", "dependency backup is missing");
  await fs.rm(path.join(root, "node_modules"), { recursive: true, force: true });
  if (dependencies.had_modules) await fs.rename(saved, path.join(root, "node_modules"));
}
async function exists(file) { try { await fs.lstat(file); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } }
async function readOptional(file) { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; } }
async function writeJson(file, value) { const temporary = `${file}.tmp`; await fs.writeFile(temporary, JSON.stringify(value, null, 2) + "\n"); await fs.rename(temporary, file); }

if (process.argv[1] && await fs.realpath(process.argv[1]).catch(() => undefined) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runUpdate(process.argv.slice(2));
    console.log(result.help ?? JSON.stringify(result, null, 2));
    if (result.ok === false) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, code: error.code ?? "UPDATE_FAILED", message: error.message, details: error.details, rolled_back: error.rolledBack ?? false }, null, 2));
    process.exitCode = 1;
  }
}
