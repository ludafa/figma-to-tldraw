# Figma → tldraw 还原度 Demo

## 目标

把 Figma 里的一个 section 画到 tldraw 画布上，跟 Figma 的导出图对比，看看还原度如何。

## 链路

```
Figma 插件  →  快照 JSON  →  tldraw 页面（一个自定义图形）
```

Demo 阶段**先不做 WebSocket**：插件把快照复制到剪贴板或下载成文件，tldraw 页面再粘贴或加载进来。检查还原度用不到实时通信，等 Demo 跑通了再接上。

## 1. 插件：导出快照

选中一个 section，导出一份 JSON：

- 节点数据：用 `exportAsync({ format: "JSON_REST_V1" })` 导出
- 矢量和布尔运算节点：直接用 `exportAsync({ format: "SVG" })` 导出成 SVG 字符串，嵌进快照里
- 图片：用 `getImageByHash(hash).getBytesAsync()` 读出来，转成 base64 嵌进快照（Demo 阶段不用考虑数据大小）
- 同时导出这个 section 的 PNG，用来做对比

## 2. 渲染：按节点类型写组件

| 节点类型                                       | 渲染方式                          |
| ---------------------------------------------- | --------------------------------- |
| FRAME / SECTION / GROUP / INSTANCE / COMPONENT | `div`，绝对定位                   |
| RECTANGLE / ELLIPSE                            | `div`，加上圆角和填充             |
| TEXT                                           | `div`，加上字体、字号、行高、颜色 |
| VECTOR / BOOLEAN_OPERATION / STAR / LINE 等    | 直接嵌入插件导出的 SVG            |
| 其他不支持的类型                               | 用 PNG 兜底                       |

坐标：用 `absoluteBoundingBox` 减去父节点的坐标。

## 3. tldraw：一个自定义图形

- 写一个 `figma-section` 图形，在 `component` 里渲染整棵树
- 渲染内容设置 `pointer-events: none`

## 4. 看还原度

- 把 tldraw 里的渲染结果和 Figma 导出的 PNG 叠在一起对比
- 记录差异主要出在哪里，比如文字、描边、阴影、图片裁剪

## Demo 之后再说

写入 Figma、后端中转和配对、去默认值、渲染性能、拆成多个图形——这些都等 Demo 结果出来后，按实际情况决定。完整方案见 `figma-to-tldraw-plan.md`。
