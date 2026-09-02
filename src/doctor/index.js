import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readProject } from "../core/project.js";
import { InfrastructureStore } from "../infrastructure/store.js";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export async function runDoctor(projectDir) {
  const checks = [];
  const packageJson = JSON.parse(await fs.readFile(path.join(repositoryRoot, "package.json"), "utf8"));
  const routing = JSON.parse(await fs.readFile(path.join(repositoryRoot, ".agents/skills/ppt-agent/references/routing-contract.json"), "utf8"));
  checks.push(check("skill-core-contract", "required", routing.contract_version === "1.0", { skill: routing.contract_version, core: "1.0" }, "Regenerate or migrate the PPT Agent routing contract."));
  checks.push(check("node-runtime", "required", Number(process.versions.node.split(".")[0]) >= 22, { version: process.versions.node }, "Install Node.js 22 or newer."));
  for (const dependency of Object.keys(packageJson.dependencies ?? {})) {
    try {
      await import.meta.resolve(dependency);
      checks.push(check(`dependency:${dependency}`, "required", true, {}, `Run npm ci to install ${dependency}.`));
    } catch {
      checks.push(check(`dependency:${dependency}`, "required", false, {}, `Run npm ci to install ${dependency}.`));
    }
  }
  checks.push(await optionalPathCheck("microsoft-powerpoint", "/Applications/Microsoft PowerPoint.app", "Install Microsoft PowerPoint for real-PowerPoint acceptance."));
  checks.push(await optionalCommandCheck("libreoffice", ["/Applications/LibreOffice.app", "/opt/homebrew/bin/libreoffice", "/usr/local/bin/libreoffice"], "Install LibreOffice to enable fallback rendering."));

  let project;
  if (projectDir) {
    try {
      project = await readProject(projectDir);
      checks.push(check("project-contract", "required", project.contractModel === "v1", { model: project.contractModel }, "Migrate the project to V1."));
      checks.push(check("portable-truth", "required", await hasPortableTruth(project.root), {}, "Run formal commands to create portable Version, Build, Review, and Handoff manifests."));
    } catch (error) {
      checks.push(check("project-readable", "required", false, { message: error.message }, "Verify the project path and contracts."));
    }
  }
  const failed = checks.filter((item) => item.required && item.status === "failed");
  const degraded = checks.filter((item) => !item.required && item.status !== "passed");
  return { command: "doctor", ok: failed.length === 0, status: failed.length ? "failed" : degraded.length ? "degraded" : "passed", project: project?.project.name, checks };
}

export async function reindexProject(projectDir) {
  const project = await readProject(projectDir);
  if (project.contractModel !== "v1") throw coded("V1_PROJECT_REQUIRED", "reindex requires a V1 project");
  const databaseFile = path.join(project.root, ".pptops", "metadata.sqlite");
  await removeDatabaseFiles(databaseFile);
  const store = new InfrastructureStore(databaseFile);
  const counts = { version: 0, build: 0, review: 0, handoff: 0 };
  try {
    store.registerProject({ id: project.project.name, root: project.root, title: project.project.title });
    for (const version of await readManifests(project.root, "versions")) {
      replayEntity(store, project.project.name, version, ["draft", "approval_pending", "approved", "frozen"]);
      counts.version += 1;
    }
    for (const build of await readManifests(project.root, "builds")) {
      store.enqueueBuild({ ...build, state: "queued" });
      store.claimNextBuild();
      for (const state of ["rendering", "validating", build.state]) if (state !== "queued" && store.getBuild(build.id).state !== state) store.transitionBuild(build.id, state);
      counts.build += 1;
    }
    for (const review of await readManifests(project.root, "reviews")) {
      replayEntity(store, project.project.name, review, ["automated_pending", "automated_complete", "human_pending", review.state]);
      counts.review += 1;
    }
    for (const handoff of await readManifests(project.root, "handoffs")) {
      let current = store.createHandoff(project.project.name, { ...handoff, state: "preparing" });
      for (const state of ["packaged", "verified", handoff.state]) {
        if (current.state !== state) current = store.saveEntity(project.project.name, { ...withoutRevision(current), state });
      }
      counts.handoff += 1;
    }
    return { command: "reindex", ok: true, project: project.project.name, counts };
  } finally { store.close(); }
}

async function readManifests(root, plural) {
  const directory = path.join(root, ".pptops", plural);
  let entries;
  try { entries = await fs.readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === "ENOENT") return []; throw error; }
  const values = [];
  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    try { values.push(JSON.parse(await fs.readFile(path.join(directory, entry.name, "manifest.json"), "utf8"))); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  return values;
}

function replayEntity(store, projectId, final, states) {
  let current;
  for (const state of [...new Set(states)]) {
    if (!state) continue;
    current = store.saveEntity(projectId, { ...withoutRevision(final), state });
    if (state === final.state) break;
  }
  return current;
}
async function removeDatabaseFiles(file) { await Promise.all(["", "-wal", "-shm"].map((suffix) => fs.rm(`${file}${suffix}`, { force: true }))); }
async function hasPortableTruth(root) {
  const versions = await readManifests(root, "versions");
  return versions.length > 0;
}
function check(id, required, passed, evidence, action) { return { id, required: required === "required", status: passed ? "passed" : required === "required" ? "failed" : "pending", evidence, action: passed ? undefined : action }; }
async function optionalPathCheck(id, target, action) { try { await fs.access(target); return check(id, "optional", true, { path: target }, action); } catch { return check(id, "optional", false, { path: target }, action); } }
async function optionalCommandCheck(id, targets, action) {
  for (const target of targets) try { await fs.access(target); return check(id, "optional", true, { path: target }, action); } catch {}
  return check(id, "optional", false, { searched: targets }, action);
}
function withoutRevision({ revision, ...value }) { return value; }
function coded(code, message) { const error = new Error(message); error.code = code; return error; }
