# career-ops 项目理解与 PPT-Ops 参考设计

> 调研对象：[`career-ops-hq/career-ops`](https://github.com/career-ops-hq/career-ops)
> 调研快照：`main@1696bec4d021768e7359f9aad6b329cba883da20`
> 调研日期：2026-09-02
> 目的：理解 career-ops 的真实产品与工程结构，并提炼适用于“Codex PPT 生成 Agent”的设计，而不是复制其求职业务或网页能力。

## 1. 先给结论

career-ops 不是“Codex 加一堆零散 Skill”，也不是普通 Node CLI。它是一个以 AI 编码 CLI 为交互宿主、以单一 Agent Skill 为路由入口、以 Markdown Mode 表达领域流程、以确定性脚本执行高风险操作、以本地文件保存业务真源的垂直 Agent 操作系统。

它可以压缩成六层：

```text
用户自然语言 / URL / 文件
          ↓
单一 career-ops Router Skill
          ↓
按需加载的 Mode + Shared/Profile/Custom Context
          ↓
Agent 推理、研究、草拟与人工确认
          ↓
Node/Go 确定性工具：扫描、编号、锁、写入、生成、校验
          ↓
Markdown/YAML/TSV/产物目录真源 + 可重建索引
```

对 PPT-Ops 最重要的启发是：产品不应表现为“让用户自己挑多个 PPT Skill”，而应只有一个 `$ppt-agent` 总入口。内部再根据任务进入 `intake / outline / design / prototype / build / review / handoff / archive` 等 Mode，并调用图片、版式、PPTX 和检查能力。

## 2. career-ops 到底是什么

### 2.1 产品入口

用户在 Codex、Claude Code、OpenCode 等 Agent CLI 中启动仓库，然后：

- 粘贴职位 URL 或 JD，Router 自动进入 `auto-pipeline`；
- 明确说 `scan`、`pdf`、`tracker` 等，Router 进入对应 Mode；
- 没有明确任务时显示命令菜单。

因此，用户面对的是一个“求职指挥中心”，而不是脚本列表。脚本存在，但用户不需要理解 `merge-tracker.mjs`、`reserve-report-num.mjs` 或 `verify-pipeline.mjs` 才能使用产品。

### 2.2 业务目标

career-ops 的核心任务不是替用户海投，而是降低选择和生产成本：

1. 从公开 ATS 和招聘源发现职位；
2. 判断职位是否仍有效、是否真实、是否匹配；
3. 生成结构化评估报告和定制简历；
4. 管理申请、跟进、面试和结果；
5. 从历史结果校准职业策略；
6. 所有外部提交仍由用户审核和点击。

### 2.3 技术形态

- Node.js 是主要确定性运行时；
- Markdown Mode 是 Agent 可执行的业务流程；
- YAML 保存 Profile、状态枚举和配置；
- Markdown/TSV 保存人类可读业务数据；
- SQLite 仅作为可重建查询索引；
- Playwright 用于浏览器提取与 PDF 视觉验证；
- Go TUI 是可选 Dashboard，不是核心前置条件。

这说明“Agent 产品”并不等于“只有 Prompt”。稳定产品需要把推理和确定性操作分开。

## 3. 单入口 Router：为什么不是一堆 Skill

career-ops 只有一个公开的 `.agents/skills/career-ops/SKILL.md`。这个 Skill 不承载全部求职知识，而是负责四件事：

1. 解析项目根目录，避免从错误 CWD 读写；
2. 根据参数、自然语言、URL 或 JD 特征选择 Mode；
3. 根据 Mode 只加载必要上下文；
4. 把当前任务交给目标 Mode 执行。

Mode 文件位于 `modes/`，例如：

| Mode | 责任 |
|---|---|
| `auto-pipeline` | 单份 JD 的评估、报告、PDF 和追踪闭环 |
| `scan` | 从公开招聘源发现职位 |
| `pipeline` | 处理待办 URL 队列 |
| `apply` | 在人工控制下辅助填写申请 |
| `interview-prep` | 生成公司和岗位专属面试材料 |
| `tracker` | 查看和维护申请状态 |
| `update` | 预览、应用和回滚系统更新 |

这个结构解决了两个常见问题：

- 用户不需要知道应该调用哪个底层 Skill；
- Agent 不需要在每次对话中加载所有领域规则。

### 对 PPT-Ops 的映射

建议 `$ppt-agent` 保持唯一公开入口：

| 用户表达 | 自动路由 |
|---|---|
| “帮我做一个关于 X 的 PPT” | `new` → `intake` → `outline` |
| “把这些 Word 和旧 PPT 整理成一套” | `intake` |
| “先给我看大纲” | `outline` |
| “第三页太挤，换成对比页” | `revise`，目标限定为第 3 页 |
| “生成可编辑 PPTX” | `build` |
| “看看有没有溢出和错字” | `review` |
| “打包交付” | `handoff` |
| “把这次项目归档” | `archive` |

不要为每个动作暴露一个同级 Skill。`imagegen`、版式策略、PptxGenJS、Source Intake、渲染和检查器应作为 Router 内部能力。

## 4. Context Loading：按任务加载，而不是全量塞入

career-ops 把上下文拆为四类：

```text
_shared.md   通用领域规则
_profile.md  用户事实、目标和策略
_custom.md   用户流程与表达偏好
mode.md      当前任务专属步骤
```

Router 根据 Mode 决定加载组合。评估类 Mode 需要共享评分规则；纯状态查询不需要加载整套评估框架。这个做法减少上下文浪费，也降低规则互相干扰。

### PPT-Ops 建议结构

```text
.agents/skills/ppt-agent/
  SKILL.md                         # 唯一入口与路由
  references/
    shared.md                      # 真源、确认门、验收边界
    modes/
      intake.md
      outline.md
      design.md
      prototype.md
      revise.md
      build.md
      review.md
      handoff.md
      archive.md
    design/
      semantic-templates.md        # 语义模板与容量规则
      visual-quality.md            # 视觉检查规则
    formats/
      source-intake.md
      editable-pptx.md
```

建议加载矩阵：

| Mode | 必需上下文 | 不应默认加载 |
|---|---|---|
| `intake` | shared + source-intake + 项目 brief | 全部视觉规则 |
| `outline` | shared + 当前 sources + outline mode | PPTX 内部实现 |
| `design` | shared + 已确认 outline + semantic templates | Handoff 规则 |
| `revise` | shared + 目标页 + 相邻页 + 反馈 | 全项目全部素材 |
| `build` | frozen version + renderer config | 未采用 Candidate |
| `review` | build + visual-quality + acceptance matrix | 原始全部聊天记录 |

## 5. DATA_CONTRACT：系统更新为什么不会吞掉用户数据

career-ops 最关键的架构不是评分算法，而是 `DATA_CONTRACT.md` 明确的双层模型。

### 5.1 System Layer

系统层包括：

- Router 和 Mode；
- Node 脚本；
- 模板；
- Dashboard；
- 文档、测试与更新器。

这些文件可以随版本升级。

### 5.2 User Layer

用户层包括：

- CV、Profile 和个人策略；
- 用户自定义流程；
- Tracker、报告、JD、面试材料；
- 生成产物；
- 私密文档和本地插件配置。

Updater 永远不能覆盖这些内容。

### 5.3 三种定制分开保存

career-ops 没有把所有定制都塞进一个文件：

- 事实和职业目标 → `_profile.md` / `profile.yml`；
- 流程、输出、自动化偏好 → `_custom.md`；
- 通用产品规则 → `_shared.md`。

这避免用户为了改一个偏好而 fork 整个系统规则，也避免升级时发生难以解决的冲突。

### PPT-Ops 的对应契约

建议明确：

```text
System Layer（可升级）
  .agents/skills/ppt-agent/
  src/
  schemas/
  templates/system/
  test/
  docs/system/

User/Project Layer（不可被升级覆盖）
  projects/<project>/project.json
  projects/<project>/sources/
  projects/<project>/assets/
  projects/<project>/candidates/
  projects/<project>/versions/
  projects/<project>/outputs/
  projects/<project>/handoffs/
  config/profile.yml
  config/custom.md
  templates/user/
```

PPT 领域还需要分清三类规则：

- `profile`：品牌、字体、常用语气、演讲者身份、禁止声明；
- `custom`：默认页数、是否先看大纲、交付命名、默认输出格式；
- `project`：本次观众、目的、时长、资料、主题和特殊约束。

## 6. Files are canonical：为什么文件是真源

career-ops 明确规定：人类可读、可 Git diff 的文件是永久真源，SQLite 只能是派生索引。

原因不是技术保守，而是生态兼容：

- Agent 可以直接读取；
- 用户可以手工检查和修正；
- Git 可以展示变化；
- 插件和脚本不必连接数据库；
- 索引损坏时可从文件重建；
- 迁移和归档更透明。

### PPT-Ops 应如何取舍

当前 PPT-Ops 使用项目 JSON + SQLite 元数据。建议冻结以下规则：

1. `Project / Source / Outline / PageSpec / Theme / Version` 的可移植快照必须存在于项目文件中；
2. SQLite 可保存队列、索引、Attempt、事件游标等运行态；
3. 删除 SQLite 后，应能重新注册项目并恢复已确认版本和交付证据；
4. PPTX、图片、字体等大对象留在文件系统，不进入 SQLite BLOB；
5. 聊天记录不是正式真源，只有进入 Candidate、Approval 或 Version 的内容才可构建。

与 career-ops 不同，PPT-Ops 的布局结构更复杂，JSON 契约比 Markdown 表格更合适；但“文件为可移植真源、数据库为运行辅助”的原则仍可直接复用。

## 7. Agent 判断与确定性脚本的分工

career-ops 的可靠性来自一个清晰边界：

### Agent 适合做

- 理解自然语言目标；
- 判断岗位匹配；
- 研究和总结；
- 起草内容；
- 发现缺口；
- 向用户解释取舍。

### 脚本必须做

- 原子编号；
- 文件锁；
- 状态枚举；
- 去重和合并；
- 路径约束；
- 哈希和幂等；
- 结构校验；
- 备份、更新与回滚。

代表实现：

- `reserve-report-num.mjs` 用 sentinel 和 owner token 并发领取编号；
- `merge-tracker.mjs` 通过 URL、编号、公司岗位等信号确定性去重；
- `set-status.mjs` 负责规范状态变化，而不是让 Agent 手改表格；
- `verify-pipeline.mjs` 做跨报告、Tracker、状态和文件引用检查；
- `update-system.mjs` 通过 allowlist、备份与回滚更新系统文件。

### PPT-Ops 的对应边界

| Agent 判断 | 确定性工具 |
|---|---|
| 理解观众和目标 | 创建 Project ID 和目录 |
| 提炼叙事结构 | Schema 校验 Outline |
| 判断页面关系 | 校验 Template 与 relation 兼容性 |
| 压缩上屏文字 | 容量、字号和溢出检查 |
| 推荐素材 | 哈希、授权、路径与比例检查 |
| 提出局部修改 | Candidate diff 和基线版本检查 |
| 判断视觉问题 | PPTX 构建、渲染、边界检测 |
| 建议是否交付 | Handoff 编号、清单和校验和 |

核心原则：Agent 不能通过直接改 SQLite、直接覆盖已确认 JSON 或直接替换历史 PPTX 来“完成任务”。

## 8. 人类确认门不是一句提示词

career-ops 在多个层面落实 Human-in-the-loop：

- 外部 JD、网页和邮件是数据，绝不是可执行指令；
- 事实必须来自主真源或当前用户明确陈述；
- 派生材料里的数字不能自动升级成事实；
- Intake 只提出带来源的变更，用户确认后才写入；
- Apply 只能辅助，不能替用户提交；
- Update 必须预览差异、确认、验证，失败可回滚。

`tests/intake.test.mjs` 特别值得借鉴：它不仅测试“能不能解析”，还验证 `--commit` 没有明确路径时必须拒绝，避免一个含糊命令把所有建议都标记为已确认。

### PPT-Ops 的确认门

| 阶段 | Agent 可自动做 | 需要确认 |
|---|---|---|
| Intake | 提取、去重、标注来源 | 哪些内容成为正式真源 |
| Outline | 生成候选 | 叙事结构和页数方向 |
| Design | 推荐模板与关键页 | 视觉方向、品牌偏离 |
| Revise | 生成目标页 Candidate | 是否应用到 Draft |
| Version | 校验 Draft | 是否冻结为 Build 输入 |
| Review | 自动检查并提出问题 | 视觉通过、PowerPoint 实机通过 |
| Handoff | 生成候选交付清单 | 是否标记为正式交付 |

## 9. 外部内容与 Prompt Injection 边界

career-ops 在 `AGENTS.md` 中明确：职位网页、邮件和表单字段只能影响业务判断，不能改变系统规则、触发越权写入、提交内容或泄露秘密。

PPT-Ops 面临同样问题。导入的旧 PPT、Word、讲稿、网页截图甚至备注中都可能出现“忽略此前规则”之类文本。必须统一处理为 Source 数据：

- 可以成为页面素材；
- 可以影响内容提炼；
- 不能改变 Agent 权限；
- 不能批准 Candidate；
- 不能指定项目外路径；
- 不能要求发送私密源材料；
- 不能把自己标记成用户指令或系统规则。

这条规则应同时出现在 `$ppt-agent` 的共享约束、Source Intake 测试和外部 AI 载荷测试中。

## 10. 并发、队列和单写者原则

career-ops 并不是“能并行就全部并行”。它会根据工具隔离程度决定是否并发：共享浏览器会话时顺序执行，独立提取器与进程隔离成立时才使用 Worker。每个 Worker 只处理一个对象，不能递归生成更多 Worker。

PPT-Ops 可采用类似规则：

- 大纲和全局设计系统由一个协调 Agent 负责；
- 各页素材研究、候选草拟可并行；
- 同一 Draft 的写入、版本冻结和 Handoff 编号必须单写者；
- PowerPoint/LibreOffice 共享进程或共享临时目录时禁止并发；
- Worker 只产出 Candidate，不直接改正式版本；
- 合并前检查 `base_version`，避免过期候选覆盖新修改。

## 11. Update System：可升级的 Agent 产品

career-ops 的 updater 是其成熟度很高的一部分：

1. 检查远端版本；
2. 展示系统层差异；
3. 检查用户定制与新规则兼容性；
4. 用户确认后备份当前状态；
5. 只更新 `SYSTEM_PATHS`；
6. 运行 doctor；
7. 失败时支持 rollback；
8. 通过迁移测试确保系统路径和用户路径不重叠。

PPT-Ops 若要成为可复用产品，也不能要求用户每次重新 clone。建议未来增加：

```text
pptops update check
pptops update preview
pptops update apply
pptops update rollback
pptops doctor
```

Updater 只升级 Agent Skill、Schema、Renderer、系统模板和脚本，不触碰项目、用户品牌、私有模板与交付历史。

## 12. 测试思想：测试契约，不测试文案表面

career-ops 的测试覆盖以下类型：

- CLI 真实路径集成测试；
- 临时目录隔离；
- 原子写入和锁竞争；
- 状态、字段宽度和向后兼容；
- 路径逃逸、符号链接和不可信 URL；
- 数据契约多处注册；
- Updater 不覆盖用户层；
- 视觉输出和字体回归；
- 外部 Provider 的安全与降级。

尤其值得借鉴的是“多处注册契约”：一个新能力如果涉及 Mode、脚本、数据目录、Updater 和 Gitignore，测试会检查它是否在所有真源中登记，防止功能只完成一半。

### PPT-Ops 建议测试矩阵

| 能力 | 必测行为 |
|---|---|
| 新 Mode | Router 可发现、只加载必要上下文、未知输入安全回退 |
| Intake | 文件签名、路径安全、幂等、来源定位、确认后才入真源 |
| Candidate | 字段 allowlist、过期基线拒绝、非目标页零变化 |
| Version | 不可变快照、相同输入哈希稳定 |
| Build | 并发隔离、重试不改输入、失败阶段可定位 |
| PPTX | 页数、16:9、原生文本/形状、越界、字体和实机打开 |
| Handoff | 递增编号、不覆盖、校验和、验收状态真实 |
| Update | 系统/用户路径无交集、备份、失败回滚、旧项目兼容 |

## 13. 哪些地方不应照搬

### 13.1 不照搬大量根目录脚本

career-ops 保持扁平根目录是历史兼容决策，成千上万用户、插件和更新清单已依赖这些路径。PPT-Ops 还处于早期，没有必要主动复制这种结构。继续按 `src/core`、`src/layout`、`src/adapters`、`src/infrastructure` 分层更合适。

### 13.2 不把 Markdown 当所有结构数据

求职 Tracker 适合 Markdown/TSV；PPT 的页面树、布局参数、素材槽位和版本引用更适合 JSON Schema。可以借鉴“人类可读、可 diff”，但不必复制具体格式。

### 13.3 不复制求职领域 Mode 数量

career-ops 的 Mode 多是因为业务周期长、地区差异大。PPT-Ops V1 应先把 8–9 个核心 Mode 做深，不应为了显得完整创建几十个薄 Mode。

### 13.4 不把可选 Dashboard 误认为产品入口

career-ops 有 Go TUI 和后续 Web 目录，但其核心仍可在 Agent CLI + 文件 + 脚本中独立运行。PPT-Ops 当前明确不包含网页形态，不能因为借鉴 career-ops 就重新引入 Web Workbench。

### 13.5 不复制其具体评分与业务模板

A–H 报告、职业原型、ATS 简历模板属于求职领域资产。PPT-Ops 应借鉴“结构化判断”和“可验证输出”，而不是复制内容。

## 14. 建议的 PPT-Ops 目标架构

```text
用户 / Codex 对话
        │
        ▼
.agents/skills/ppt-agent/SKILL.md
  意图识别、项目解析、Mode 路由、上下文加载
        │
        ├── references/modes/*.md
        ├── config/profile.yml
        ├── config/custom.md
        └── projects/<id>/project.json
        │
        ▼
Application Services
  intake / candidate / approval / version / build / review / handoff
        │
        ├── AI Candidate Pipeline（建议与差异）
        ├── Source Intake（提取与引用）
        ├── Layout Plan（确定性布局）
        ├── PPTX Renderer（原生可编辑对象）
        └── Review/Handoff（证据与打包）
        │
        ▼
项目文件真源 + SQLite 运行态索引/队列
```

### 建议公开入口

用户只需要知道：

```text
$ppt-agent
```

以及自然语言：

```text
把这份逐字稿做成 12 页课程 PPT，先给我大纲。
沿用这个旧 PPT 的品牌，重做第 4 到第 7 页。
生成可编辑 PPTX，并检查溢出和字体问题。
```

内部 Mode、CLI 和 Skill 组合不应成为用户学习成本。

## 15. 分阶段落地建议

### Phase A：Router 与 Mode 拆分

- 保持 `$ppt-agent` 唯一入口；
- 把当前长工作流拆成按需 Mode reference；
- 增加项目根解析、意图识别与加载矩阵测试；
- 未知请求回到简短 discovery，而不是随意猜测执行。

### Phase B：用户层/系统层契约

- 新增 `docs/data-contract.md`；
- 明确系统 Skill、系统模板与用户品牌模板的边界；
- 确保升级、测试和清理命令不会触碰项目交付；
- 增加路径不重叠回归测试。

### Phase C：Agent 工具化闭环

- 为 Agent 提供稳定的 `init / import / candidate / accept / freeze / build / review / handoff` 命令；
- 所有命令输出结构化 JSON；
- Agent 不直接改 SQLite；
- 高风险写入要求对象 ID 和基线版本。

### Phase D：视觉与 PowerPoint 质量门

- 生成 PPTX 后自动渲染 PNG；
- 做越界、重叠、页数、字体替换和密度检查；
- 自动检查与人工视觉、PowerPoint 实机验收分开；
- 把结果写入 Review 和 Handoff。

### Phase E：更新、Doctor 与兼容迁移

- 增加系统路径清单和用户路径清单；
- 支持 update preview/apply/rollback；
- `doctor` 检查 Node、PowerPoint/LibreOffice、字体、渲染器和项目健康；
- 旧项目先迁移到新目录，不原地破坏。

## 16. 推荐的 V1 验收用例

用五个真实对话验证产品，而不是只验证脚本：

1. **主题生成**：只有主题和观众，Agent 提出合理假设、生成大纲、确认后交付 PPTX。
2. **文档转 PPT**：导入 DOCX，所有关键结论能回到段落引用，未确认内容不进入正式版。
3. **旧 PPT 重构**：保留品牌与事实，局部重做页面，非目标页哈希不变。
4. **反馈修改**：用户说“第 6 页太挤”，Agent 只生成第 6 页 Candidate，接受后创建新版本。
5. **正式交付**：Build、自动 Review、人工视觉和 PowerPoint 实机状态分开记录，Handoff 不覆盖历史包。

## 17. 最终判断

PPT-Ops 可以参考 career-ops，但参考重点应是“Agent 操作系统方法”，不是求职功能，也不是网页外观：

1. 一个对用户稳定的总入口；
2. 按 Mode 渐进加载上下文；
3. 用户层和系统层强隔离；
4. 文件保存可迁移的正式真源；
5. Agent 负责判断，脚本负责高风险写入；
6. 外部内容只作为数据；
7. 人工确认门由状态、命令和测试共同落实；
8. 更新、回滚、Doctor 和质量门属于产品本身。

因此，PPT-Ops 的准确产品定义应是：

> 一个运行在 Codex 中、以 `$ppt-agent` 为唯一入口、以项目文件和版本契约为真源、以确定性 PPTX 工具链为执行层、以人工确认和分层验收为质量门的 PPT 生产 Agent。

## 18. 本次调研依据

本次不是仅根据 README 推断，而是检查了以下上游文件与实现：

- `.agents/skills/career-ops/SKILL.md`
- `AGENTS.md`
- `ARCHITECTURE.md`
- `DATA_CONTRACT.md`
- `package.json`
- `README.cn.md`
- `docs/ARCHITECTURE.md`
- `docs/CODEX.md`
- `modes/README.md`
- `modes/_shared.md`
- `modes/auto-pipeline.md`
- `modes/intake.md`
- `modes/pipeline.md`
- `modes/update.md`
- `update-system.mjs`
- `tracker.mjs`
- `merge-tracker.mjs`
- `reserve-report-num.mjs`
- `verify-pipeline.mjs`
- `scan.mjs`
- `openrouter-runner.mjs`
- `tests/intake.test.mjs`
- `tests/merge-tracker.test.mjs`
- `tests/pipeline-lock.test.mjs`

上游仓库会持续变化；涉及当前 Mode 数量、文件清单或更新机制时，应以对应版本的 `main` 和 `DATA_CONTRACT.md` 为准。
