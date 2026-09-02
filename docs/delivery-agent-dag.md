# PPT-Ops Codex Agent 交付 DAG

> 真源：`docs/career-ops-inspired-agent-design.md`
> 执行原则：Contract 先行、一个 Issue 一个可验收结果、GitHub 可见认领、独立 Worktree、合并后重新计算队列。

## 1. 任务图

```text
已完成 Foundation
  #14 Contracts   #16 Source   #17 AI   #18 Layout/PPTX   #19 Infra
          \          |          |          /              /
           +---------+----------+---------+--------------+
                                |
                                v
 #28 System/User Data Contract + Root Resolution
        |               |                 |
        v               v                 v
 #29 Router/Modes  #30 Agent Commands  #31 Doctor/Reindex
        |               |                 |
        +---------------+-----------------+
                        |
                        v
              #32 Visual QA Toolchain
                        |
                        v
              #33 Update/Backup/Rollback
                        |
                        v
              #34 Golden Conversation E2E
                        |
                        v
              #20 Complete V1 Integration
                        |
                        v
              #21 Release/User Validation
```

## 2. 节点定义

### #28 / D1：System/User Data Contract 与 Root Resolution

交付：

- 系统层、用户层和项目层路径清单；
- `PPT_OPS_ROOT`、marker 和默认根解析；
- Profile、Custom 和 Project 配置优先级；
- 路径包含、重叠和升级保护测试。

文件边界：配置解析、数据契约文档、路径库和专项测试。它拥有共享路径契约，其他节点不得并行发明第二套解析。

验收：用户项目与私有模板永远不进入系统更新范围；非法路径失败；相同配置在不同 CWD 下解析一致。

### #29 / D2：Router 与 Mode References

依赖：#28。

交付：

- 精简 `$ppt-agent` Router；
- `discovery/new/intake/outline/design/prototype/revise/build/review/handoff/archive/doctor` Mode；
- Context Loading 矩阵；
- 意图路由、未知输入和非 Web 边界测试。

文件边界：`.agents/skills/ppt-agent/**` 与 Agent 场景测试。不得修改 Core Contract 或数据库 migration。

### #30 / D3：Agent Application Commands

依赖：#28。

交付：

- Candidate propose/diff/accept；
- Version freeze；
- Build create/retry；
- Review run/record；
- Handoff create；
- 结构化 JSON 输出和基线并发保护。

文件边界：Application Services、CLI adapter 和专项测试。共享 `src/cli.js` 与 package 配置由本节点独占。

### #31 / D4：Doctor、Reindex 与可移植真源

依赖：#28。

交付：

- `pptops doctor [project]`；
- 从项目文件重建 SQLite 索引；
- Skill/Core 契约版本、字体和可选渲染能力检查；
- 删除派生数据库后的恢复测试。

文件边界：Doctor、reindex、基础设施适配和专项测试。数据库 migration 与 D3 冲突时必须顺序整合。

### #32 / D5：PPTX 渲染与视觉 QA Toolchain

依赖：#29、#30、#31。

交付：

- PPTX/PDF 到逐页 PNG 的本地渲染适配；
- montage、越界、重叠、字体替换和密度检查；
- Review 证据写入；
- 缺少 LibreOffice/PowerPoint 时的明确降级。

验收：自动检查不能写成视觉或 PowerPoint 已通过；异常页面可定位到页码和检查项。

### #33 / D6：Update、Backup 与 Rollback

依赖：#28、#31、#32。

交付：

- System Layer 更新预览；
- 用户层保护；
- 迁移前备份；
- Apply 后 Doctor；
- 失败回滚和兼容测试。

V1 可以先交付本地可验证 updater，不要求公共包分发；用户项目不得被原地破坏。

### #34 / D7：Golden Conversation E2E

依赖：#29、#30、#31、#32、#33。

交付：五个真实对话 fixture、完整命令轨迹、项目 diff、PPTX、Review 与 Handoff 证据。

验收：主流程无需用户改代码；局部修改不影响非目标页；所有确认门和未完成的人工验收保持真实状态。

## 3. 并行波次

| 波次 | 节点 | 最大并发 | 说明 |
|---|---|---:|---|
| 0 | #28 | 1 | 先冻结共享路径和配置契约 |
| 1 | #29、#30、#31 | 3 | 独立 Worktree；#30 独占 CLI，#31 避免同时改 migration |
| 2 | #32 | 1 | 汇合 Agent、命令和恢复能力 |
| 3 | #33 | 1 | 基于 Doctor 和用户层契约实现安全更新 |
| 4 | #34 | 1 | 真实对话端到端验收 |
| 5 | #20、#21 | 1 | 集成、发布和目标用户验证 |

## 4. GitHub 执行协议

- 每个节点一个 GitHub Issue；
- Issue body 必须写 Parent、Depends on、文件边界和验收命令；
- 每个独立 Codex Session 一次只认领一个 Ready Issue；
- 认领通过 Issue 中的 `DAG-CLAIM` 可见记录；
- 每个 Session 使用独立 Orca worktree/branch；
- PR 创建后节点进入 Review，不再保持 Active Claim；
- PR 合并、Issue 关闭、依赖变化或 CI 失败后重新计算 Ready Queue；
- #20 只在 #34 完成后开始；#21 只在 #20 完成后开始。

## 5. 完成边界

Issue Done 需要：

- 验收条件有代码和测试证据；
- PR 已合并到 `main`；
- CI 成功；
- Issue 已关闭；
- 没有遗留活跃 Claim；
- DAG 文档和父 Epic 状态已同步。

V1 Done 还需要真实 PowerPoint 与目标用户验收，不能由自动测试替代。
