# Fidelity 测试用例插件

一个 Figma 插件，做两件事：

1. **生成测试用例**：自动新建一个 `Test Cases` 页面，画出 109 个小用例和 3 个真实页面（2026-10-24 加了 8 个 `image-filter/*` 图片滤镜用例，2026-10-28～10-29 加了 22 个 `text-mixed/*` 混合样式文字用例）
2. **导出测试数据**：把页面上每个顶层 frame 导出成"快照 JSON + 图片 + Figma 渲染图"，打包成一个 zip

## 使用步骤

> 开发中的插件只能在 **Figma 桌面版**里运行。

1. 把这个文件夹解压到电脑上任意位置
2. 打开 Figma 桌面版，新建一个空白文件
3. 菜单 **Plugins → Development → Import plugin from manifest…**，选中文件夹里的 `manifest.json`
4. 运行插件：**Plugins → Development → Fidelity Test Cases**
5. 点 **生成测试用例**，等它跑完（几秒钟）。上面的输入框填一个前缀（比如 `text-mixed/`）就只生成名字以它开头的用例
6. 点 **导出测试数据**，浏览器会下载一个 `figma-test-cases-日期.zip`

想加入你自己的设计稿：在设计稿所在的页面上选中要导出的 frame（在第几层都行），运行插件点导出。不在 `Test Cases` 页面上的 frame 会放进 `cases/real/<文件名>/<页面名>-<frame 名>/`，不会和原来的用例混在一起。不选中时导出页面上所有顶层 frame。

导出的 zip 不要直接解压到 `cases/`（会盖掉原来的 `index.json`），用这个命令合并：

```bash
pnpm --filter @figma-to-tldraw/client import-cases ~/Downloads/figma-test-cases-*.zip
```

完全被裁掉、画不出东西的节点（`absoluteRenderBounds` 为空）不导出 SVG，也不报警告。

**按列表重新导出**：第 3 步"按列表导出"贴一段 `[{"id": "节点 id", "dir": "用例目录"}]`，插件按 id 找节点（能跨页面），按给定的目录导出。已有的用例想原样重导一遍（比如插件导出的内容变了）就用它，目录名不变。

**主组件**：导出时会顺带导出用例里实例用到的主组件和整套变体（变体超过 60 个的只导用到的），放在 `snapshot.json` 的 `mains` 里。主组件被删掉的实例原样导出，记一条警告。详见 `apps/docs/figma-to-tldraw/tech.md` §16.1。

**字体**：用例只能用开源、能从 npm 装上的字体（`apps/client/src/figma/fonts.ts` 的 `OPEN_FONTS`），`import-cases` 会跳过用到其他字体的用例。挑社区稿子时先看它用的字体（`tech.md` §15）。

## 导出的数据长什么样

```
cases/
  index.json                ← 所有用例的列表
  fill/solid/
    snapshot.json           ← 渲染用的输入
    expected@2x.png         ← Figma 自己渲染的图（2 倍图），用来对比
  image/fill/
    snapshot.json
    expected@2x.png
    images/<hash>.png       ← 用到的原始图片
    images/<hash>-filtered-1.png  ← 带滤镜的图片，Figma 渲染好的版本（有滤镜时才有）
  ...
```

`snapshot.json` 里有六部分：

| 字段 | 内容 |
| --- | --- |
| `rest` | `exportAsync({ format: "JSON_REST_V1" })` 的原始结果，也就是节点树 |
| `svgs` | 矢量类节点（VECTOR、布尔运算、星形、多边形、线、椭圆）单独导出的 SVG，key 是节点 id |
| `transforms` | 每个节点（包括隐藏的和主组件里的）的 `absoluteTransform`（2×3 矩阵）和节点本身的宽高 `{ m, w, h }`。REST 格式里没有这些，旋转的节点要靠它摆放 |
| `meta` | 用例名、尺寸、用到的字体、图片文件路径、图片原始尺寸（`imageSizes`）、蒙版图层的填充路径（`masks`）、导出时的警告、主组件个数（`mains`）和主组件用到的字体（`mainFonts`） |
| `mains` | 用例外面的主组件和组件集，key 是它的 node id，值是 `JSON_REST_V1` 导出的节点树（太大的组件集是只含用到的变体的 `partial: true` 组件集） |
| `textSegments` | 文字图层的 `getStyledTextSegments` 结果：段间距、首行缩进、列表间距、装饰线的样式 / 粗细 / 偏移 / 颜色 / 跳过下伸部分，key 是节点 id。REST 格式里丢了这些（`apps/docs/skia-engine/tech.md` §11.4）。只有分段数 ≥ 2 或者带装饰线的文字图层才有 |

几点说明：

- **图片**：节点里图片填充的 `imageRef` 就是图片 hash，对应 `meta.images` 里的文件路径
- **图片滤镜**：图片填充调了曝光、对比度等滤镜时，插件让 Figma 按原图尺寸渲染一份带滤镜的图，`meta.filteredImages` 里记 `<imageRef>?<滤镜>` → 文件路径。渲染时临时建一个矩形，导完马上删掉（详见 `apps/docs/figma-to-tldraw/tech.md` §6.8）
- **SVG 的位置**：导出的 SVG 包含了描边和阴影，所以它的尺寸可能比节点本身大。摆放时可以用节点的 `absoluteRenderBounds`（包含描边、阴影在内的实际渲染范围），而不是 `absoluteBoundingBox`
- **隐藏图层**：节点树里还在（`visible: false`），也记位置（`transforms`），但不会导出它的 SVG
- **蒙版图层**：单独导出 SVG 会失败，所以不导 SVG，改为在 `meta.masks` 里给出它的 `fillGeometry` 路径（节点自己的坐标系）
- **字体**：`meta.fonts` 列出了用到的字体。浏览器那边要装同样的字体，否则对比结果没有意义

## 用例清单

| 分类 | 用例 |
| --- | --- |
| fill | 纯色、线性渐变、旋转的线性渐变、径向、角度、菱形渐变、带透明度的渐变、填充透明度和图层透明度、多层填充 |
| radius | 统一圆角、四角不同、超出尺寸的圆角（胶囊形）、平滑圆角（iOS 风格） |
| shape | 椭圆、圆弧、多边形、星形、线 |
| stroke | 内描边、居中描边、外描边、虚线、四边粗细不同、渐变描边、线帽和拐角 |
| effect | 投影、扩展投影、多重投影、内阴影、图层模糊、背景模糊 |
| text | 单行、自动换行、段落间距、行高、字间距、水平对齐、垂直对齐、混合样式、下划线和大小写、中英文混排、省略号截断、固定尺寸文字溢出 |
| text-mixed | 同一个文字图层里混字号、行高、字体、字重、字间距、颜色、渐变、下划线和删除线（波浪线、点线、粗细、偏移、颜色、跳过下伸部分）、大小写、对齐、截断、列表、首行缩进和段间距、中英文、描边和投影（清单见 `apps/docs/skia-engine/tech.md` §11.1） |
| vector | 填充路径、心形、8 个线条图标、开放曲线、两种填充规则 |
| boolean | 合并、减去、相交、排除 |
| image | FILL、FIT、CROP、TILE、圆角和头像、图片透明度 |
| container | 嵌套 frame、裁剪开和关、圆角裁剪、旋转、group、group 透明度、frame 投影 |
| blend | multiply、screen、overlay |
| mask | 椭圆蒙版图片、星形蒙版渐变 |
| component | 主组件和两个实例（其中一个改了文字和颜色） |
| layout | 横向、纵向撑满、自动换行、绝对定位子元素 |
| misc | 隐藏图层、小数坐标和细线 |
| page | 手机登录页、商品列表页、图片墙 |

测试图片由插件现场生成，四个角分别是红、绿、蓝、黄色块，方便检查裁剪和缩放的方向对不对。

## 可能遇到的问题

- **某个用例生成失败**：插件会跳过它，继续生成其他用例，失败原因显示在插件底部的日志里。我没法在真实的 Figma 里跑，只用模拟环境测过，所以碰到这种情况可以把日志发给我
- **中文显示成方块或者字体不对**：插件会依次尝试 Noto Sans SC、PingFang SC、思源黑体和微软雅黑，日志第一行会显示最后用的是哪个
- **点了导出没有反应**：看看 Figma 有没有弹出保存文件的对话框，或者去下载文件夹里找一下
