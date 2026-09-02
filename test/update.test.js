import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { applyUpdate, previewUpdate } from "../src/update/index.js";

test("preview and apply change only declared System Layer paths", async (t) => {
  const fixture = await setup(t);
  await write(fixture.source, "package.json", JSON.stringify({ name: "ppt-ops", version: "1.0.1" }));
  await write(fixture.source, "src/core.js", "updated\n");
  await write(fixture.source, "docs/system/update.md", "new\n");
  const preview = await previewUpdate(fixture);
  assert.deepEqual(preview.changes.map(({ path: file, action }) => ({ file, action })), [
    { file: "docs/system/update.md", action: "create" },
    { file: "package.json", action: "replace" },
    { file: "src/core.js", action: "replace" }
  ]);
  const applied = await applyUpdate({ ...fixture, doctor: async () => ({ ok: true, status: "passed" }) });
  assert.equal(applied.ok, true);
  assert.equal(await fs.readFile(path.join(fixture.repository, "src/core.js"), "utf8"), "updated\n");
  assert.equal(await fs.readFile(path.join(fixture.repository, "config/profile.yml"), "utf8"), "private\n");
  assert.equal(await fs.readFile(path.join(fixture.repository, "projects/client/project.json"), "utf8"), "{}\n");
});

test("User and Project Layer update paths fail before mutation", async (t) => {
  const fixture = await setup(t);
  await write(fixture.source, "package.json", JSON.stringify({ name: "ppt-ops", version: "1.0.1" }));
  await write(fixture.source, "config/profile.yml", "overwrite\n");
  await assert.rejects(previewUpdate(fixture), { code: "PPT_OPS_UPDATE_TOUCHES_USER_DATA" });
  assert.equal(await fs.readFile(path.join(fixture.repository, "config/profile.yml"), "utf8"), "private\n");
});

test("failed post-update doctor restores replaced files and removes new files", async (t) => {
  const fixture = await setup(t);
  await write(fixture.source, "package.json", JSON.stringify({ name: "ppt-ops", version: "1.0.1" }));
  await write(fixture.source, "src/core.js", "broken\n");
  await write(fixture.source, "src/new.js", "new\n");
  await assert.rejects(applyUpdate({ ...fixture, doctor: async () => ({ ok: false, status: "failed" }) }), (error) => error.code === "POST_UPDATE_DOCTOR_FAILED" && error.rolledBack);
  assert.equal(await fs.readFile(path.join(fixture.repository, "src/core.js"), "utf8"), "current\n");
  await assert.rejects(fs.access(path.join(fixture.repository, "src/new.js")), { code: "ENOENT" });
});

test("incompatible major versions and symlinks are rejected", async (t) => {
  const fixture = await setup(t);
  await write(fixture.source, "package.json", JSON.stringify({ name: "ppt-ops", version: "2.0.0" }));
  await assert.rejects(previewUpdate(fixture), { code: "UPDATE_INCOMPATIBLE" });
  await write(fixture.source, "package.json", JSON.stringify({ name: "ppt-ops", version: "1.1.0" }));
  await fs.symlink(path.join(fixture.repository, "config/profile.yml"), path.join(fixture.source, "src-link"));
  await assert.rejects(previewUpdate(fixture), { code: "UPDATE_SYMLINK_FORBIDDEN" });
});

async function setup(t) {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "pptops-update-"));
  t.after(() => fs.rm(parent, { recursive: true, force: true }));
  const repository = path.join(parent, "repository");
  const source = path.join(parent, "source");
  await write(repository, "package.json", JSON.stringify({ name: "ppt-ops", version: "1.0.0" }));
  await write(repository, "src/core.js", "current\n");
  await write(repository, "config/profile.yml", "private\n");
  await write(repository, "projects/client/project.json", "{}\n");
  return { repositoryRoot: repository, repository, sourceRoot: source, source, dataRoot: path.join(repository, "projects") };
}
async function write(root, relative, contents) { const file = path.join(root, relative); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, contents); }
