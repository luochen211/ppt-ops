#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { ApplicationError, ApplicationService } from "../application/service.js";

const SERVER_VERSION = "0.1.0";
const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export async function resolveProjectDirectory(argv) {
  if (argv.length !== 2 || argv[0] !== "--project-dir" || !argv[1]) {
    throw new McpConfigurationError("MCP_CONFIG_INVALID", "用法：pptops-mcp --project-dir <PPT-Ops 项目目录>");
  }
  const projectDir = await fs.realpath(path.resolve(argv[1]));
  try {
    await fs.access(path.join(projectDir, "project.json"));
  } catch (error) {
    if (error.code === "ENOENT") throw new McpConfigurationError("MCP_PROJECT_INVALID", "指定目录不是 PPT-Ops V1 项目：缺少 project.json");
    throw error;
  }
  return projectDir;
}

export function createPptOpsMcpServer(projectDir) {
  const server = new McpServer(
    { name: "ppt-ops", version: SERVER_VERSION },
    { capabilities: { tools: {} }, instructions: "只读访问启动时指定的单个 PPT-Ops 项目。所有写入与工作流推进操作仍由 CLI 或 ApplicationService 的受控入口完成。" }
  );

  registerReadOnlyTool(server, "pptops_project_inspect", "读取项目身份、契约数量和工作流对象数量。", z.object({}).strict(), async () => {
    return withService(projectDir, (service) => service.inspectProject());
  });
  registerReadOnlyTool(server, "pptops_build_status", "读取指定 Build 的状态、尝试记录和事件。", z.object({ build_id: idSchema("Build") }).strict(), async ({ build_id }) => {
    return withService(projectDir, (service) => service.buildStatus(build_id));
  });
  registerReadOnlyTool(server, "pptops_candidate_diff", "读取 Candidate 相对当前目标的补丁和过期状态。", z.object({ candidate_id: idSchema("Candidate") }).strict(), async ({ candidate_id }) => {
    return withService(projectDir, (service) => service.diffCandidate(candidate_id));
  });
  registerReadOnlyTool(server, "pptops_review_inspect", "读取指定 Review 及其关联 Build 的证据状态。", z.object({ review_id: idSchema("Review") }).strict(), async ({ review_id }) => {
    return withService(projectDir, (service) => service.reviewInspect(review_id));
  });
  registerReadOnlyTool(server, "pptops_delivery_capabilities", "读取当前可选择的交付格式；presentation 需要 build_id。", z.object({
    artifact_type: z.enum(["presentation", "outline"]),
    build_id: z.string().trim().min(1).optional()
  }).strict().superRefine((value, context) => {
    if (value.artifact_type === "presentation" && !value.build_id) context.addIssue({ code: "custom", path: ["build_id"], message: "presentation 需要 build_id" });
    if (value.artifact_type === "outline" && value.build_id) context.addIssue({ code: "custom", path: ["build_id"], message: "outline 不接受 build_id" });
  }), async ({ artifact_type, build_id }) => {
    return withService(projectDir, (service) => service.deliveryCapabilities(artifact_type, build_id));
  });

  return server;
}

function registerReadOnlyTool(server, name, description, inputSchema, handler) {
  server.registerTool(name, { description, inputSchema, annotations: READ_ONLY }, async (input) => {
    try {
      const data = sanitize(await handler(input));
      return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
    } catch (error) {
      const failure = sanitizeError(error);
      return { isError: true, content: [{ type: "text", text: JSON.stringify(failure) }], structuredContent: failure };
    }
  });
}

async function withService(projectDir, operation) {
  const service = await ApplicationService.open(projectDir);
  try { return await operation(service); }
  finally { service.close(); }
}

function idSchema(label) { return z.string().trim().min(1).describe(`${label} ID`); }

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(authorization|password|secret|token)/i.test(key) && key !== "root_path")
    .map(([key, item]) => [key, sanitize(item)]));
}

function sanitizeError(error) {
  if (error instanceof ApplicationError) return { error: { code: error.code, message: error.message, ...(error.details ? { details: sanitize(error.details) } : {}) } };
  return { error: { code: "MCP_TOOL_FAILED", message: "PPT-Ops 工具执行失败。请查看服务端 stderr 日志。" } };
}

class McpConfigurationError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const projectDir = await resolveProjectDirectory(process.argv.slice(2));
    serveStdio(() => createPptOpsMcpServer(projectDir));
  } catch (error) {
    console.error(JSON.stringify({ error: { code: error.code ?? "MCP_START_FAILED", message: error.message } }));
    process.exitCode = 1;
  }
}
