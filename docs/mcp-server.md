# 本地 MCP Server（第一阶段）

PPT-Ops 提供本地 `stdio` MCP Server，让支持 MCP 的智能体读取一个明确指定的 V1 项目。第一阶段只开放查询工具，不会构建文件、推进评审状态或创建交付包。

## 启动边界

启动时必须用 `--project-dir` 指定一个项目目录。Server 不扫描父目录，也不允许工具调用临时切换项目。

```bash
npm run mcp -- --project-dir /absolute/path/to/ppt-ops-project
```

也可以在支持 MCP 的客户端中直接配置 Node 入口：

```json
{
  "mcpServers": {
    "ppt-ops": {
      "command": "node",
      "args": [
        "/absolute/path/to/ppt-ops/src/mcp/server.js",
        "--project-dir",
        "/absolute/path/to/ppt-ops-project"
      ],
      "cwd": "/absolute/path/to/ppt-ops"
    }
  }
}
```

`stdout` 仅承载 MCP 协议消息。启动错误和运行日志写入 `stderr`，避免破坏协议流。

## 当前工具

| 工具 | 输入 | 返回内容 |
| --- | --- | --- |
| `pptops_project_inspect` | 无 | 项目身份、契约数量、工作流对象数量 |
| `pptops_build_status` | `build_id` | Build、尝试记录、事件 |
| `pptops_candidate_diff` | `candidate_id` | Candidate 补丁、目标版本、是否过期 |
| `pptops_review_inspect` | `review_id` | Review 证据状态和关联 Build |
| `pptops_delivery_capabilities` | `artifact_type`，presentation 另需 `build_id` | 当前可选择的交付格式 |

所有工具均声明为只读、幂等且不访问外部网络。返回值同时包含文本 JSON 和 `structuredContent`。业务错误使用稳定的 `error.code`；未知内部错误不会向客户端暴露堆栈。

## 当前限制

- 仅支持本机 `stdio` 传输。
- 一个 Server 进程只服务一个项目。
- Source 导入、Build、Review 和 Handoff 等有状态操作尚未开放为 MCP 工具。
- Server 复用 `ApplicationService`，不维护第二套业务状态或生命周期规则。
