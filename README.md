# PPT-Ops

PPT-Ops 是一个面向复杂演讲、课程和商业交付的演示内容生产工作台。

它支持两种输出方式：

- **HTML**：用于快速预览、在线分享和视觉方向确认；
- **PPTX**：用于正式交付、PowerPoint 编辑和现场播放。

两种输出共享同一份项目模型和 `page-spec`，不是先生成 HTML 再转换成 PPTX。

## 当前版本

这是仓库初始骨架，已经包含：

- 项目目录约定；
- 共享页面数据契约；
- HTML/PPTX 输出适配器边界；
- CLI 命令入口；
- 基础项目校验；
- 可运行的示例项目。

实际的内容理解、页面生成、HTML 渲染和原生 PPTX 生成将沿着这套边界逐步接入。

## 快速开始

```bash
npm test
npm run check
node src/cli.js intake examples/demo-project
node src/cli.js outline examples/demo-project
node src/cli.js prototype examples/demo-project --pages 1
node src/cli.js build examples/demo-project --format html
node src/cli.js build examples/demo-project --format pptx
```

当前 `build` 命令会生成输出计划和适配器占位结果；它不会伪装成已经完成 PPTX 生成。

## 项目结构

```text
src/
  cli.js                 CLI 入口
  core/project.js        项目读取和路径约定
  core/validate.js       page-spec 校验
  adapters/html.js       HTML 输出边界
  adapters/pptx.js       PPTX 输出边界
schemas/
  page-spec.schema.json  页面数据契约
examples/demo-project/   最小可运行样例
```

## 设计原则

1. 先定义页面认知任务，再决定视觉构图。
2. 内容真源、项目规则和产物分层保存。
3. 候选稿、当前版本和最终交付物不互相覆盖。
4. HTML 用于快速试错，PPTX 用于正式交付。
5. 结构检查通过不等于视觉和 PowerPoint 播放验收通过。
