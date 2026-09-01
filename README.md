# PPT-Ops 1.0

PPT-Ops 是一个本地优先的演示内容生产工作台。它让同一份结构化项目和页面规格分别生成可直接打开的 HTML 演示文稿与可编辑的 PPTX 文件；PPTX 不是由 HTML 转换而来。

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

`init` 会创建一套可直接校验和构建的 1.0 项目骨架，并拒绝覆盖非空目录。`deliver` 按 `project.json` 中配置的 HTML/PPTX 输出执行构建、自动检查和交付打包；它不会把自动检查表述为视觉验收或真实 PowerPoint 验收。现有 0.1 项目仍可读取和构建。

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
project.json                  项目元数据、源文件和主题/资产清单入口
pages.json                    两种 renderer 共享的页面语义规格
theme.json                    16:9 尺寸、字体、颜色与间距
assets.json                   本地资产声明
assets/                       项目资产
outputs/                      生成物（不纳入 Git）
```

仓库实现位于：

```text
src/cli.js                    CLI 入口
src/core/                     项目加载与校验
src/adapters/html.js          自包含 HTML renderer
src/adapters/pptx.js          原生 PPTX renderer
src/review/                   review 报告
src/handoff/                  handoff 打包与校验和
schemas/                      v0.1 共享数据契约
examples/demo-project/        可重复构建的 demo
```

## 验收边界与已知限制

自动测试与 `review` 可以证明项目结构有效、HTML 已生成、PPTX 包结构为 16:9、页数正确且未发现负坐标；它们不能证明视觉质量，也不能证明 Microsoft PowerPoint 中的真实编辑、字体替换、动画或现场播放效果。`review-report.json` 会把视觉验收和真实 PowerPoint 验收明确保留为 `pending`。

V1.0 不提供 HTML/PPTX 像素级一致保证、HTML 转 PPTX、浏览器协作编辑、在线托管/分享、现有 PPTX 往返编辑或自动补造业务事实。HTML 资源内嵌并支持键盘翻页；PPTX 使用本机可用字体，换机时可能发生字体替换。

CI 在 push 与 pull request 上运行 `npm ci`、全部测试、两种 demo build、`review` 和 `handoff`。CI 成功仍不替代上述人工视觉与真实 PowerPoint 验收。
