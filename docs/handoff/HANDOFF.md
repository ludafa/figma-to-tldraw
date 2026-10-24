# 交接：Figma → tldraw 还原度 Demo

## 目标

把 Figma 里的一个 section（或 frame）渲染到 tldraw 画布上，和 Figma 自己导出的图片对比，看看还原度如何。现在只是 Demo，**目的是尽快跑通并看到还原度结果**，不追求完整架构。

## 已经确定的决策

- **取数据用自己写的 Figma 插件**，不用 Figma REST API，也不用 MCP
- **渲染**：按 Figma 的节点类型（`node.type`）拆成 React 组件，递归渲染子节点
  - 容器类（FRAME / SECTION / GROUP / INSTANCE / COMPONENT）用 `div`
  - RECTANGLE、ELLIPSE 用 `div` 加上圆角、填充
  - TEXT 单独处理
  - 矢量类（VECTOR / BOOLEAN_OPERATION / STAR / POLYGON / LINE）直接使用插件导出的 SVG
  - 第一版全部用绝对定位：用 `absoluteBoundingBox` 减去父节点坐标
- **接入 tldraw**：一个 section 对应一个自定义图形（比如 `figma-section`），在 ShapeUtil 的 `component` 里渲染整棵树；渲染内容要设置 `pointer-events: none`
- **Demo 阶段不做**：WebSocket 和后端中转、往 Figma 写入、数据精简和去默认值、渲染性能优化、把每个节点拆成单独的 tldraw 图形。这些在 `docs/figma-to-tldraw-plan.md` 里有完整讨论，等 Demo 结果出来再决定

## 现有材料

- `figma-test-cases/`：Figma 插件，有两个功能
  1. **生成测试用例**：新建 `Test Cases` 页面，画出 76 个小用例（每个只测一个特性）和 3 个真实页面
  2. **导出测试数据**：把每个顶层 frame 导出成 zip

  ⚠️ 这个插件**只在模拟的 Figma API 里测过**，还没在真实的 Figma 里跑过。如果我贴出生成失败的日志，请直接修改 `code.js`。插件的说明见 `figma-test-cases/README.md`

- `docs/figma-to-tldraw-demo.md`：Demo 方案（一页）
- `docs/figma-to-tldraw-plan.md`：完整方案（Demo 之后才会用到）

## 导出数据的格式

```
cases/
  index.json                 ← 用例列表：name、dir、width、height、fonts、warnings
  <分类>/<用例名>/
    snapshot.json            ← { meta, rest, svgs }
    expected@2x.png          ← Figma 导出的 2 倍图
    images/<hash>.png        ← 用到的图片
```

- `rest`：`exportAsync({ format: "JSON_REST_V1" })` 的结果，节点树在 `rest.document`
- `svgs`：`{ [nodeId]: svg 字符串 }`。布尔运算会整体导出一个 SVG，不再单独导出它的子节点
- `meta.images`：`{ [hash]: 相对路径 }`。图片填充里的 `imageRef` 应该就是这个 hash（还没在真实数据上确认过）
- 导出的 SVG 包含描边和阴影，尺寸可能比节点本身大。摆放 SVG 时优先用 `absoluteRenderBounds`
- 隐藏图层（`visible: false`）还在节点树里，渲染时要跳过

## 要做的事

1. **搭项目**：Vite + React + TypeScript + tldraw（用当前的最新稳定版，先查一下文档确认 ShapeUtil 的写法）
2. **加载数据**：从 `cases/` 读取 `index.json` 和每个 `snapshot.json`
3. **渲染器**：先只支持 FRAME、RECTANGLE、TEXT 和矢量类，跑通后再按对比结果逐步补充其他特性
4. **tldraw 页面**：把选中的用例放到画布上，能切换不同的用例
5. **对比脚本**：用 Playwright 打开页面，画布缩放固定 100%，`deviceScaleFactor: 2`，对每个用例截图，再和 `expected@2x.png` 对比（比如用 pixelmatch）。输出一份报告，包括每个用例的差异百分比，以及三张图：Figma 原图、渲染结果、差异图。报告按差异从大到小排序
6. **根据报告修复**：差异最大的先修

如果 `cases/` 目录还不存在，先提醒我去 Figma 里运行插件导出数据，在这之前可以先搭项目和渲染器。

## 和我协作的方式

- 用中文回复，语言简单直白，把我当成新手，把事情讲清楚
- 不要用"第一刀"这种说法，用"第一步""最小验证切片"代替
- 只回答我问的问题，不要扯到别的项目上
- 每完成一步，先跑起来看效果，再进行下一步
- 涉及架构的大改动先问我，小的实现细节你自己决定
