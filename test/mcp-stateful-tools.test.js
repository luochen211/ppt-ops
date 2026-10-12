import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { ApplicationService } from "../src/application/service.js";
import { initializeProject } from "../src/core/init.js";
import { seedAcceptedBoundaryImages } from "./support/accepted-boundaries.js";

const serverEntry = path.resolve("src/mcp/server.js");
process.env.PPT_OPS_RENDER_QA = "0";

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

test("MCP build creation returns an id, runs asynchronously, and reuses a request id", async t => {
  const projectDir = await fixture(t);
  await seedAcceptedBoundaryImages(projectDir);
  const service = await ApplicationService.open(projectDir); const version = await service.freezeVersion(); service.close();
  const client = await connect(t, projectDir);
  const input = { version_id: version.id, targets: ["html"], request_id: "build-request-001" };
  const created = await client.callTool({ name: "pptops_build_create", arguments: input });
  assert.equal(created.isError, undefined); assert.match(created.structuredContent.build_id, /^build-/); assert.equal(created.structuredContent.status_tool, "pptops_build_status");
  let status;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    status = await client.callTool({ name: "pptops_build_status", arguments: { build_id: created.structuredContent.build_id } });
    if (["succeeded", "failed"].includes(status.structuredContent.build.state)) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(status.structuredContent.build.state, "succeeded");
  const repeated = await client.callTool({ name: "pptops_build_create", arguments: input });
  assert.equal(repeated.structuredContent.build_id, created.structuredContent.build_id); assert.equal(repeated.structuredContent.reused, true);
  const conflict = await client.callTool({ name: "pptops_build_create", arguments: { ...input, targets: ["pptx"] } });
  assert.equal(conflict.structuredContent.error.code, "MCP_REQUEST_CONFLICT");
});

test("MCP review run preserves human acceptance boundaries and is idempotent", async t => {
  const projectDir = await fixture(t); await seedAcceptedBoundaryImages(projectDir);
  const service = await ApplicationService.open(projectDir); const version = await service.freezeVersion(); const built = await service.createBuild({ versionId: version.id, targets: ["pptx"] }); service.close();
  const client = await connect(t, projectDir);
  const input = { build_id: built.build.id, request_id: "review-request-001" };
  const first = await client.callTool({ name: "pptops_review_run", arguments: input });
  assert.equal(first.isError, undefined); assert.equal(first.structuredContent.state, "human_pending");
  assert.ok(first.structuredContent.acceptance.every(({ status }) => status === "pending"));
  const second = await client.callTool({ name: "pptops_review_run", arguments: input });
  assert.equal(second.structuredContent.review_id, first.structuredContent.review_id); assert.equal(second.structuredContent.reused, true);
  const inspected = await client.callTool({ name: "pptops_review_inspect", arguments: { review_id: first.structuredContent.review_id } });
  assert.equal(inspected.structuredContent.review.state, "human_pending");
});

test("MCP handoff requires an accepted exact Review and stored delivery selection", async t => {
  const projectDir = await fixture(t); await seedAcceptedBoundaryImages(projectDir);
  const service = await ApplicationService.open(projectDir); const version = await service.freezeVersion(); const built = await service.createBuild({ versionId: version.id, targets: ["html"] });
  const reviewed = await service.runReview(built.build.id); const accepted = await service.recordReview(reviewed.review.id, { decision: "accepted", expectedRevision: reviewed.review.revision, evidence: { reviewer: "user:fixture" } });
  const selected = await service.selectDelivery({ artifactType: "presentation", formats: ["html"], sourceId: built.build.id, sourceRevision: version.id, actor: "user:fixture", buildId: built.build.id }); service.close();
  const client = await connect(t, projectDir);
  const input = { build_id: built.build.id, review_id: accepted.id, expected_review_revision: accepted.revision, delivery_selection_id: selected.decision.id, request_id: "handoff-request-001" };
  const first = await client.callTool({ name: "pptops_handoff_create", arguments: input });
  assert.equal(first.isError, undefined); assert.equal(first.structuredContent.state, "verified"); assert.match(first.structuredContent.manifest_file, /manifest\.json$/);
  assert.equal(path.isAbsolute(first.structuredContent.package_dir), false);
  const second = await client.callTool({ name: "pptops_handoff_create", arguments: input });
  assert.equal(second.structuredContent.handoff_id, first.structuredContent.handoff_id); assert.equal(second.structuredContent.reused, true);
  const stale = await client.callTool({ name: "pptops_handoff_create", arguments: { ...input, request_id: "handoff-request-002", expected_review_revision: accepted.revision - 1 } });
  assert.equal(stale.structuredContent.error.code, "STALE_OBJECT_REVISION");
});

test("MCP read polling preserves an interrupted Build until a governed write recovers and resumes it", async t => {
  const projectDir = await fixture(t); await seedAcceptedBoundaryImages(projectDir); await fs.writeFile(path.join(projectDir, "recovery.md"), "# Recovery trigger\n");
  const service = await ApplicationService.open(projectDir); const version = await service.freezeVersion();
  const queued = await service.queueBuild({ versionId: version.id, targets: ["html"], requestId: "recover-build-001" });
  service.store.claimNextBuild(); service.store.transitionBuild(queued.build.id, "rendering"); service.close();
  const client = await connect(t, projectDir);
  const before = await client.callTool({ name: "pptops_build_status", arguments: { build_id: queued.build.id } });
  assert.equal(before.structuredContent.build.state, "rendering"); assert.equal(before.structuredContent.attempts[0].state, "running");
  await client.callTool({ name: "pptops_source_import", arguments: { source_file: "recovery.md" } });
  const recovered = await client.callTool({ name: "pptops_build_status", arguments: { build_id: queued.build.id } });
  assert.equal(recovered.structuredContent.build.state, "queued"); assert.equal(recovered.structuredContent.attempts[0].error.code, "PROCESS_INTERRUPTED");
  const resumed = await client.callTool({ name: "pptops_build_create", arguments: { version_id: version.id, targets: ["html"], request_id: "recover-build-001" } });
  assert.equal(resumed.structuredContent.build_id, queued.build.id); assert.equal(resumed.structuredContent.reused, true);
  let final;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    final = await client.callTool({ name: "pptops_build_status", arguments: { build_id: queued.build.id } });
    if (["succeeded", "failed"].includes(final.structuredContent.build.state)) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(final.structuredContent.build.state, "succeeded");
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
