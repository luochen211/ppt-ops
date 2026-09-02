import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertSystemUpdatePaths, createLayerManifest } from "../config/data-contract.js";
import { runDoctor } from "../doctor/index.js";

export async function previewUpdate({ repositoryRoot, sourceRoot, dataRoot = path.join(repositoryRoot, "projects") }) {
  const target = path.resolve(repositoryRoot);
  const source = path.resolve(sourceRoot);
  const manifest = createLayerManifest({ repositoryRoot: target, dataRoot });
  await assertCompatible(target, source);
  const files = await listFiles(source);
  assertSystemUpdatePaths(files, manifest);
  const changes = [];
  for (const relative of files) {
    const incoming = await describe(path.join(source, relative));
    const current = await describeOptional(path.join(target, relative));
    if (incoming.sha256 !== current?.sha256) changes.push({ path: relative, action: current ? "replace" : "create", before: current, after: incoming });
  }
  return { command: "update-preview", compatible: true, repository_root: target, source_root: source, changes };
}

export async function applyUpdate(options) {
  const preview = await previewUpdate(options);
  const backupRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-update-backup-"));
  const created = [];
  const backedUp = [];
  try {
    for (const change of preview.changes) {
      const source = path.join(preview.source_root, change.path);
      const destination = path.join(preview.repository_root, change.path);
      if (change.action === "replace") {
        const backup = path.join(backupRoot, change.path);
        await fs.mkdir(path.dirname(backup), { recursive: true });
        await fs.copyFile(destination, backup);
        backedUp.push(change.path);
      } else created.push(change.path);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      const temporary = `${destination}.update-${crypto.randomUUID()}`;
      await fs.copyFile(source, temporary);
      await fs.rename(temporary, destination);
    }
    const doctor = await (options.doctor ?? (() => runDoctor()))();
    if (!doctor.ok) throw coded("POST_UPDATE_DOCTOR_FAILED", "post-update doctor failed", { doctor });
    return { command: "update-apply", ok: true, changes: preview.changes, backup_root: backupRoot, doctor };
  } catch (error) {
    await rollbackUpdate({ repositoryRoot: preview.repository_root, backupRoot, backedUp, created });
    if (!error.code) error.code = "UPDATE_APPLY_FAILED";
    error.rolledBack = true;
    throw error;
  }
}

export async function rollbackUpdate({ repositoryRoot, backupRoot, backedUp, created }) {
  for (const relative of [...created].reverse()) await fs.rm(path.join(repositoryRoot, relative), { force: true });
  for (const relative of [...backedUp].reverse()) {
    const source = path.join(backupRoot, relative);
    const destination = path.join(repositoryRoot, relative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(source, destination);
  }
  return { command: "update-rollback", ok: true, restored: backedUp, removed: created };
}

async function assertCompatible(repositoryRoot, sourceRoot) {
  const [current, incoming] = await Promise.all([readPackage(repositoryRoot), readPackage(sourceRoot)]);
  if (current.name !== "ppt-ops" || incoming.name !== "ppt-ops") throw coded("UPDATE_PACKAGE_INVALID", "update source and target must be ppt-ops packages");
  const currentMajor = String(current.version).split(".")[0];
  const incomingMajor = String(incoming.version).split(".")[0];
  if (currentMajor !== incomingMajor) throw coded("UPDATE_INCOMPATIBLE", `major version mismatch: ${current.version} -> ${incoming.version}`);
}
async function readPackage(root) {
  try { return JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")); }
  catch (error) { throw coded("UPDATE_PACKAGE_INVALID", `cannot read package.json: ${error.message}`); }
}
async function listFiles(root, current = root) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(current, entry.name);
    if (entry.isSymbolicLink()) throw coded("UPDATE_SYMLINK_FORBIDDEN", `update source contains a symbolic link: ${path.relative(root, absolute)}`);
    if (entry.isDirectory()) files.push(...await listFiles(root, absolute));
    else if (entry.isFile()) files.push(path.relative(root, absolute));
  }
  return files;
}
async function describe(file) {
  const contents = await fs.readFile(file);
  return { bytes: contents.byteLength, sha256: crypto.createHash("sha256").update(contents).digest("hex") };
}
async function describeOptional(file) { try { return await describe(file); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; } }
function coded(code, message, details) { const error = new Error(message); error.code = code; error.details = details; return error; }
