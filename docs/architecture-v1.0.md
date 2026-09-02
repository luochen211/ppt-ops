# PPT-Ops V1.0 系统架构

> 本文定义 V1.0 的技术真源和模块边界。  
> 产品范围以 `product-v1.0-blueprint.md` 为准，实施任务以 `delivery-v1.0-dag.md` 为准。

## 1. 架构目标

V1.0 架构必须同时满足：

- 本地项目在离线环境中可编辑、构建、审查和交付；
- Codex Agent、CLI、AI 和渲染器共用同一套 Contract 和 Core；
- HTML 和 PPTX 从同一已确认版本独立构建；
- AI 输出不能绕过候选区、Schema 和用户确认门；
- 长任务可重试、可观测，不覆盖输入版本；
- 任何已交付产物都可追溯到项目版本、构建配置和验收证据；
- 后续云协作不需要推翻本地数据模型。

## 2. 上下文与分层

```text
用户 / Agent / 外部工具
          |
          v
Codex PPT Agent
          |
          v
Application Services
  Project  Source  Outline  Page  Version  Build  Review  Handoff
          |
          v
Domain Core + Contracts + State Machines
          |
   +------+----------------+------------------+
   |                       |                  |
   v                       v                  v
AI Candidate Pipeline   Renderer Ports    Persistence Ports
   |                   /            \      /             \
Provider Adapters     HTML          PPTX  File Store     SQLite
```

分层规则：

1. UI 不直接读写 JSON 或 SQLite；
2. Adapter 不定义业务状态和用户确认规则；
3. Renderer 不修改 Page Spec；
4. AI Provider 不获得项目文件系统的自由读取权限；
5. Review 只观察和记录，不静默修复产物；
6. Handoff 只包装指定 Build 和 Review，不重新构建。

## 3. 建议仓库形态

V1.0 将当前 Node.js 项目演进为单仓多包，但不在 T1 直接进行目录搬迁：

```text
.agents/skills/
  ppt-agent/                 # Codex 对话工作流与按需参考资料
apps/
  local-api/                 # 可选本地工具/event service
packages/
  contracts/                 # Schema、公共类型、迁移和契约测试
  core/                      # 领域规则、状态机和应用服务
  sources/                   # Markdown / DOCX / PPTX / web 提取适配器
  ai-pipeline/               # 结构化候选与隐私边界
  layout/                    # 模板、Token、自动布局和容量检查
  renderer-html/             # HTML 独立渲染器
  renderer-pptx/             # PPTX 原生渲染器
  review/                    # 自动检查与人工验收记录
  handoff/                   # 交付包和校验和
  cli/                       # CLI 适配层
examples/
  <standard-project>/
docs/
```

迁移应以契约先行、小步搬迁为原则；在新包通过同等测试前，不删除当前 `src/` 入口。

## 4. 技术基线

V1.0 的建议基线：

- Runtime：Node.js，与当前 CLI 和渲染链路保持一致；
- 应用代码：新增核心模块使用 TypeScript，旧 JavaScript 通过渐进迁移接入；
- Agent：仓库级 Codex Skill，通过描述自动触发或由用户显式调用；
- API：本地 Node HTTP 服务，提供版本化 JSON API 和长任务事件流；
- Metadata：SQLite，承载索引、状态、任务、确认和证据；
- Large objects：项目文件系统，承载真源、素材、产物和交付包；
- Contract validation：JSON Schema + 运行时语义验证；
- Job execution：SQLite-backed 持久化队列和受控子进程，不依赖纯内存队列；
- Testing：Skill 结构/场景 + Node 单测 + API/集成 + PPTX 渲染、结构与实机验收。

具体库的选择由对应实施 Issue 记录 ADR；T1 只冻结能力和边界，不依赖某个快速变化的库版本。

## 5. 数据真源边界

### 5.1 项目文件系统

文件系统是以下大对象的真源：

- 用户导入的原始文件；
- 归一化提取文本和引用定位；
- 图片、视频、字体和品牌素材；
- 不可变版本快照；
- HTML、PPTX、PDF、PNG 和交付包；
- 较大的日志和截图证据。

每个由系统管理的文件必须有稳定 ID、项目相对路径、字节大小、MIME、SHA-256 和创建来源。

### 5.2 SQLite

SQLite 是以下结构状态的真源：

- 项目索引和健康状态；
- Source / Asset / Outline / Page 的元数据和当前指针；
- Candidate、Approval、Version、Build、Review、Handoff 记录；
- 任务队列、尝试次数、失败阶段和取消状态；
- AI 请求的策略、模型标识、输入摘要、结构化输出和审计记录；
- 人工验收和用户反馈。

SQLite 不存储原始大文件和大产物 BLOB。

## 6. V1 核心实体

| 实体 | 职责 | 不可变性 |
|---|---|---|
| `Project` | 项目身份、目标、路径和当前指针 | 可编辑 |
| `Source` | 原始真源、提取结果与引用索引 | 原始文件只追加 |
| `Asset` | 素材及其版权、尺寸、用途和派生关系 | 原文件只追加 |
| `Outline` | 叙事弧、章节和页面分工 | 候选可变，版本不可变 |
| `PageSpec` | 页面语义、真源、上屏文字、关系和素材槽 | 候选可变，版本不可变 |
| `Theme` | Token、字体、颜色、间距和品牌规则 | 版本化 |
| `Template` | 语义槽位、容量约束和渲染器映射 | 版本化 |
| `Candidate` | Agent 建议和对已有状态的差异 | 不可直接构建 |
| `Approval` | 对某个对象快照的用户确认 | 只追加 |
| `Version` | 可构建的项目不可变快照 | 不可变 |
| `Build` | 输入版本、配置、状态、日志和产物 | 输入不可变 |
| `Review` | 自动检查和人工验收状态 | 证据只追加 |
| `Handoff` | 交付包、校验和和验收摘要 | 不可变 |
| `Feedback` | 用户对页面、版本或产物的反馈 | 只追加 |

## 7. 状态机

### 7.1 候选

```text
generated -> validating -> ready_for_review
                   \-> rejected
ready_for_review -> accepted -> applied_to_draft
                 \-> rejected
```

`accepted` 只表示候选允许应用到当前草稿，不等于项目版本已发布。

### 7.2 版本

```text
draft -> approval_pending -> approved -> frozen
                     \-> changes_requested -> draft
```

只有 `frozen` Version 可作为正式 Build 输入。

### 7.3 构建

```text
queued -> preparing -> rendering -> validating -> succeeded
   |          |            |            |
   +----------+------------+------------+-> failed
   \-> cancelled
```

重试会创建新的 Build Attempt，保留原失败证据。

### 7.4 验收与交付

```text
Review: automated_pending -> automated_complete -> human_pending -> accepted
                                                    \-> rejected
Handoff: preparing -> packaged -> verified -> delivered -> archived
```

HTML 视觉和 PowerPoint 实机是独立的 human acceptance 项，不由 `automated_complete` 自动填充。

## 8. Contract 分层

V1 Contract 必须分成：

1. `project`：项目身份、目标、场景、输出和指针；
2. `source`：原始文件、提取器、哈希和引用定位；
3. `outline`：章节、叙事任务和页面顺序；
4. `page-spec`：页面认知任务和共享语义；
5. `theme`：设计 Token 和品牌规则；
6. `template`：语义槽位、容量限制和 renderer mapping；
7. `asset`：素材、来源、授权、派生和槽位适配；
8. `version`：不可变快照及所有组成哈希；
9. `build`：输入、配置、环境、阶段和产物；
10. `review`：检查、人工验收和证据；
11. `handoff`：包含文件、哈希、字体、验收和修改摘要。

Renderer 专属几何只能位于 `renderers.html` 和 `renderers.pptx` 命名空间，不能覆盖共享文字、来源或页面任务。

## 9. AI 管线

```text
用户请求
  -> 解析任务与目标对象
  -> 读取最小必要真源片段
  -> 应用隐私策略和字段排除
  -> 记录即将发送的结构摘要
  -> Provider Adapter
  -> 解析结构化响应
  -> Contract + 语义 + 真源验证
  -> Candidate
  -> 用户审核
  -> 应用到 Draft
```

必要保护：

- 通过 allowlist 组装外部载荷，不对项目对象做默认全量序列化；
- 原始日记、聊天、客户私密原文等字段默认禁止；
- 审计日志记录字段类型、哈希和策略结果，不重复存储私密原文；
- 每个 AI 操作声明目标对象和可修改字段；
- 模型超时、非结构响应和契约失败不修改当前草稿。

## 10. 模板与布局

Template 必须声明：

- 支持的 `relation` 和页面任务；
- 槽位名称、类型、必填性和最大容量；
- 标题、正文、数据和素材的容量规则；
- 推荐图片比例与裁切策略；
- HTML 和 PPTX renderer mapping；
- 无法容纳输入时的明确失败或候选拆页策略。

自动布局输出是确定性 Layout Plan。它必须先通过容量、几何和素材检查，再分别交给两个 Renderer。

## 11. 构建管线

```text
Build(version_id, targets, config)
  -> resolve immutable snapshot
  -> verify source and asset hashes
  -> compile semantic pages to layout plans
  -> render requested targets independently
  -> run target-specific structural validation
  -> collect logs, timings, warnings and artifacts
  -> finalize succeeded / failed evidence
```

要求：

- 每个 target 有独立状态，HTML 成功不得遮盖 PPTX 失败；
- 构建进程不获得项目根目录以外的自由写入权；
- 产物写入临时目录，验证后原子化完成；
- 取消和失败不覆盖上一次成功产物；
- 构建记录包含系统版本、Contract 版本、Template 版本和字体环境。

## 12. Review 与 Handoff

Review 至少包含：

- Contract 和引用完整性；
- 页码、页序、素材和主题引用；
- HTML 资源内联、可导航性、控制台错误和截图差异；
- PPTX 压缩包、页数、尺寸、负几何、文本溢出风险和字体清单；
- 跨 target 的内容语义一致性；
- 待人工视觉与 PowerPoint 实机验收。

Handoff 只允许选择已完成 Review 的 Build，交付包包含：

- HTML、PPTX 及配置的 PDF/PNG；
- manifest 和 SHA-256；
- 页数、页序、字体和素材清单；
- 自动检查与人工验收摘要；
- 来源 Version 与 Build ID；
- 与上一交付版本的修改摘要。

## 13. API 与事件

API 使用版本化路径，不把本地绝对路径暴露为稳定外部标识。资源通过 ID 引用。

长任务事件至少包含：

```json
{
  "event_id": "evt_...",
  "job_id": "job_...",
  "sequence": 12,
  "type": "build.stage.completed",
  "timestamp": "...",
  "data": {
    "stage": "render:pptx",
    "status": "succeeded"
  }
}
```

`sequence` 在单个 job 内单调递增，Agent 恢复任务后可从上次 sequence 补读。

## 14. 安全与隐私

- 项目路径必须经过 root containment 检查；
- 压缩包、DOCX 和 PPTX 解压必须防止 zip slip、超大解压和伪造 MIME；
- 图像解析在受控进程中执行，对不受信文件限制尺寸、类型和资源；
- 本地 API 默认只监听 loopback，任何对外暴露都需要独立鉴权设计；
- 终端命令和渲染进程不拼接未转义用户输入；
- Secret 不写入项目、日志、Review 或 Handoff；
- 云同步与外部 AI 均为明示开启的能力。

## 15. 可观测性

每个请求、AI 任务和 Build 都有 correlation ID。日志为结构化 JSON，并对用户展示可读摘要。

核心指标：

- 各构建阶段耗时与失败率；
- 各 target 成功率；
- AI 候选的契约失败率、接受率和局部重生成次数；
- 模板容量失败与文本溢出风险；
- 人工验收失败的类型和页面；
- 重试次数与成功率。

日志不默认收录页面全文和私密真源原文。

## 16. 测试与验收分层

```text
Contract tests
  -> Core state-machine tests
  -> Adapter tests
  -> API and persistence integration tests
  -> Renderer structural tests
  -> End-to-end workflow tests
  -> HTML screenshot regression
  -> Microsoft PowerPoint real-app acceptance
  -> Target-user business acceptance
```

CI 至少要求：

- 全新环境安装；
- Schema 和 migration 检查；
- 单测、集成和端到端自动化测试；
- 标准项目的 HTML/PPTX 构建；
- Review 和 Handoff；
- 安全扫描和依赖风险报告。

CI 不能替代 PowerPoint 实机和真实用户验收。

## 17. v0.1 / CLI Foundation 迁移

T2 必须提供显式迁移器：

1. 读取当前 `project.json / pages.json / theme.json / assets.json`；
2. 输出 V1 Project、Source、Outline、PageSpec、Theme 和 Asset 结构；
3. 为无法推断的字段产生显式 warning，不自行补造；
4. 保留旧项目原文件不变；
5. 对迁移结果做 Contract 验证和可重复性测试；
6. 在编写新项目时只产生 V1 Contract，不维护两套可写模型。

当前 CLI 是 Agent 的确定性工具适配层，并与其他适配器共用 Application Services。

## 18. 架构决策纪律

以下变更必须有 ADR：

- 替换本地数据库或大文件存储模型；
- 改变 Page Spec 的共享语义真源地位；
- 将 AI 逻辑移入 Renderer；
- 使 HTML 成为 PPTX 的生成源；
- 跳过用户确认门或允许候选直接写入正式版本；
- 将本地优先改为必须云端运行；
- 更改人工验收与自动检查的证据边界。
