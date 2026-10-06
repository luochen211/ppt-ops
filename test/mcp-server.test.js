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
import { resolveProjectDirectory } from "../src/mcp/server.js";
import { seedAcceptedBoundaryImages } from "./support/accepted-boundaries.js";

const serverEntry = path.resolve("src/mcp/server.js");

test("MCP stdio server exposes the read-only tools and bounded build retry", async (t) => {
  const projectDir = await fixture(t);
  const service = await ApplicationService.open(projectDir);
  await service.proposeCandidate({ targetKind: "page_spec", targetId: "page-001", baseRevision: 1, patch: { task: "MCP candidate" } });
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
    "pptops_build_retry",
    "pptops_build_status",
    "pptops_candidate_diff",
    "pptops_delivery_capabilities",
    "pptops_project_inspect",
    "pptops_review_inspect"
  ]);
  assert.ok(listed.tools.filter((tool) => tool.name !== "pptops_build_retry").every((tool) => tool.annotations?.readOnlyHint === true));
  assert.equal(listed.tools.find((tool) => tool.name === "pptops_build_retry").annotations?.readOnlyHint, false);

  const result = await client.callTool({ name: "pptops_project_inspect", arguments: {} });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.project.id, "mcp-fixture");
  assert.equal(result.structuredContent.workflow.candidate, 1);
  assert.equal(JSON.stringify(result.structuredContent).includes(projectDir), false);
});

test("MCP build retry reuses the ApplicationService state gate and returns the new attempt", async (t) => {
  const projectDir = await fixture(t);
  await seedAcceptedBoundaryImages(projectDir);
  const service = await ApplicationService.open(projectDir);
  const version = await service.freezeVersion();
  const build = service.store.enqueueBuild(createV1Entity("build", "build-retry", {
    project_id: service.projectId, version_id: version.id, state: "queued", targets: ["html"], attempts: [], config: {}
  }));
  service.store.transitionBuild(build.id, "cancelled");
  service.close();

  const client = await connectClient(t, projectDir);
  const result = await client.callTool({ name: "pptops_build_retry", arguments: { build_id: build.id } });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.build.id, build.id);
  assert.equal(result.structuredContent.build.state, "succeeded");
  assert.equal(result.structuredContent.artifacts.length, 1);

  const retryTool = await listedTools(client);
  assert.equal(retryTool.inputSchema.additionalProperties, false);
});

async function listedTools(client) {
  const listed = await client.listTools();
  return listed.tools.find((tool) => tool.name === "pptops_build_retry");
}

test("MCP build retry returns a stable state error without mutating a queued build", async (t) => {
  const projectDir = await fixture(t);
  await seedAcceptedBoundaryImages(projectDir);
  const service = await ApplicationService.open(projectDir);
  const version = await service.freezeVersion();
  const build = service.store.enqueueBuild(createV1Entity("build", "build-queued", {
    project_id: service.projectId, version_id: version.id, state: "queued", targets: ["html"], attempts: [], config: {}
  }));
  service.close();

  const client = await connectClient(t, projectDir);
  const result = await client.callTool({ name: "pptops_build_retry", arguments: { build_id: build.id } });
  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, {
    error: { code: "BUILD_RETRY_INVALID_STATE", message: "build cannot be retried from state: queued", details: { state: "queued" } }
  });
  const reopened = await ApplicationService.open(projectDir);
  assert.equal(reopened.store.getBuild(build.id).state, "queued");
  assert.deepEqual(reopened.store.listAttempts(build.id), []);
  reopened.close();
});

test("MCP tool errors use stable application codes without stack traces", async (t) => {
  const projectDir = await fixture(t);
  const client = new Client({ name: "ppt-ops-test", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverEntry, "--project-dir", projectDir], stderr: "pipe" });
  t.after(async () => client.close());
  await client.connect(transport);

  const result = await client.callTool({ name: "pptops_build_status", arguments: { build_id: "build-missing" } });
  assert.equal(result.isError, true);
  assert.deepEqual(result.structuredContent, { error: { code: "OBJECT_NOT_FOUND", message: "unknown build: build-missing" } });
  assert.equal(JSON.stringify(result).includes("at ApplicationService"), false);
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
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return projectDir;
}

async function connectClient(t, projectDir) {
  const client = new Client({ name: "ppt-ops-test", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverEntry, "--project-dir", projectDir], stderr: "pipe" });
  t.after(async () => client.close());
  await client.connect(transport);
  return client;
}
