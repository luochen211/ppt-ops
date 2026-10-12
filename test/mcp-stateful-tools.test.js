import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { ApplicationService } from "../src/application/service.js";
import { initializeProject } from "../src/core/init.js";

const serverEntry = path.resolve("src/mcp/server.js");

test("MCP imports only an explicit project-contained source and keeps stable duplicate identity", async t => {
  const projectDir = await fixture(t);
  await fs.writeFile(path.join(projectDir, "brief.md"), "# Explicit source\n");
  const client = await connect(t, projectDir);
  const first = await client.callTool({ name: "pptops_source_import", arguments: { source_file: "brief.md" } });
  const second = await client.callTool({ name: "pptops_source_import", arguments: { source_file: "brief.md" } });
  assert.equal(first.isError, undefined);
  assert.equal(first.structuredContent.source.sha256, second.structuredContent.source.sha256);
  assert.equal(second.structuredContent.duplicate, true);
  const absolute = await client.callTool({ name: "pptops_source_import", arguments: { source_file: path.join(projectDir, "brief.md") } });
  assert.equal(absolute.structuredContent.error.code, "MCP_SOURCE_PATH_INVALID");
  const escape = await client.callTool({ name: "pptops_source_import", arguments: { source_file: "../outside.md" } });
  assert.equal(escape.structuredContent.error.code, "MCP_SOURCE_PATH_INVALID");
});

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ppt-ops-mcp-stateful-"));
  const projectDir = path.join(root, "project"); await initializeProject(projectDir, { name: "mcp-stateful", title: "MCP Stateful" });
  const service = await ApplicationService.open(projectDir); service.close();
  t.after(() => fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return projectDir;
}

async function connect(t, projectDir) {
  const client = new Client({ name: "ppt-ops-stateful-test", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverEntry, "--project-dir", projectDir], stderr: "pipe" });
  t.after(async () => client.close()); await client.connect(transport); return client;
}
