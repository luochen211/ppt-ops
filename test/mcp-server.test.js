import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { ApplicationService } from "../src/application/service.js";
import { createV1Entity } from "../src/contracts/v1.js";
import { initializeProject } from "../src/core/init.js";
import { isMainModule, resolveProjectDirectory } from "../src/mcp/server.js";

const serverEntry = path.resolve("src/mcp/server.js");

test("MCP stdio server exposes and calls all five read-only tools without changing running work", async (t) => {
  const projectDir = await fixture(t);
  const service = await ApplicationService.open(projectDir);
  const candidate = await service.proposeCandidate({
    targetKind: "page_spec", targetId: "page-001", baseRevision: 1,
    patch: { task: "MCP candidate", tokens: { accent: "#123456" }, api_key: "do-not-return", root_path: "do-not-return" }
  });
  service.store.saveEntity(service.projectId, createV1Entity("version", "version-mcp", {
    state: "frozen", snapshot_hash: "a".repeat(64), component_hashes: {}
  }));
  service.store.enqueueBuild(createV1Entity("build", "build-running", {
    project_id: service.projectId, version_id: "version-mcp", state: "queued", targets: ["pptx"], attempts: [], config: {}
  }));
  service.store.claimNextBuild();
  service.store.transitionBuild("build-running", "rendering");
  service.store.saveEntity(service.projectId, createV1Entity("review", "review-mcp", {
    build_id: "build-running", state: "human_pending", automated: [], human: []
  }));
  const before = service.buildStatus("build-running");
  service.close();

  const client = new Client({ name: "ppt-ops-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverEntry, "--project-dir", projectDir],
    cwd: path.resolve("."),
    stderr: "pipe"
  });
  t.after(async () => client.close());
  await client.connect(transport);

  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [
    "pptops_build_create",
    "pptops_build_status",
    "pptops_candidate_diff",
    "pptops_delivery_capabilities",
    "pptops_handoff_create",
    "pptops_project_inspect",
    "pptops_review_inspect",
    "pptops_review_run",
    "pptops_source_import"
  ]);
  assert.ok(listed.tools.filter(({ name }) => !["pptops_source_import", "pptops_build_create", "pptops_review_run", "pptops_handoff_create"].includes(name)).every((tool) => tool.annotations?.readOnlyHint === true));
  assert.ok(listed.tools.filter(({ name }) => ["pptops_source_import", "pptops_build_create", "pptops_review_run", "pptops_handoff_create"].includes(name)).every((tool) => tool.annotations?.readOnlyHint === false));

  const result = await client.callTool({ name: "pptops_project_inspect", arguments: {} });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.project.id, "mcp-fixture");
  assert.equal(result.structuredContent.workflow.candidate, 1);
  assert.equal(JSON.stringify(result.structuredContent).includes(projectDir), false);

  const build = await client.callTool({ name: "pptops_build_status", arguments: { build_id: "build-running" } });
  assert.equal(build.structuredContent.build.state, "rendering");
  assert.equal(build.structuredContent.attempts[0].state, "running");
  assert.equal(build.structuredContent.events.length, before.events.length);

  const diff = await client.callTool({ name: "pptops_candidate_diff", arguments: { candidate_id: candidate.id } });
  assert.deepEqual(diff.structuredContent.patch.tokens, { accent: "#123456" });
  assert.equal("api_key" in diff.structuredContent.patch, false);
  assert.equal("root_path" in diff.structuredContent.patch, false);

  const review = await client.callTool({ name: "pptops_review_inspect", arguments: { review_id: "review-mcp" } });
  assert.equal(review.structuredContent.review.id, "review-mcp");
  assert.equal(review.structuredContent.build.state, "rendering");

  const capabilities = await client.callTool({ name: "pptops_delivery_capabilities", arguments: { artifact_type: "presentation", build_id: "build-running" } });
  assert.deepEqual(capabilities.structuredContent, JSON.parse(capabilities.content[0].text));
  assert.equal(capabilities.structuredContent.artifact_type, "presentation");
  assert.equal(capabilities.structuredContent.build_id, "build-running");
  assert.ok(Array.isArray(capabilities.structuredContent.capabilities));

  const verify = await ApplicationService.openReadOnly(projectDir);
  assert.equal(verify.buildStatus("build-running").build.state, "rendering");
  assert.equal(verify.buildStatus("build-running").attempts[0].state, "running");
  assert.equal(verify.buildStatus("build-running").events.length, before.events.length);
  verify.close();
});

test("MCP tool errors use stable application codes without stack traces", async (t) => {
  const projectDir = await fixture(t);
  const service = await ApplicationService.open(projectDir);
  service.close();
  const client = new Client({ name: "ppt-ops-test", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverEntry, "--project-dir", projectDir], stderr: "pipe" });
  t.after(async () => client.close());
  await client.connect(transport);

  const result = await client.callTool({ name: "pptops_build_status", arguments: { build_id: "build-missing" } });
  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, { error: { code: "OBJECT_NOT_FOUND", message: "unknown build: build-missing" } });
  assert.equal(JSON.stringify(result).includes("at ApplicationService"), false);

  const invalid = await client.callTool({ name: "pptops_project_inspect", arguments: { unknown: true } });
  assert.equal(invalid.isError, true);
  assert.match(invalid.content[0].text, /Input validation error/);
  assert.equal(invalid.structuredContent, undefined);
});

test("read-only opening never creates a store for a fresh project", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ppt-ops-mcp-fresh-"));
  const projectDir = path.join(root, "project");
  await initializeProject(projectDir, { name: "mcp-fresh", title: "MCP Fresh" });
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  await assert.rejects(ApplicationService.openReadOnly(projectDir), { code: "STORE_NOT_INITIALIZED" });
  await assert.rejects(fs.access(path.join(projectDir, ".pptops", "metadata.sqlite")), { code: "ENOENT" });
});

test("MCP entrypoint recognizes a symlinked bin path", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ppt-ops-mcp-link-"));
  const link = path.join(root, process.platform === "win32" ? "pptops-mcp.js" : "pptops-mcp");
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  try { await fs.symlink(serverEntry, link, "file"); }
  catch (error) {
    if (["EPERM", "EACCES"].includes(error.code)) return t.skip(`symlinks unavailable: ${error.code}`);
    throw error;
  }
  assert.equal(await isMainModule(link), true);
});

test("MCP startup requires exactly one explicit PPT-Ops project", async (t) => {
  const projectDir = await fixture(t);
  assert.equal(await resolveProjectDirectory(["--project-dir", projectDir]), await fs.realpath(projectDir));
  await assert.rejects(resolveProjectDirectory([]), { code: "MCP_CONFIG_INVALID" });
  await assert.rejects(resolveProjectDirectory(["--project-dir", projectDir, "extra"]), { code: "MCP_CONFIG_INVALID" });
});

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ppt-ops-mcp-"));
  const projectDir = path.join(root, "project");
  await initializeProject(projectDir, { name: "mcp-fixture", title: "MCP Fixture" });
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return projectDir;
}
