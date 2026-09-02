# PPT-Ops 1.0

PPT-Ops 是一个运行在 Codex 中的本地优先 PPT 生成 Agent。用户通过对话提交主题或资料，Agent 调用同一套结构化项目、页面规格和本地工具生成可编辑 PPTX；CLI 是内部执行能力，不是产品界面。

> 当前状态：V1 Agent alpha。仓库级 `$ppt-agent` 已提供 Codex 对话入口；AI 管线、项目版本和真实用户验收仍需继续完成。

V1.0 真源文档：

- [产品备案](docs/product-v1.0-blueprint.md)
- [系统架构](docs/architecture-v1.0.md)
- [交付 DAG](docs/delivery-v1.0-dag.md)
- [career-ops 项目理解与 PPT-Ops 参考设计](docs/career-ops-reference-for-ppt-ops.md)
- [career-ops 启发的 Codex Agent 目标设计](docs/career-ops-inspired-agent-design.md)
- [Codex Agent 交付 DAG](docs/delivery-agent-dag.md)

在 Codex 中可直接说“使用 `$ppt-agent` 把这些资料生成一份可编辑 PPTX”，也可让 Codex根据技能描述自动进入该工作流。技能入口位于 `.agents/skills/ppt-agent/SKILL.md`。

## 环境与安装

- Node.js 22（CI 使用的版本）
- npm

在干净检出中安装锁定依赖并运行测试：

```bash
npm ci
npm test
```

`npm ci` 当前会报告来自 `pptxgenjs` 间接依赖 `image-size` 的 high severity audit warning（ICNS、JXL 和 HEIF 解析可能因恶意输入进入无限循环）。本项目 demo 使用仓库内 SVG，且 v0.1 是本地 CLI，不接收网络上传；这降低了当前 demo 路径的暴露面，但不代表漏洞不可利用或已经修复。上游尚未提供保持当前 `pptxgenjs` 主版本的可用修复，处理不受信任图片前应单独评估和隔离。

## 命令

```bash
node src/cli.js init path/to/my-deck --title "My Deck"
node src/cli.js migrate examples/demo-project --to path/to/migrated-deck
node src/cli.js import path/to/my-deck --file path/to/source.docx
node src/cli.js validate path/to/my-deck
node src/cli.js intake examples/demo-project
node src/cli.js outline examples/demo-project
node src/cli.js prototype examples/demo-project --pages 1,2
node src/cli.js build examples/demo-project --format html
node src/cli.js build examples/demo-project --format pptx
node src/cli.js build examples/demo-project --format all
node src/cli.js review examples/demo-project
node src/cli.js handoff examples/demo-project
node src/cli.js deliver examples/demo-project
```

`init` 会创建一套可直接校验和构建的 V1 实体契约，并拒绝覆盖非空目录。`migrate` 将 Foundation 项目只读迁移到新的目标目录，不修改输入。`deliver` 按 `project.json` 中配置的 HTML/PPTX 输出执行构建、自动检查和交付打包；它不会把自动检查表述为视觉验收或真实 PowerPoint 验收。现有 Foundation 项目仍可读取和构建。

`build` 会先校验项目，输入无效时非零退出。生成物只写入项目的 `outputs/`，不会覆盖项目源文件：

```text
examples/demo-project/outputs/
  slides.html                 可直接用本地浏览器打开，资源已内嵌
  slides.pptx                 16:9 PPTX，文本和标准形状可编辑
  review-report.json          机器可读的自动检查与待验收项
  handoff/package-001/
    manifest.json             文件大小、SHA-256 与验收状态
    review-report.json
    slides.html
    slides.pptx
```

每次 `handoff` 创建新的递增 package 目录，不覆盖已有 package 或源输出。所有 `outputs/` 都被 Git 忽略。

## 项目结构

```text
project.json                  V1 Project 实体和公共指针
sources.json                 Source 实体、哈希和 MIME
outline.json                 Outline 实体和页面顺序
pages.json                   两种 renderer 共享的 PageSpec 实体
theme.json                   Theme 实体和设计 Token
assets.json                  Asset 实体、哈希和来源
templates.json               Template 实体
assets/                       项目资产
outputs/                      生成物（不纳入 Git）
```

仓库实现位于：

```text
src/cli.js                    CLI 入口
src/contracts/                V1 运行时契约与跨实体语义校验
src/core/                     项目加载、兼容投影与状态机
src/migrations/               Foundation 到 V1 的只读迁移器
src/infrastructure/           SQLite 元数据、持久队列、文件存储与本地 API
src/sources/                  Markdown、DOCX、PPTX 安全导入与定位
src/ai/                       Provider-neutral 候选管线与隐私边界
src/layout/                   8 类语义模板、容量检查与 Layout Plan
src/adapters/html.js          自包含 HTML renderer
src/adapters/pptx.js          原生 PPTX renderer
src/review/                   review 报告
src/handoff/                  handoff 打包与校验和
schemas/v1/                   V1 JSON Schema
examples/demo-project/        可重复构建的 demo
```

V1 实体统一携带 `contract_version`、`kind` 和稳定 `id`。Foundation 兼容只存在于读取时的内存投影，新项目不会双写旧数据模型。版本策略与迁移边界见 [ADR 0001](docs/adr/0001-contract-versioning.md)。

本地基础设施使用 SQLite 保存项目索引、实体修订、Build、Attempt 和可补读事件；不可变版本快照及构建产物保存在项目根目录的 `.pptops/` 下。失败重试保留旧 Attempt，进程中断后的活动任务会在重启时留下失败证据并回到队列。本地 JSON API 仅允许监听 loopback。存储边界见 [ADR 0002](docs/adr/0002-local-persistence.md)。

Source Intake 支持 Markdown、DOCX 和 PPTX，导入时检查文件签名、Open XML 包结构、ZIP 路径与展开资源上限，并按 SHA-256 去重。提取结果保留行、段落或幻灯片文本定位；人工修正创建新提取修订，不改写原文件。边界见 [ADR 0003](docs/adr/0003-source-intake.md)。

AI 只能生成经过任务级字段白名单、结构校验和目标校验的 Candidate。原始 Source 文本默认不出站，只有调用方明确授权的选中片段才进入载荷；审计记录只保存字段路径、计数和哈希。Candidate 必须由用户接受且 Draft 基线未变化后才能应用。边界见 [ADR 0004](docs/adr/0004-ai-candidate-boundary.md)。

Layout 层提供 hero、statement、comparison、sequence、process、hierarchy、data、cycle 八类模板。Theme 按“基础 → 项目 → 单页”合并；超容量会明确失败，HTML 与原生 PPTX 分别消费同一确定性 Layout Plan。PDF/PNG 仅作为带来源 Build 的派生产物。边界见 [ADR 0005](docs/adr/0005-layout-and-renderers.md)。

## 验收边界与已知限制

自动测试与 `review` 可以证明项目结构有效、HTML 已生成、PPTX 包结构为 16:9、页数正确且未发现负坐标；它们不能证明视觉质量，也不能证明 Microsoft PowerPoint 中的真实编辑、字体替换、动画或现场播放效果。`review-report.json` 会把视觉验收和真实 PowerPoint 验收明确保留为 `pending`。

V1.0 不提供 HTML/PPTX 像素级一致保证、HTML 转 PPTX、浏览器协作编辑、在线托管/分享、现有 PPTX 往返编辑或自动补造业务事实。HTML 资源内嵌并支持键盘翻页；PPTX 使用本机可用字体，换机时可能发生字体替换。

CI 在 push 与 pull request 上运行 `npm ci`、全部测试、两种 demo build、`review` 和 `handoff`。CI 成功仍不替代上述人工视觉与真实 PowerPoint 验收。
