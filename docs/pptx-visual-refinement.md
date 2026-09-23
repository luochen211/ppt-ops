# 现有 PPTX 视觉润色（第一阶段）

PPT-Ops 可以先检查一份现有 PPTX，并创建受控的对象级视觉修改范围。第一阶段建立检查与授权合同，不会修改或重新生成原演示文稿。

## 检查原稿

```bash
pptops refinement-inspect ./my-project --file ./existing-deck.pptx
```

该命令会：

- 将原文件按 hash 不可变保存为项目 Source；
- 列出每页可定位的文字框、图片、基础形状和图形框；
- 为对象生成由页码、原生对象 ID 和内容/几何指纹组成的稳定 ID；
- 只保存文字 hash，不把原稿文字复制进检查报告；
- 报告动画、SmartArt、图表、媒体和 OLE 等尚不能安全修改的特性；
- 明确记录真实 PowerPoint 验收仍为 `pending`。

## 声明修改范围

从检查结果选择对象 ID，并且只列出允许修改的视觉属性：

```bash
pptops refinement-scope-propose ./my-project \
  --source source-0123456789ab \
  --payload '{"actor":"user:syna","targets":[{"slide":1,"object_id":"slide-001-object-2-0123456789abcdef","properties":["position","font_size"],"objective":"改善标题层级"}]}'
```

文字框可以声明位置、尺寸、字体、字号、字重、行距、填充、线条和文字颜色；图片可以声明位置、尺寸和裁切；基础形状可以声明位置、尺寸、填充和线条。正文修改、页序调整、整页替换和不支持对象编辑会确定性失败。

Scope 会固定以下保留规则：文字、事实、数字、页序、未选页面和未授权属性保持不变。自动范围检查、修改前后预览、真实 PowerPoint 检查和用户决定分别记录，不能互相替代。

## 当前限制

第一阶段尚不应用 OOXML 修改，也不生成润色后的 PPTX。后续实现必须消费这里生成的 Inspection 与 Scope，产出独立候选文件和前后对照，并证明未选页面及未授权属性没有改变。
