import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  assertSystemUpdatePaths,
  createLayerManifest,
  findRepositoryRoot,
  mergeConfigLayers,
  resolveContained,
  resolveDataRoot,
  resolveProjectRoot
} from "../src/config/data-contract.js";

async function repositoryFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-data-contract-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ name: "ppt-ops" }));
  return root;
}

test("data root precedence is explicit, environment, marker, then repository default", async (t) => {
  const repositoryRoot = await repositoryFixture(t);
  await fs.writeFile(path.join(repositoryRoot, ".ppt-ops-data"), "marker-data\n");

  assert.deepEqual(pick(await resolveDataRoot({ repositoryRoot, explicitRoot: "cli-data", env: { PPT_OPS_ROOT: "env-data" } })), { root: path.join(repositoryRoot, "cli-data"), source: "explicit" });
  assert.deepEqual(pick(await resolveDataRoot({ repositoryRoot, env: { PPT_OPS_ROOT: "env-data" } })), { root: path.join(repositoryRoot, "env-data"), source: "environment" });
  assert.deepEqual(pick(await resolveDataRoot({ repositoryRoot, env: {} })), { root: path.join(repositoryRoot, "marker-data"), source: "marker" });
  await fs.rm(path.join(repositoryRoot, ".ppt-ops-data"));
  assert.deepEqual(pick(await resolveDataRoot({ repositoryRoot, env: {} })), { root: path.join(repositoryRoot, "projects"), source: "repository-default" });
});

test("repository and data-root resolution stay stable from nested working directories", async (t) => {
  const repositoryRoot = await repositoryFixture(t);
  const nested = path.join(repositoryRoot, "src", "deep");
  await fs.mkdir(nested, { recursive: true });
  assert.equal(await findRepositoryRoot(nested), repositoryRoot);
  assert.equal((await resolveDataRoot({ cwd: nested, env: {} })).root, path.join(repositoryRoot, "projects"));
});

test("project paths and contained writes reject absolute and parent escapes", async () => {
  const root = path.resolve("/tmp/pptops-projects");
  assert.equal(resolveProjectRoot(root, "launch/deck"), path.join(root, "launch/deck"));
  assert.equal(resolveProjectRoot(root, "..drafts/deck"), path.join(root, "..drafts/deck"));
  assert.throws(() => resolveProjectRoot(root, "../private"), { code: "PPT_OPS_PATH_ESCAPE" });
  assert.throws(() => resolveProjectRoot(root, path.resolve("/private/deck")), { code: "PPT_OPS_PATH_ESCAPE" });
  assert.throws(() => resolveContained(root, "deck/../../private"), { code: "PPT_OPS_PATH_ESCAPE" });
});

test("layer manifests reject overlap and protect user-owned paths from updates", async (t) => {
  const repositoryRoot = await repositoryFixture(t);
  const manifest = createLayerManifest({ repositoryRoot, dataRoot: path.join(repositoryRoot, "projects") });
  assert.doesNotThrow(() => assertSystemUpdatePaths(["src/config/data-contract.js", "package.json"], manifest));
  assert.throws(() => assertSystemUpdatePaths(["config/profile.yml"], manifest), { code: "PPT_OPS_UPDATE_TOUCHES_USER_DATA" });
  assert.throws(() => assertSystemUpdatePaths(["projects/client/project.json"], manifest), { code: "PPT_OPS_UPDATE_TOUCHES_USER_DATA" });
  assert.throws(() => createLayerManifest({ repositoryRoot, dataRoot: path.join(repositoryRoot, "src", "projects") }), { code: "PPT_OPS_LAYER_OVERLAP" });
});

test("configuration precedence is profile, custom, project, then invocation", () => {
  const merged = mergeConfigLayers({
    profile: { brand: { font: "Aptos", accent: "blue" }, pages: 10 },
    custom: { brand: { accent: "orange" }, pages: 12, output: "pptx" },
    project: { pages: 18, audience: "founders" },
    invocation: { pages: 6 }
  });
  assert.deepEqual(merged, { brand: { font: "Aptos", accent: "orange" }, pages: 6, output: "pptx", audience: "founders" });
});

function pick({ root, source }) {
  return { root, source };
}
