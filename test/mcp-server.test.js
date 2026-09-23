import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { ApplicationService } from "../src/application/service.js";
import { initializeProject } from "../src/core/init.js";
import { resolveProjectDirectory } from "../src/mcp/server.js";

const serverEntry = path.resolve("src/mcp/server.js");

test("MCP stdio server exposes the five read-only tools and structured project data", async (t) => {
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
    "pptops_build_status",
    "pptops_candidate_diff",
    "pptops_delivery_capabilities",
    "pptops_project_inspect",
    "pptops_review_inspect"
  ]);
  assert.ok(listed.tools.every((tool) => tool.annotations?.readOnlyHint === true));

  const result = await client.callTool({ name: "pptops_project_inspect", arguments: {} });
  assert.equal(result.isError, undefined);
  assert.equal(result.structuredContent.project.id, "mcp-fixture");
  assert.equal(result.structuredContent.workflow.candidate, 1);
  assert.equal(JSON.stringify(result.structuredContent).includes(projectDir), false);
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
