# Fidelity 测试用例插件

一个 Figma 插件，做两件事：

1. **生成测试用例**：自动新建一个 `Test Cases` 页面，画出 76 个小用例和 3 个真实页面
2. **导出测试数据**：把页面上每个顶层 frame 导出成"快照 JSON + 图片 + Figma 渲染图"，打包成一个 zip

## 使用步骤

> 开发中的插件只能在 **Figma 桌面版**里运行。

1. 把这个文件夹解压到电脑上任意位置
2. 打开 Figma 桌面版，新建一个空白文件
3. 菜单 **Plugins → Development → Import plugin from manifest…**，选中文件夹里的 `manifest.json`
4. 运行插件：**Plugins → Development → Fidelity Test Cases**
5. 点 **生成测试用例**，等它跑完（几秒钟）
6. 点 **导出测试数据**，浏览器会下载一个 `figma-test-cases-日期.zip`

想加入你自己的设计稿：在设计稿所在的页面上选中要导出的 frame（在第几层都行），运行插件点导出。不在 `Test Cases` 页面上的 frame 会放进 `cases/real/<文件名>/<页面名>-<frame 名>/`，不会和原来的用例混在一起。不选中时导出页面上所有顶层 frame。

导出的 zip 不要直接解压到 `cases/`（会盖掉原来的 `index.json`），用这个命令合并：

```bash
pnpm --filter @figma-to-tldraw/client import-cases ~/Downloads/figma-test-cases-*.zip
```

完全被裁掉、画不出东西的节点（`absoluteRenderBounds` 为空）不导出 SVG，也不报警告。

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
  ...
```

`snapshot.json` 里有四部分：

| 字段 | 内容 |
| --- | --- |
| `rest` | `exportAsync({ format: "JSON_REST_V1" })` 的原始结果，也就是节点树 |
| `svgs` | 矢量类节点（VECTOR、布尔运算、星形、多边形、线、椭圆）单独导出的 SVG，key 是节点 id |
| `transforms` | 每个可见节点的 `absoluteTransform`（2×3 矩阵）和节点本身的宽高 `{ m, w, h }`。REST 格式里没有这些，旋转的节点要靠它摆放 |
| `meta` | 用例名、尺寸、用到的字体、图片文件路径、图片原始尺寸（`imageSizes`）、蒙版图层的填充路径（`masks`）、导出时的警告 |

几点说明：

- **图片**：节点里图片填充的 `imageRef` 就是图片 hash，对应 `meta.images` 里的文件路径
- **SVG 的位置**：导出的 SVG 包含了描边和阴影，所以它的尺寸可能比节点本身大。摆放时可以用节点的 `absoluteRenderBounds`（包含描边、阴影在内的实际渲染范围），而不是 `absoluteBoundingBox`
- **隐藏图层**：节点树里还在（`visible: false`），但不会导出它的 SVG
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
