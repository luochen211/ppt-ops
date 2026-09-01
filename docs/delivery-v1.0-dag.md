# PPT-Ops V1.0 交付 DAG

> 用途：将完整 V1.0 拆成可独立验收、可并行、可在 Orca 中追踪的任务图。  
> 原则：上游 Contract 和状态机未冻结前，不允许下游各自发明共享模型。

## 1. 任务图

```text
T1 产品备案与系统架构
  |
  v
T2 V1 Contract、状态机与迁移
  |
  +----------+-----------+-----------+-----------+
  v          v           v           v           v
T3 Web     T4 Source    T5 AI       T6 Layout   T7 Build/
Workbench  Intake       Pipeline    + Renderers Infra
  \          |           |           /           /
   +---------+-----------+----------+-----------+
                         |
                         v
                 T8 端到端集成与验收
                         |
                         v
                 T9 文档、发布与用户验收
```

T3–T7 可在 T2 合并后并行，但每个任务必须有独立 worktree、文件边界和集成契约。

## 2. T1：产品备案与系统架构

### 交付

- `docs/product-v1.0-blueprint.md`
- `docs/architecture-v1.0.md`
- `docs/delivery-v1.0-dag.md`
- README 中的产品状态和 V1 文档入口
- T2–T9 GitHub Issues 及依赖关系

### 验收

- 产品、架构和 DAG 三份文档对 V1 范围、非目标、双渲染、AI 边界、人工确认和发布标准无冲突；
- 明确当前 CLI 只是 Foundation；
- 后续每个 Issue 有可观察产物、文件边界、测试命令和不得宣称的验收边界；
- 只修改文档和任务管理，不实施 T2–T9 业务代码。

## 3. T2：V1 Contract、状态机与迁移

### 依赖

T1

### 交付

- Project、Source、Outline、PageSpec、Theme、Template、Asset、Candidate、Approval、Version、Build、Review、Handoff Contract；
- 候选、版本、构建、验收状态机；
- v0.1/Foundation 到 V1 的只读迁移器；
- Schema fixture、语义验证和迁移回归测试；
- Contract 版本策略和 ADR。

### 文件边界

Contract/Core 包、Schema、migration、fixture 和专项测试。不实现 Web、AI Provider、最终模板或新渲染 UI。

### 验收

- 所有 Contract fixture 通过；
- 非法状态转移失败；
- 当前 demo 可迁移且重复迁移结果一致；
- 迁移不修改源项目；
- 新建项目只写 V1 Contract。

## 4. T3：Web Workbench

### 依赖

T2

### 交付

- 项目列表、项目创建/导入、Brief 和真源界面；
- Outline 和 Page Spec 编辑器；
- 候选对比、接受/拒绝与版本确认界面；
- HTML 预览、Build 状态和 Review/Handoff 证据界面；
- 基于 Core API 的前端数据层；
- 可访问性、错误态和关键用户流程测试。

### 文件边界

Web 应用、其专属测试和最小 API client。不复制 Core 规则，不直接读写项目 JSON/SQLite。

### 验收

- 不修改代码可完成创建项目到发起构建的主流程；
- 候选未确认时不得进入已批准版本；
- 所有长任务有进度、失败和重试入口；
- 完成核心页面视觉与键盘可访问性验收。

## 5. T4：Source Intake

### 依赖

T2

### 交付

- Markdown、DOCX、PPTX 导入与归一化提取；
- 来源引用和位置定位；
- 文件哈希、MIME、大小、解析器版本与重复导入策略；
- 受控解压、资源限制和恶意文件失败证据；
- 提取结果的预览和人工修正接口。

### 验收

- 三种核心文件都有可重复 fixture；
- 来源引用可回到文件和位置；
- zip slip、超限文件和伪造类型被拒绝；
- 重复导入不会静默创建冲突真源。

## 6. T5：AI Candidate Pipeline

### 依赖

T2

### 交付

- 材料摘要、Outline、Page Spec、文案压缩、关系与模板推荐任务；
- Provider-neutral interface 和至少一个可配置 Provider adapter；
- 最小载荷组装、隐私策略和字段排除；
- 结构化输出校验、重试与 Candidate 差异；
- 局部重新生成；
- 外部载荷与非目标页不变回归测试。

### 验收

- 私密原文不出现在未授权的外部请求；
- 非结构响应和 Contract 失败不修改 Draft；
- 候选可查看来源、修改字段和差异；
- 局部重生成对非目标已批准页的修改数为 0。

## 7. T6：Template、Layout 与 Renderers

### 依赖

T2

### 交付

- 首批至少 8 种语义模板；
- Design Token 和项目/单页覆盖规则；
- 确定性 Layout Plan；
- 容量、文本溢出、素材比例和几何检查；
- HTML 导航、响应式预览和受控动效；
- PPTX 原生文本、形状、图片裁切、字体和标准图表；
- PDF/PNG 派生输出策略；
- 双渲染语义一致性和截图回归。

### 验收

- 8 种模板均对 HTML 和 PPTX 有可重复 fixture；
- 相同 Version + Build config 产生结构稳定产物；
- 文本超容量时明确失败或产生待确认拆页候选，不静默缩成不可读；
- 两端共享内容与页面任务一致，不要求像素一致。

## 8. T7：Project、Build 与 Handoff Infrastructure

### 依赖

T2

### 交付

- 本地项目注册、SQLite schema 和文件存储适配；
- Candidate / Approval / Version / Build / Review / Handoff 持久化；
- 持久化构建队列、取消、重试、恢复和日志；
- 版本快照、差异和产物追溯；
- Review 人工验收记录和 Handoff 历史；
- 本地 API 和任务事件流。

### 验收

- 服务重启后队列与任务状态可恢复；
- 失败重试保留原证据；
- 输入变更时创建新 Build，不篡改原 Build；
- Handoff 只包装指定已审查 Build；
- 并发任务不互相覆盖产物。

## 9. T8：端到端集成与验收

### 依赖

T3、T4、T5、T6、T7

### 交付

- 五个标准项目和一个 50+ 页真实复杂项目；
- 全链路 E2E；
- HTML 截图回归；
- PPTX 结构、字体、几何和文本风险检查；
- Chrome/Safari 和 macOS PowerPoint 验收记录；
- 隐私载荷、恶意文件、路径越界、失败恢复和并发风险测试；
- 性能基线和不稳定测试清单。

### 验收

- `product-v1.0-blueprint.md` 第 14.1–14.3 条件有对应证据；
- 任何未完成的实机验收都保持 pending；
- 端到端构建成功率基线可重复测量；
- 所有高风险失败均留下可执行原因。

## 10. T9：文档、发布与用户验收

### 依赖

T8

### 交付

- 安装、升级、备份、恢复和故障排查文档；
- 开发者 Contract、API、Template 和 Provider adapter 文档；
- 完整 Demo 与快速上手；
- 发布自动化、版本标签、发布说明和可恢复产物；
- 三位目标用户的独立试用记录；
- V1.0 验收矩阵与未完成限制。

### 验收

- 三位用户在不修改代码的情况下完成导入到交付；
- 第 14 节所有 V1.0 发布条件有证据或明确阻塞；
- 只有全部必要条件通过时才创建 V1.0 GA tag/release；
- 推送、CI、发布、安装和真实用户验收分开报告。

## 11. 并行波次

| 波次 | 任务 | 最大建议并发 | 解锁条件 |
|---|---|---:|---|
| 0 | T1 | 1 | 产品和架构文档合并 |
| 1 | T2 | 1 | Contract 和迁移测试合并 |
| 2 | T3–T7 | 3–4 | 每个任务的 API/Contract fixture 冻结 |
| 3 | T8 | 1–2 | T3–T7 全部达到集成入口 |
| 4 | T9 | 1 | T8 验收矩阵完成 |

任何两个并行 Worker 不得同时拥有：公共 Schema、公共类型、根 package 配置、数据库迁移或 CI 真源。这些文件由对应上游任务或集成 Worker 统一维护。

## 12. Orca 执行规则

- 协调工作区只维护 DAG、边界、合并和验收；
- 每个实施任务使用独立 Orca worktree；
- 每个 Worker 一次只负责一个 GitHub Issue；
- 任务说明必须包含依赖、允许文件、禁止文件、验收命令和完成边界；
- Worker 完成代码不等于任务 Done，还需要 PR、CI 和对应层级的验收；
- 共享契约冲突必须回到协调者，不允许下游 Worker 私自新建一套兼容模型；
- 未达到依赖解锁条件的任务保持 Blocked，不提前开发。
