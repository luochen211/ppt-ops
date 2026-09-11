import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runUpdate } from "../update.mjs";
import { command, buildSystemArchive, latestTestedCommit, snapshot } from "../src/update/distribution.js";
import { describe } from "../src/update/index.js";

const services = { doctor: async () => ({ ok: true }) };

test("the CLI executes when launched through a symlink path", async (t) => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-entry-test-"));
  t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const entry = path.join(temporary, "update-link.mjs");
  await fs.symlink(fileURLToPath(new URL("../update.mjs", import.meta.url)), entry);
  const { stdout } = await command(process.execPath, [entry, "--help"], temporary);
  assert.match(stdout, /PPT-Ops system updater/);
});

test("CLI applies same-version system changes, deletes retired files, preserves private data and rolls back", async (t) => {
  const f = await fixture(t);
  await write(f.upstream, "src/current.js", "new\n");
  await write(f.upstream, "src/added.js", "added\n");
  await fs.rm(path.join(f.upstream, "src/retired.js"));
  await commit(f.upstream);
  await snapshot(f.upstream, f.source);
  const args = ["--root", f.target, "--source", f.source];
  const preview = await runUpdate(["preview", ...args], services);
  assert.equal(preview.current_version, preview.target_version);
  assert.equal(preview.update_available, true);
  assert.deepEqual(preview.conflicts, []);
  assert.equal(preview.changes.find((change) => change.path === "src/retired.js").action, "delete");
  await assert.rejects(fs.access(path.join(f.target, ".pptops-updates")), { code: "ENOENT" });
  const applied = await runUpdate(["apply", ...args], services);
  assert.equal(applied.ok, true);
  assert.equal(await read(f.target, "src/current.js"), "new\n");
  await assert.rejects(fs.access(path.join(f.target, "src/retired.js")), { code: "ENOENT" });
  assert.equal((await runUpdate(["check", ...args], services)).update_available, false);
  for (const file of ["projects/client/brief.md", "templates/user/custom.md", "config/profile.yml", "acceptance/private.md", "src/local-only.js"]) assert.equal(await read(f.target, file), "private\n");
  assert.equal((await runUpdate(["rollback", "--root", f.target], services)).ok, true);
  assert.equal(await read(f.target, "src/current.js"), "old\n");
  assert.equal(await read(f.target, "src/retired.js"), "retired\n");
  assert.equal(await read(f.target, "node_modules/old-marker"), "original dependencies\n");
  await assert.rejects(fs.access(path.join(f.target, "src/added.js")), { code: "ENOENT" });
  const { stdout } = await command("git", ["status", "--porcelain", "--untracked-files=no"], f.target);
  assert.equal(stdout, "");
});

test("CLI detects local edits and untracked collisions before mutation", async (t) => {
  const f = await fixture(t);
  await write(f.target, "src/current.js", "local changes\n");
  await write(f.upstream, "src/current.js", "new\n");
  await write(f.upstream, "src/local-only.js", "incoming\n");
  await commit(f.upstream);
  await snapshot(f.upstream, f.source);
  const args = ["--root", f.target, "--source", f.source];
  const preview = await runUpdate(["preview", ...args], services);
  assert.deepEqual(preview.conflicts.sort(), ["src/current.js", "src/local-only.js"]);
  await assert.rejects(runUpdate(["apply", ...args], services), { code: "UPDATE_LOCAL_CHANGES" });
  assert.equal(await read(f.target, "src/current.js"), "local changes\n");
  assert.equal(await read(f.target, "node_modules/old-marker"), "original dependencies\n");
});

test("failed target Doctor restores files and dependency tree", async (t) => {
  const f = await fixture(t);
  await write(f.upstream, "src/current.js", "new\n");
  await commit(f.upstream);
  await snapshot(f.upstream, f.source);
  await assert.rejects(runUpdate(["apply", "--root", f.target, "--source", f.source], { doctor: async () => ({ ok: false }) }), (error) => error.code === "POST_UPDATE_DOCTOR_FAILED" && error.rolledBack);
  assert.equal(await read(f.target, "src/current.js"), "old\n");
  assert.equal(await read(f.target, "node_modules/old-marker"), "original dependencies\n");
  await assert.rejects(fs.access(path.join(f.target, ".pptops-updates/installed.json")), { code: "ENOENT" });
});

test("dependency installation failure leaves target intact and releases the lock", async (t) => {
  const f = await fixture(t);
  await write(f.upstream, "src/current.js", "new\n");
  await commit(f.upstream);
  await snapshot(f.upstream, f.source);
  await assert.rejects(runUpdate(["apply", "--root", f.target, "--source", f.source], {
    ...services, command: async (file, args, cwd) => { if (file === "npm") throw new Error("install failed"); return command(file, args, cwd); }
  }), /install failed/);
  assert.equal(await read(f.target, "src/current.js"), "old\n");
  assert.equal(await read(f.target, "node_modules/old-marker"), "original dependencies\n");
  await assert.rejects(fs.access(path.join(f.target, ".pptops-updates/lock")), { code: "ENOENT" });
});

test("rollback refuses edits made after the update", async (t) => {
  const f = await fixture(t);
  await write(f.upstream, "src/current.js", "new\n");
  await commit(f.upstream);
  await snapshot(f.upstream, f.source);
  await runUpdate(["apply", "--root", f.target, "--source", f.source], services);
  await write(f.target, "src/current.js", "after update\n");
  await assert.rejects(runUpdate(["rollback", "--root", f.target], services), { code: "UPDATE_LOCAL_CHANGES" });
  assert.equal(await read(f.target, "src/current.js"), "after update\n");
});

test("package contains only tracked System Layer files and a matching SHA-256", async (t) => {
  const f = await fixture(t);
  const outputFile = path.join(f.parent, "dist/system.tar.gz");
  const built = await buildSystemArchive({ repositoryRoot: f.upstream, outputFile });
  const { stdout } = await command("tar", ["-tzf", outputFile], f.parent);
  assert.match(stdout, /src\/current.js/);
  assert.match(stdout, /package-lock.json/);
  assert.doesNotMatch(stdout, /projects\/|templates\/user\/|config\/|node_modules\/|local-only/);
  assert.equal(built.sha256, (await describe(outputFile)).sha256);
  assert.equal(await fs.readFile(`${outputFile}.sha256`, "utf8"), `${built.sha256}  system.tar.gz\n`);
});

test("online source is pinned to the successful main CI SHA", async () => {
  const commit = "a".repeat(40);
  const result = await latestTestedCommit(async (url) => {
    assert.match(url, /branch=main&event=push&status=success/);
    return { ok: true, json: async () => ({ workflow_runs: [{ head_sha: commit, head_branch: "main", conclusion: "success", html_url: "https://github.com/luochen211/ppt-ops/actions/runs/1" }] }) };
  });
  assert.equal(result.commit, commit);
  await assert.rejects(latestTestedCommit(async () => ({ ok: false, status: 403 })), { code: "UPDATE_NETWORK_FAILED" });
  await assert.rejects(latestTestedCommit(async () => ({ ok: true, json: async () => ({ workflow_runs: [] }) })), { code: "UPDATE_NO_TESTED_COMMIT" });
});

test("lock and project-data overlap fail without touching source files", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.target, ".pptops-updates/lock"), { recursive: true });
  await assert.rejects(runUpdate(["apply", "--root", f.target, "--source", f.source]), { code: "UPDATE_LOCKED" });
  await assert.rejects(runUpdate(["check", "--root", f.target, "--data-root", "src"]), { code: "PPT_OPS_LAYER_OVERLAP" });
  await assert.rejects(runUpdate(["check", "--root", f.target, "--data-root", ".pptops-updates/client"]), { code: "PPT_OPS_LAYER_OVERLAP" });
});

async function fixture(t) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-updater-test-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const upstream = path.join(parent, "upstream");
  const target = path.join(parent, "installation with spaces");
  const source = path.join(parent, "source");
  await fs.mkdir(upstream);
  await command("git", ["init", "--quiet"], upstream);
  const pkg = { name: "ppt-ops", version: "1.0.0", type: "module" };
  await write(upstream, "package.json", JSON.stringify(pkg));
  await write(upstream, "package-lock.json", JSON.stringify({ ...pkg, lockfileVersion: 3, packages: { "": pkg } }));
  await write(upstream, "src/current.js", "old\n");
  await write(upstream, "src/retired.js", "retired\n");
  await write(upstream, "projects/public/brief.md", "excluded\n");
  await write(upstream, "templates/user/public.md", "excluded\n");
  await commit(upstream);
  await command("git", ["clone", "--quiet", upstream, target], parent);
  for (const file of ["projects/client/brief.md", "templates/user/custom.md", "config/profile.yml", "acceptance/private.md", "src/local-only.js"]) await write(target, file, "private\n");
  await write(target, "node_modules/old-marker", "original dependencies\n");
  return { parent, upstream, target, source };
}
async function commit(root) { await command("git", ["add", "."], root); await command("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "test fixture"], root); }
async function write(root, relative, contents) { const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, contents); }
async function read(root, file) { return fs.readFile(path.join(root, file), "utf8"); }
