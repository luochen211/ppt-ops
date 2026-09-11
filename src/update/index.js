import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertSystemUpdatePaths, createLayerManifest, resolveDataRoot } from "../config/data-contract.js";

const execute = promisify(execFile);

export async function previewUpdate({ repositoryRoot, sourceRoot, dataRoot, baseline }) {
  const target = await fs.realpath(repositoryRoot);
  const source = await fs.realpath(sourceRoot);
  if (source === target) throw coded("UPDATE_SOURCE_INVALID", "source and target must be different directories");
  const resolved = await resolveDataRoot({ repositoryRoot: target, explicitRoot: dataRoot });
  const manifest = resolved.manifest;
  await assertCompatible(target, source);
  const files = await listFiles(source);
  const removed = baseline ? Object.keys(baseline).filter((file) => !files.includes(file)) : [];
  assertSystemUpdatePaths([...files, ...removed], manifest);
  const changes = [];
  const conflicts = [];
  for (const relative of [...files, ...removed]) {
    await assertTargetPath(target, relative);
    const incoming = removed.includes(relative) ? undefined : await describe(path.join(source, relative));
    const current = await describeOptional(path.join(target, relative));
    if (incoming?.sha256 === current?.sha256 && incoming?.mode === current?.mode) continue;
    const change = { path: relative, action: !incoming ? "delete" : current ? "replace" : "create", before: current, after: incoming };
    changes.push(change);
    if (baseline && (baseline[relative] ? current?.sha256 !== baseline[relative].sha256 || current?.mode !== baseline[relative].mode : current !== undefined)) {
      conflicts.push(relative);
    }
  }
  return { command: "update-preview", compatible: true, repository_root: target, source_root: source, data_root: resolved.root, changes, conflicts };
}

export async function applyUpdate(options) {
  const preview = await previewUpdate(options);
  if (preview.conflicts.length) throw coded("UPDATE_LOCAL_CHANGES", "locally changed system files would be overwritten", { paths: preview.conflicts });
  const backupRoot = options.backupRoot ?? await fs.mkdtemp(path.join(os.tmpdir(), "pptops-update-backup-"));
  await fs.mkdir(backupRoot, { recursive: true });
  const record = { repository_root: preview.repository_root, data_root: preview.data_root, changes: preview.changes, status: "prepared" };
  // Complete the durable backup before modifying any target file.
  for (const change of preview.changes) {
    if (change.before) {
      const backup = path.join(backupRoot, "files", change.path);
      await fs.mkdir(path.dirname(backup), { recursive: true });
      await fs.copyFile(path.join(preview.repository_root, change.path), backup);
      await fs.chmod(backup, change.before.mode);
    }
  }
  await writeRecord(backupRoot, record);
  try {
    for (const change of preview.changes) {
      const destination = path.join(preview.repository_root, change.path);
      if (change.action === "delete") await fs.rm(destination);
      else await atomicCopy(path.join(preview.source_root, change.path), destination, change.after.mode);
    }
    const doctor = await (options.doctor ?? (() => targetDoctor(preview.repository_root)))();
    if (!doctor.ok) throw coded("POST_UPDATE_DOCTOR_FAILED", "post-update doctor failed", { doctor });
    record.status = "applied";
    await writeRecord(backupRoot, { ...JSON.parse(await fs.readFile(path.join(backupRoot, "manifest.json"), "utf8")), ...record });
    return { command: "update-apply", ok: true, changes: preview.changes, backup_root: backupRoot, doctor };
  } catch (error) {
    await restoreBackup({ repositoryRoot: preview.repository_root, backupRoot, allowChanged: true });
    if (!error.code) error.code = "UPDATE_APPLY_FAILED";
    error.rolledBack = true;
    throw error;
  }
}

export async function restoreBackup({ repositoryRoot, backupRoot, allowChanged = false }) {
  const target = await fs.realpath(repositoryRoot);
  const record = JSON.parse(await fs.readFile(path.join(backupRoot, "manifest.json"), "utf8"));
  if (record.repository_root !== target) throw coded("UPDATE_BACKUP_INVALID", "backup belongs to another installation");
  const resolved = await resolveDataRoot({ repositoryRoot: target });
  for (const dataRoot of [resolved.root, record.data_root]) {
    assertSystemUpdatePaths(record.changes.map((change) => change.path), createLayerManifest({ repositoryRoot: target, dataRoot }));
  }
  // Validate the entire restore before writing, including backup integrity.
  for (const change of record.changes) {
    await assertTargetPath(target, change.path);
    if (change.before) {
      await assertTargetPath(path.join(backupRoot, "files"), change.path);
      const backup = await describe(path.join(backupRoot, "files", change.path));
      if (backup.sha256 !== change.before.sha256) throw coded("UPDATE_BACKUP_INVALID", `backup checksum mismatch: ${change.path}`);
    }
    if (!allowChanged) {
      const current = await describeOptional(path.join(target, change.path));
      if (current?.sha256 !== change.after?.sha256 || current?.mode !== change.after?.mode) throw coded("UPDATE_LOCAL_CHANGES", `file changed since update: ${change.path}`);
    }
  }
  for (const change of [...record.changes].reverse()) {
    const destination = path.join(target, change.path);
    if (change.before) await atomicCopy(path.join(backupRoot, "files", change.path), destination, change.before.mode);
    else await fs.rm(destination, { force: true });
  }
  await writeRecord(backupRoot, { ...record, status: "rolled_back" });
  return { command: "update-rollback", ok: true, restored: record.changes.map((change) => change.path) };
}

export async function targetDoctor(root) {
  const { stdout } = await execute(process.execPath, ["src/cli.js", "doctor"], { cwd: root, timeout: 60000 });
  return JSON.parse(stdout);
}

export async function assertTargetPath(root, relative) {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).some((part) => ["", ".", ".."].includes(part))) throw coded("UPDATE_PATH_INVALID", `invalid path: ${relative}`);
  let current = root;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw coded("UPDATE_SYMLINK_FORBIDDEN", `update target contains a symbolic link: ${current}`);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

async function assertCompatible(repositoryRoot, sourceRoot) {
  const [current, incoming] = await Promise.all([readPackage(repositoryRoot), readPackage(sourceRoot)]);
  if (current.name !== "ppt-ops" || incoming.name !== "ppt-ops") throw coded("UPDATE_PACKAGE_INVALID", "update source and target must be ppt-ops packages");
  if (String(current.version).split(".")[0] !== String(incoming.version).split(".")[0]) throw coded("UPDATE_INCOMPATIBLE", `major version mismatch: ${current.version} -> ${incoming.version}`);
}
async function readPackage(root) {
  try { return JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")); }
  catch (error) { throw coded("UPDATE_PACKAGE_INVALID", `cannot read package.json: ${error.message}`); }
}
export async function listFiles(root, current = root) {
  const entries = await fs.readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(current, entry.name);
    if (entry.isSymbolicLink()) throw coded("UPDATE_SYMLINK_FORBIDDEN", `update source contains a symbolic link: ${path.relative(root, absolute)}`);
    if (entry.isDirectory()) files.push(...await listFiles(root, absolute));
    else if (entry.isFile()) files.push(path.relative(root, absolute));
    else throw coded("UPDATE_FILE_INVALID", `unsupported file: ${absolute}`);
  }
  return files;
}
export async function describe(file) {
  const [contents, stat] = await Promise.all([fs.readFile(file), fs.stat(file)]);
  return { bytes: contents.byteLength, sha256: crypto.createHash("sha256").update(contents).digest("hex"), mode: stat.mode & 0o777 };
}
async function describeOptional(file) { try { return await describe(file); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; } }
async function atomicCopy(source, destination, mode) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.update-${crypto.randomUUID()}`;
  try {
    await fs.copyFile(source, temporary);
    await fs.chmod(temporary, mode);
    await fs.rename(temporary, destination);
  } finally { await fs.rm(temporary, { force: true }); }
}
async function writeRecord(root, record) {
  const temporary = path.join(root, "manifest.json.tmp");
  await fs.writeFile(temporary, JSON.stringify(record, null, 2) + "\n");
  await fs.rename(temporary, path.join(root, "manifest.json"));
}
export function coded(code, message, details) { const error = new Error(message); error.code = code; error.details = details; return error; }
