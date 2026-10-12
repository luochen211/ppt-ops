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
const MUTATING = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };

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
    { capabilities: { tools: {} }, instructions: "访问启动时指定的单个 PPT-Ops 项目。所有工具均通过 ApplicationService，并保留既有状态机、不可变性和人工确认门。" }
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
    return withService(projectDir, async (service) => ({
      artifact_type,
      build_id: build_id ?? null,
      capabilities: await service.deliveryCapabilities(artifact_type, build_id)
    }));
  });

  registerStatefulTool(server, "pptops_source_import", "导入项目目录内明确指定的资料；不扫描目录、不接受绝对路径或越界符号链接。", z.object({
    source_file: z.string().trim().min(1)
  }).strict(), async ({ source_file }) => {
    const inputFile = await resolveMcpSourceFile(projectDir, source_file);
    return withWriteService(projectDir, (service) => service.importSource(inputFile));
  });
  registerStatefulTool(server, "pptops_build_create", "从已冻结 Version 创建异步 Build；立即返回 Build ID，并用 pptops_build_status 查询进度。", z.object({
    version_id: idSchema("Version"), targets: z.array(z.enum(["html", "pptx"])).min(1), request_id: idSchema("Request")
  }).strict(), async ({ version_id, targets, request_id }) => {
    const queued = await withWriteService(projectDir, (service) => service.queueBuild({ versionId: version_id, targets, requestId: request_id }));
    if (!queued.reused || queued.build.state === "queued") scheduleBuild(projectDir, queued.build.id);
    return { build_id: queued.build.id, state: queued.build.state, reused: queued.reused, status_tool: "pptops_build_status" };
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
      console.error(JSON.stringify(failure));
      return { isError: true, content: [{ type: "text", text: JSON.stringify(failure) }], structuredContent: failure };
    }
  });
}

function registerStatefulTool(server, name, description, inputSchema, handler) {
  server.registerTool(name, { description, inputSchema, annotations: MUTATING }, async (input) => {
    try {
      const data = sanitize(await handler(input));
      return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
    } catch (error) {
      const failure = sanitizeError(error);
      console.error(JSON.stringify(failure));
      return { isError: true, content: [{ type: "text", text: JSON.stringify(failure) }], structuredContent: failure };
    }
  });
}

async function withService(projectDir, operation) {
  const service = await ApplicationService.openReadOnly(projectDir);
  try { return await operation(service); }
  finally { service.close(); }
}

async function withWriteService(projectDir, operation) {
  const service = await ApplicationService.open(projectDir);
  try { return await operation(service); }
  finally { service.close(); }
}

export async function resolveMcpSourceFile(projectDir, sourceFile) {
  if (path.isAbsolute(sourceFile)) throw new ApplicationError("MCP_SOURCE_PATH_INVALID", "source_file must be project-relative");
  const lexical = path.resolve(projectDir, sourceFile);
  if (outside(projectDir, lexical)) throw new ApplicationError("MCP_SOURCE_PATH_INVALID", "source_file escapes the configured project");
  let real;
  try { real = await fs.realpath(lexical); }
  catch (error) {
    if (error.code === "ENOENT") throw new ApplicationError("MCP_SOURCE_NOT_FOUND", "source_file does not exist");
    throw error;
  }
  if (outside(projectDir, real)) throw new ApplicationError("MCP_SOURCE_PATH_INVALID", "source_file resolves outside the configured project");
  return real;
}

function outside(root, candidate) { const relative = path.relative(root, candidate); return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative); }

function scheduleBuild(projectDir, buildId) {
  setImmediate(async () => {
    try { await withWriteService(projectDir, (service) => service.runBuild(buildId)); }
    catch (error) { console.error(JSON.stringify(sanitizeError(error))); }
  });
}

function idSchema(label) { return z.string().trim().min(1).describe(`${label} ID`); }

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !SENSITIVE_KEYS.has(key.toLowerCase()))
    .map(([key, item]) => [key, sanitize(item)]));
}

const SENSITIVE_KEYS = new Set([
  "authorization", "password", "secret", "api_key", "apikey", "access_token", "refresh_token", "root_path"
]);

function sanitizeError(error) {
  if (error instanceof ApplicationError) return { error: { code: error.code, message: error.message, ...(error.details ? { details: sanitize(error.details) } : {}) } };
  return { error: { code: "MCP_TOOL_FAILED", message: "PPT-Ops 工具执行失败。请查看服务端 stderr 日志。" } };
}

class McpConfigurationError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

export async function isMainModule(entry = process.argv[1]) {
  return Boolean(entry) && await fs.realpath(entry).catch(() => undefined) === fileURLToPath(import.meta.url);
}

const isMain = await isMainModule();
if (isMain) {
  try {
    const projectDir = await resolveProjectDirectory(process.argv.slice(2));
    serveStdio(() => createPptOpsMcpServer(projectDir));
  } catch (error) {
    console.error(JSON.stringify({ error: { code: error.code ?? "MCP_START_FAILED", message: error.message } }));
    process.exitCode = 1;
  }
}
