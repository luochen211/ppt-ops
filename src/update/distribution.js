import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SYSTEM_PATHS } from "../config/data-contract.js";
import { coded, describe, listFiles } from "./index.js";

const execute = promisify(execFile);
export const REPOSITORY = "luochen211/ppt-ops";

export async function command(file, args, cwd) {
  return execute(file, args, { cwd, timeout: 300000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
}
export async function systemFiles(repositoryRoot, ref = "HEAD") {
  const { stdout } = await command("git", ["ls-tree", "-r", "-z", ref], repositoryRoot);
  return stdout.split("\0").filter(Boolean).flatMap((entry) => {
    const separator = entry.indexOf("\t");
    const file = entry.slice(separator + 1);
    if (!SYSTEM_PATHS.some((root) => file === root || file.startsWith(`${root}/`))) return [];
    if (!/^100(644|755) blob /.test(entry)) throw coded("UPDATE_FILE_INVALID", `system tree contains a symlink or unsupported file: ${file}`);
    return [file];
  });
}
export async function buildSystemArchive({ repositoryRoot, outputFile, ref = "HEAD" }) {
  const files = await systemFiles(repositoryRoot, ref);
  if (!files.includes("package.json")) throw coded("UPDATE_PACKAGE_INVALID", "system tree has no package.json");
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await command("git", ["archive", "--format=tar.gz", `--output=${path.resolve(outputFile)}`, ref, "--", ...files], repositoryRoot);
  const archive = await describe(outputFile);
  await fs.writeFile(`${outputFile}.sha256`, `${archive.sha256}  ${path.basename(outputFile)}\n`);
  return { archive: outputFile, sha256: archive.sha256, files: files.length };
}
export async function snapshot(repositoryRoot, destination, ref = "HEAD") {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-snapshot-"));
  try {
    const outputFile = path.join(temporary, "system.tar.gz");
    await buildSystemArchive({ repositoryRoot, outputFile, ref });
    await fs.mkdir(destination, { recursive: true });
    await command("tar", ["-xzf", outputFile, "-C", destination], repositoryRoot);
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
export async function fileManifest(root) {
  const result = {};
  for (const file of await listFiles(root)) result[file] = await describe(path.join(root, file));
  return result;
}
export async function latestTestedCommit(fetchImpl = fetch) {
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "ppt-ops-updater", "X-GitHub-Api-Version": "2022-11-28" };
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetchImpl(`https://api.github.com/repos/${REPOSITORY}/actions/workflows/ci.yml/runs?branch=main&event=push&status=success&per_page=1`, { headers, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw coded("UPDATE_NETWORK_FAILED", `GitHub returned HTTP ${response.status}; retry later or use --source`);
  const run = (await response.json()).workflow_runs?.[0];
  if (run?.conclusion !== "success" || run?.head_branch !== "main" || !/^[a-f0-9]{40}$/.test(run?.head_sha)) throw coded("UPDATE_NO_TESTED_COMMIT", "no successful main CI run is available");
  return { commit: run.head_sha, ci_url: run.html_url };
}
export async function downloadSystemSnapshot(destination, temporary, commit) {
  const gitRoot = path.join(temporary, "remote");
  await fs.mkdir(gitRoot);
  await command("git", ["init", "--bare", "--quiet"], gitRoot);
  await command("git", ["fetch", "--quiet", "--depth=1", "--filter=blob:none", `https://github.com/${REPOSITORY}.git`, commit], gitRoot);
  await snapshot(gitRoot, destination, "FETCH_HEAD");
}
