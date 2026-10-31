# Figma 还原到 tldraw：施工计划

> 相关：[模块说明](README.md) · [技术实现](tech.md) · [验证方案](verification.md)
>
> 制定时间：2026-10-24
> 来源：交接材料 `figma-tldraw-handoff.zip`（HANDOFF.md、figma-to-tldraw-demo.md、figma-to-tldraw-plan.md），加上 2026-10-24 用户的三条调整；交接材料里的打算现在各是什么状态见 §9
>
> 2026-10-31 → 修订：原来放在仓库根目录 `docs/施工计划.md`，现在挪进本模块，章节编号和步骤编号都不变。交接材料 `docs/handoff/` 删掉了，要点并进 §9，协作方式并进根目录 `CLAUDE.md`「协作方式」；原文在提交 `24be4d2` 里（`git show 24be4d2:docs/handoff/HANDOFF.md`）。理由：功能和计划类文档统一放 `apps/docs/`，项目怎么干活的规矩放 `CLAUDE.md` 和 skill（用户要求）。

## 1. 目标

把 Figma 里的设计稿画到 tldraw 画布上，和 Figma 自己导出的图片逐像素对比，算出还原度。现在只做 Demo，目标是尽快跑通、拿到结果。

## 2. 和交接文档相比改了什么

| 项目         | 交接文档                                   | 现在                                                                                          |
| ------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------- |
| 项目底座     | Vite + React + TypeScript 从头搭           | 用 seed 项目 `git@github.com:ludafa/hono-mono-starter.git`（用户拍板）                        |
| tldraw 版本  | 最新稳定版                                 | 3.x 的最新版 **3.15.6**，2026-02-11 发布，支持 React 19（用户拍板；npm 上最新是 5.5.2，不用） |
| 图形怎么对应 | 整个 section 一个自定义图形；Demo 阶段不拆 | **每个 Figma 节点一个 tldraw 自定义图形**，每个图层能单独选中、移动（用户拍板）               |

不用 tldraw 自带的图形（它们是手绘风格，颜色也只能从固定的几种里选），全部用自定义图形，里面用普通的 HTML、CSS 和 SVG 按 Figma 的样式画。

## 3. tldraw 3.x 的两个限制

在 3.15.6 的源码里查到的，决定了后面哪些地方难做：

- **图形在网页里是平铺的。** 父图形和子图形是同一层的兄弟 `div`（`.tl-shape`），"谁是谁的父级"只记在数据里。所以没法像普通网页那样靠嵌套 `div` 加 `overflow: hidden` 来裁剪。
- **只有 tldraw 自带的 `frame` 能裁剪子图形。** 源码里写死了只认 `frame` 类型（`@tldraw/editor` 的 `Editor._getShapeMaskCache`）。自定义图形没有裁剪接口，4.x 才加了 `getClipPath` 和 `BaseFrameLikeShapeUtil`。
- **子图形的透明度是各级父图形透明度乘起来**（`Editor.js` 里的 `opacity *= shape.opacity`），分别作用在每个子图形上，而不是像 Figma 那样整组一起变透明。

## 4. 一套自定义图形

| tldraw 图形    | 对应的 Figma 节点                                      | 怎么画                                            |
| -------------- | ------------------------------------------------------ | ------------------------------------------------- |
| `figma-frame`  | FRAME、COMPONENT、INSTANCE、SECTION、GROUP             | `div`：填充、圆角、描边、阴影                     |
| `figma-rect`   | RECTANGLE、ELLIPSE                                     | `div`：填充（包括图片）、圆角、描边；圆弧改用 SVG |
| `figma-text`   | TEXT                                                   | `div`：字体、字号、行高、颜色、对齐               |
| `figma-vector` | VECTOR、BOOLEAN_OPERATION、STAR、REGULAR_POLYGON、LINE | 直接放插件导出的 SVG                              |

注意：多边形在插件 API 里叫 `POLYGON`，但导出的节点数据（REST 格式）里叫 `REGULAR_POLYGON`，渲染时按后者认（2026-10-24 看真实数据发现）。

渲染内容设置 `pointer-events: none`，选中和拖动交给 tldraw 处理。

### 4.1 转换：把节点树拆成一串图形

中间要加一步转换（纯函数），输入 `snapshot.json`，输出要创建的 tldraw 图形列表：

1. 跳过隐藏图层（`visible: false`）
2. 算出每个节点相对父级的位置（先用 `absoluteBoundingBox` 减父节点坐标；旋转的节点等拿到真实数据再定用哪个字段）
3. 按 Figma 的图层顺序排好上下层
4. 每个图形的 props 只带自己这个节点的数据，不带子节点；子节点是单独的图形，用 `parentId` 指向父图形

交接文档里"去默认值、数据精简"那部分转换，Demo 阶段仍然不做。

## 5. 难点和打算怎么做

| 难点                            | 原因                                                              | 打算怎么做                                                                                                                  |
| ------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| frame 裁剪                      | 自定义图形不能裁剪子图形（§3）                                    | 子图形自己裁：找出所有开了裁剪的上级 frame，把它们的形状（包括圆角）换算到自己的坐标里，用 CSS `clip-path` 裁掉多出来的部分 |
| 蒙版                            | 蒙版图层和被遮住的图层是不同的图形                                | 和裁剪用同一套办法：用蒙版图层的形状裁它上面的兄弟图层                                                                      |
| 组透明度                        | 透明度分别作用在每个子图形上，子图形重叠的地方会比 Figma 深（§3） | 先当已知差异，看报告里差多少                                                                                                |
| 混合模式、背景模糊              | 每个图形外面都包着 tldraw 的一层 `div`，效果可能被隔开            | 实际测试，不行再想办法                                                                                                      |
| Tailwind 的样式重置             | seed 用了 Tailwind v4，它会重置一些默认样式                       | 渲染组件里把样式写全，不依赖浏览器默认值                                                                                    |
| tldraw 3.x 和 Vite 8 能否一起用 | 没验证过                                                          | 第 0 步就验证                                                                                                               |

**备选办法：** 如果组透明度、蒙版这类差得太多，可以把那一小块合成一个图形来画。这属于架构改动，到时候先问用户。

## 6. 步骤

清单用法：`- [ ]` 是没做，`- [x]` 是做完了，做完时在后面写上日期。每一步做完都先给用户看效果，确认后再进下一步。

### 第 0 步：搭项目

**0.1 复制 seed**

- [x] 把 seed 克隆到临时目录，把除 `.git` 以外的文件复制到 `/Users/oliver/code/figma-to-tldraw`（seed 根目录没有 `docs/`，不会覆盖这份计划）（2026-10-24）
- [x] `git init`，默认分支 `main`（2026-10-24）
- [x] 按 seed 自带的 `rename-template` skill 改名：`hono-mono-starter` → `figma-to-tldraw`，`@hono-mono-starter/*` → `@figma-to-tldraw/*`（三个 `package.json`、根目录脚本里的 `--filter`、`index.html` 标题、两个 layout 里的品牌文字、`README.md`、`CLAUDE.md`、`.claude/settings.json`、`.claude/skills/`）（2026-10-24）
- [x] 用 `grep -rn hono-mono-starter` 检查有没有漏改的（2026-10-24）

**0.2 装依赖、初始化**

- [x] `cp .env.example .env`；`cp apps/server/.env.example apps/server/.env`，用 `openssl rand -base64 32` 生成 `BETTER_AUTH_SECRET` 填进去（2026-10-24）
- [x] `pnpm install`（2026-10-24）
- [x] `pnpm bootstrap`（数据库迁移、生成 OpenAPI 和前端接口代码）（2026-10-24）
- [x] `pnpm dev:server` 和 `pnpm dev:client` 都能启动，`http://localhost:5173` 能打开（2026-10-24）
- [x] 什么都没改的 seed 先跑一遍 `pnpm lint` 和 `pnpm typecheck`，确认本来就是通过的，后面出错才知道是自己改出来的（2026-10-24）
- [x] 提交 git：`chore: init from hono-mono-starter`（2026-10-24，只提交到本地）

**0.3 装 tldraw，加 `/canvas` 页面**

- [x] `pnpm --filter @figma-to-tldraw/client add tldraw@3.15.6`（写死版本号）（2026-10-24）
- [x] 查 3.15.6 的自定义图形写法（官方文档 + 包里的类型定义），记下要用到的：`static type`、`static props`、`getDefaultProps`、`getGeometry`、`component`、`indicator`、`canResize`、自定义图形的类型怎么声明（2026-10-24）
- [x] 新建 `apps/client/src/routes/canvas.tsx`（放在 `_app` 外面，不需要登录）和 `apps/client/src/pages/canvas.tsx`：全屏显示 `<Tldraw />`，引入 `tldraw/tldraw.css`（2026-10-24）
- [x] 开发模式下把 editor 挂到 `window.editor`，方便调试，后面 Playwright 也要用（2026-10-24）
- [x] 检查：打开 `http://localhost:5173/canvas` 能看到画布，用自带工具画个矩形没问题，控制台没有报错（顺便验证了 tldraw 3.x 和 Vite 8 能一起用）（2026-10-24）
- [x] 检查：tldraw 的工具栏、菜单显示正常，没被 Tailwind 的样式重置弄乱（2026-10-24）
- [x] 提交 git：`feat(client): add tldraw canvas page`（2026-10-24，只提交到本地）
- 偏差：顺手给 client 加了 `typecheck` 脚本（原来 `pnpm typecheck` 只查 server），并提前装了第 3 步要用的 `playwright`、`pixelmatch`、`pngjs`；`pnpm-workspace.yaml` 里给 `core-js` 的安装脚本设成 `false`（它只打印广告）。检查时发现画布右下角有 "MADE WITH TLDRAW" 水印

**0.4 放交接材料**

- [x] 插件 `figma-test-cases/` 复制到 `apps/figma-plugin/`（`code.js`、`ui.html`、`manifest.json`、`README.md`）（2026-10-24，提前做，方便用户从最终位置导入插件）
- [x] 跑 `pnpm lint`。插件是不经过打包的纯 JS（用的是 `var`），如果报错，就在 `.oxlintrc.json` / `.oxfmtrc.json` 里把这个目录排除掉，不改插件的写法（2026-10-24）
- [x] 按 seed 的 `feature-docs` 规矩建 `apps/docs/figma-to-tldraw/`：`README.md`（模块入口），`tech.md`（整理交接文档里的方案和本计划 §3～§5），然后跑 `pnpm docs:index`（2026-10-24）
- [x] 问用户：这份 `docs/施工计划.md` 要不要挪成 `apps/docs/figma-to-tldraw/plan.md` → 用户开了 /goal 要求一口气做完，按默认处理：留在 `docs/`，在 `apps/docs/figma-to-tldraw/README.md` 里链接过去；交接原始材料复制到 `docs/handoff/`（2026-10-24）
  > 2026-10-31 → 修订：本计划挪成了 `apps/docs/figma-to-tldraw/plan.md`，`docs/handoff/` 删掉，要点见 §9（用户要求）。
- [x] `.gitignore` 加上 `cases/` 和 `reports/`（2026-10-24）
- [x] 检查：`pnpm lint`、`pnpm typecheck` 通过（2026-10-24）
- [x] 提交 git：`chore: add figma plugin and docs`（2026-10-24，只提交到本地）
- [x] 给用户看效果（2026-10-24，用户开了 /goal，最后统一汇报）

### 第 1 步：最小验证切片

**1.1 数据类型**

- [x] `apps/client/src/figma/types.ts`：写出 Demo 用到的 Figma 节点字段的类型（`id`、`name`、`type`、`visible`、`absoluteBoundingBox`、`absoluteRenderBounds`、`fills`、`strokes`、`strokeWeight`、`cornerRadius`、`opacity`、`characters`、`style`、`children` 等），只写用得到的（2026-10-24）
- [x] 同一个文件里写快照的类型：`{ meta, rest, svgs }`，和插件导出的格式一致（2026-10-24）

**1.2 手写一份假数据**

- [x] `apps/client/src/figma/fixtures/hello.json`：一个 400×300 的白色 frame，里面有一个蓝色圆角矩形、一行文字 "Hello tldraw"、一个心形矢量（SVG 字符串手写）（2026-10-24）
- [x] 格式和插件导出的 `snapshot.json` 完全一样，以后换成真实数据不用改代码（2026-10-24）

**1.3 四个自定义图形**

- [x] 在 `apps/client/src/figma/shapes/` 下写四个 ShapeUtil：`figma-frame`、`figma-rect`、`figma-text`、`figma-vector`（2026-10-24）
- [x] 每个图形的 props：`w`、`h`、`node`（这个节点自己的数据，不带 `children`）；`figma-vector` 多一个 `svg`（2026-10-24）
- [x] `getGeometry`：都用矩形；ELLIPSE 用椭圆，这样点到椭圆外面的角上不会选中它（2026-10-24）
- [x] 关掉缩放和旋转（这一版只支持选中和移动）（2026-10-24）
- [x] 画法先做最简版：（2026-10-24）
  - [x] `figma-frame`：纯色填充、统一圆角（2026-10-24）
  - [x] `figma-rect`：纯色填充、统一圆角；ELLIPSE 用 `border-radius: 50%`（2026-10-24）
  - [x] `figma-text`：字体、字号、颜色、行高，只处理整段是同一种样式的情况（2026-10-24）
  - [x] `figma-vector`：把 SVG 字符串原样放进去（2026-10-24）
- [x] 渲染内容都设置 `pointer-events: none`（2026-10-24）
- [x] 在 `<Tldraw shapeUtils={...} />` 里注册这四个图形（2026-10-24）

**1.4 转换**

- [x] `apps/client/src/figma/to-shapes.ts`：写 `snapshotToShapes(snapshot)`，输入快照，输出 tldraw 图形列表（纯函数，不碰 editor）（2026-10-24）
  - [x] 从 `rest.document` 开始递归，跳过 `visible: false` 的节点和它的子节点（2026-10-24）
  - [x] 按 §4 的表把 `node.type` 换成图形类型；不认识的类型先跳过，记一条警告（2026-10-24）
  - [x] 位置 = 自己的 `absoluteBoundingBox` − 父节点的 `absoluteBoundingBox`；最外层 frame 放在画布的 (0, 0)（2026-10-24）
  - [x] `figma-vector` 用 `absoluteRenderBounds` 摆放和定尺寸（导出的 SVG 包含描边和阴影，会比节点本身大）（2026-10-24）
  - [x] 图形 id 由 Figma 节点 id 生成，父子关系用 `parentId`（2026-10-24）
  - [x] 上下层：按 `children` 的顺序排（Figma 里第一个子节点在最下面）（2026-10-24）
- [x] client 还没有测试框架，加上 Vitest，给转换写几条测试：隐藏图层被跳过、坐标是相对父级的、上下层顺序对、不认识的类型会给警告（2026-10-24）
- [x] 检查：`pnpm test` 通过（2026-10-24，6 条测试通过）

**1.5 放到画布上**

- [x] `/canvas` 打开后：清空画布 → 用 `snapshotToShapes` 生成图形 → `editor.createShapes` → 镜头对准 frame，缩放 100%（2026-10-24）
- [x] 检查：（2026-10-24）
  - [x] 4 个图层都出现了，看起来是 Figma 的样子，不是手绘风格（2026-10-24）
  - [x] 点矩形只选中矩形，能拖动；拖 frame 时里面的图层跟着一起动（2026-10-24）
  - [x] 刷新页面不会出现重复的图形（2026-10-24）
- [x] 截图给用户看（2026-10-24，用 agent-browser 在 Chrome 里截图检查；用户开了 /goal，最后统一汇报）
- [x] 检查：`pnpm lint`、`pnpm typecheck` 通过（2026-10-24）
- [x] 提交 git：`feat(client): render figma nodes as tldraw shapes`（2026-10-24，只提交到本地）
- 偏差：四个图形没有只做最简版，而是按 tech.md §6 一次写全了渐变（SVG + 矩阵）、图片四种模式、描边对齐和虚线、阴影、模糊、文字混合样式和截断、frame 裁剪和蒙版（clip.ts），省得第 4 步再重写；ELLIPSE 带圆弧时改用 SVG。检查截图用的是用户补充要求的 agent-browser（Chrome），真实鼠标点击和拖动都验证过

### 第 2 步：接真实数据

**2.1 拿到数据**

- [x] 在 Figma 桌面版里运行插件：先"生成测试用例"，再"导出测试数据"，把 zip 解压到仓库根目录，得到 `cases/`（2026-10-24，用 computer use 操作；79 / 79 个用例生成成功，导出 7.9 MB，共 380 个节点）
- [x] 如果插件报错：用户贴日志 → 改 `apps/figma-plugin/code.js` → 用户重新运行（2026-10-24，没有报错，不用改）
- [x] 数据到手后，先确认交接文档里写着"还没确认"的几件事（2026-10-24）：
  - [x] 图片填充里的 `imageRef` 是不是就是 `meta.images` 的 key → **是**，抽查 `image/fill`、`image/crop`、`page/gallery` 都对得上
  - [x] 节点数据里有没有 `relativeTransform`、`rotation`、`size` → **只有 `rotation`**（弧度，正负号和 Figma 界面上的角度相反，界面 30° 在数据里是 -0.5236）。没有 `size` 和 `relativeTransform`；旋转节点的 `absoluteBoundingBox` 是旋转后的外接框，比原来的尺寸大
  - [x] `svgs` 的 key 和节点树里的 `id` 格式是不是一样 → **一样**，全部能对上
  - [x] 每个矢量节点是不是都有 `absoluteRenderBounds` → **都有**
  - [x] `index.json` 里有哪些 warnings 和 errors → errors 为空；2 条警告，都是**蒙版图层导出 SVG 失败**（`mask/ellipse-image` 的 2:215、`mask/star-gradient` 的 2:219）
  - [x] `meta.fonts` 里用到了哪些字体，本机浏览器有没有 → Inter（Regular、Medium、Semi Bold、Bold、Italic）和 Noto Sans SC Regular；本机都没装，用 npm 的网页字体包加载
- [x] 旋转节点拿不到原始宽高：改插件，给每个节点额外导出 `width`、`height`、`relativeTransform`（放进 `snapshot.json`，比如新加一个 `transforms` 字段），改完请用户重新导出（2026-10-24，偏差：导出的是 `absoluteTransform` 而不是 `relativeTransform`，原因见 tech.md §4.2；顺便导出了图片原始尺寸 `meta.imageSizes`。我用 computer use 重新导出，371 个可见节点都有了 `transforms`，导出警告从 2 条变成 0 条）
- [x] 蒙版图层导出 SVG 失败：第 4 步做蒙版时再改插件，换别的办法导出蒙版的形状（2026-10-24，偏差：提前到这一步一起做了。蒙版图层不再导 SVG，改为导出 `fillGeometry` 路径放进 `meta.masks`）

**2.2 读数据**

- [x] 让 Vite 开发服务器把仓库根目录的 `cases/` 当静态文件提供，地址是 `/cases/...`（在 `vite.config.ts` 里配置）（2026-10-24，插件放在 `apps/client/vite-plugins/serve-cases.ts`）
- [x] `apps/client/src/figma/load.ts`：读 `index.json`，按 `dir` 读每个用例的 `snapshot.json`（2026-10-24，另外加了 `waitForAssets`：等字体和图片加载完，第 3 步截图要用）
- [x] 图片地址 = `/cases/<dir>/<meta.images[imageRef]>`，`figma-rect` 和 `figma-frame` 的图片填充先按 FILL 模式显示（2026-10-24，第 1 步已经把 FILL / FIT / TILE / CROP 都写了）

**2.3 切换用例**

- [x] 页面左侧放用例列表，按分类分组（fill、text、stroke……），显示用例名（2026-10-24）
- [x] 点一个用例：清空画布 → 读它的快照 → 生成图形 → 镜头对准（2026-10-24）
- [x] 当前用例写进网址（`/canvas?case=fill/solid`），刷新后还在；Playwright 也靠这个打开指定的用例（2026-10-24）
- [x] 加一个"叠加 Figma 原图"开关：把 `expected@2x.png` 半透明盖在上面，方便用眼睛对比（2026-10-24，三档：不叠加 / 半透明 / 差异；`fill/solid` 在差异模式下全黑，说明完全一致）
- [x] 检查：随便点 10 个用例，都能显示，页面不报错；不认识的节点类型在控制台有警告（2026-10-24，用 agent-browser 在 Chrome 里打开了 fill/angular-gradient、image/crop、mask/ellipse-image、mask/star-gradient、text/mixed-styles、boolean/union、page/gallery、component/instances、layout/wrap、effect/drop-shadow，都能显示，没有报错和警告；用例名写错时页面会提示 404）
- [x] 检查：`pnpm lint`、`pnpm typecheck`、`pnpm test` 通过（2026-10-24）
- [x] 提交 git：`feat(client): load test cases from cases/`（2026-10-24）
- [x] 给用户看效果（2026-10-24，用户开了 /goal，在最后的汇报里一起给）

### 第 3 步：对比脚本和报告

**3.1 截图模式**

- [x] 网址加 `&shot=1` 时进入截图模式：隐藏 tldraw 的界面和左侧列表，不显示选中框和悬停框（2026-10-24，画布背景改成纯白）
- [x] 确认 tldraw 的水印（如果有）不会压在截图区域里（2026-10-24，有水印，在右下角；截图时窗口右边和下边留了空，水印在截图区域外面）
- [x] 图形、字体、图片都加载完以后，设置一个"准备好了"的标志（比如 `window.__ready = true`），脚本等它再截图（2026-10-24，叫 `window.__figmaReady`，同时把警告放在 `window.__figmaWarnings`）
- [x] 按 2.1 查到的字体清单，把缺的字体装上或者用网页字体加载（2026-10-24，第 1 步已经用 `@fontsource/inter` 和 `@fontsource/noto-sans-sc` 加载）

**3.2 对比脚本**

- [x] 位置：`apps/client/scripts/compare.ts`，命令：`pnpm --filter @figma-to-tldraw/client compare`（2026-10-24）
- [x] 装 `playwright`、`pixelmatch`、`pngjs`，再装 Chromium（`npx playwright install chromium`）（2026-10-24，第 0 步已装）
- [x] 流程：读 `index.json` → 每个用例：打开 `/canvas?case=...&shot=1`（缩放 100%，`deviceScaleFactor: 2`）→ 等"准备好了" → 只截 frame 那一块（宽高都是用例尺寸 × 2）→ 和 `expected@2x.png` 用 pixelmatch 对比 → 保存差异图（2026-10-24，偏差：`expected@2x.png` 先叠到白底上再比；4 个页面并行）
- [x] 两张图尺寸不一样时不比较，直接记为 100% 差异，在报告里标出来（2026-10-24，第一份报告里没有尺寸不一样的）
- [x] 支持只跑一部分用例，比如 `compare fill/solid` 或 `compare text/*`（2026-10-24）

**3.3 报告**

- [x] 输出到 `reports/fidelity/<时间>/`：`index.html`、`results.json`，以及每个用例的 `expected.png`、`actual.png`、`diff.png`（2026-10-24，另有 `reports/fidelity/latest` 指向最新一次）
- [x] `index.html` 用表格，按差异从大到小排，每行是用例名、差异百分比和三张图（点开看大图）（2026-10-24，用例名链接到 `/canvas?case=...`）
- [x] 报告顶部是汇总：用例总数、平均差异、差异小于 1% 的有几个（2026-10-24）
- [x] 检查：跑一遍全部用例，打开报告能看到排序和三张图（2026-10-24，79 个用例约 54 秒；用 agent-browser 打开报告确认）
- [x] 把第一份报告差异最大的前 10 名记进文档，作为修复的起点（2026-10-24，记在 `apps/docs/figma-to-tldraw/verification.md` §4；平均差异 0.53%，73 / 79 个小于 1%）
- [x] 提交 git：`feat(client): add fidelity compare script`（2026-10-24）
- [x] 给用户看报告（2026-10-24，同上，最后统一汇报）

### 第 4 步：按报告修

每一轮的做法：

- [x] 看报告的前几名 → 找出主要原因（按特性归类，不按单个用例修）→ 修 → 重跑对比（2026-10-24，第一份报告之后又跑了 5 次全量对比）
- [x] 目标用例的差异降下来才算修好，同时看看其他用例有没有变差（2026-10-24，每轮先跑受影响的分类，再跑全量）
- [x] 每修完一个特性，在文档里记一条：改了什么，哪些用例的差异从多少降到多少（2026-10-24，记在 `apps/docs/figma-to-tldraw/verification.md` §4 的修复记录表）
- [x] 遇到要改架构的情况（比如把一小块合成一个图形来画），先停下来问用户（2026-10-24，没有遇到：组透明度找到了不改架构的办法，一般情况仍需架构改动，记成已知限制）

预计要补的特性（实际顺序看报告）：

- [x] frame 裁剪（`clipsContent`，包括圆角裁剪和多层嵌套）（2026-10-24，第一份报告最大 0.28% → 最后 0.01%）
- [x] 渐变：线性、径向、角度、菱形，带透明度的渐变（2026-10-24，0.21% → 0.00%）
- [x] 多层填充、填充透明度、图层透明度（2026-10-24，0.23% → 0.00%）
- [x] 四个角不同的圆角；平滑圆角（iOS 风格，可能只能近似）（2026-10-24，一开始就是 0.00%）
- [x] 描边：内描边、居中描边、外描边，虚线，四边粗细不同，渐变描边（2026-10-24，0.84% → 0.00%）
- [x] 阴影：投影、扩展投影、多重投影、内阴影（2026-10-24，一开始就是 0.00%；带阴影的 frame 0.15% → 0.00%）
- [x] 模糊：图层模糊、背景模糊（2026-10-24，背景模糊 5.62% → 0.00%）
- [x] 文字：混合样式、段落间距、字间距、水平和垂直对齐、下划线和删除线、大小写、省略号截断、固定尺寸溢出、中英文混排（2026-10-24，2.36% → 0.03%；剩下的是省略号截在单词中间还是单词之间）
- [x] 图片：FILL、FIT、CROP、TILE，图片透明度（2026-10-24，0.43% → 0.00%）
- [x] 旋转（2026-10-24，0.10% → 0.00%）
- [x] 蒙版（2026-10-24，0.17% → 0.00%）
- [x] 混合模式（2026-10-24，0.62% → 0.04%）
- [x] 组透明度（预计只能部分还原，见 §5）（2026-10-24，15.53% → 0.00%；上层是不透明简单形状时准确，其他情况见 verification.md §5）

Demo 收尾：

- [x] 把最后一份报告和结论（哪些还原得好、哪些差、差在哪里）写进文档（2026-10-24，`apps/docs/figma-to-tldraw/verification.md` §5；最后一份报告 `reports/fidelity/20261024-211751/`，平均 0.004%，79 / 79 小于 1%）
- [x] 交给用户决定下一步（2026-10-24，用户决定：79 个用例是照着调规则的，要再找更复杂、更真实的稿子来考一次，见第 5 步）

### 第 5 步：用真实稿子考一次

为什么：第 4 步的不少规则（文字基线取整、自动行高取整、大字只往上撑）是照着这 79 个用例反推的，0.004% 只能说明这批用例画对了。要拿**没参与调规则**的稿子来考，才知道真实效果。

**5.1 找稿子**（用户拍板：用户手上没有真实项目，只用 Figma 社区的免费资源；复制到用户草稿这一步由我用 computer use 做）

- [x] 在 Figma 社区挑 3～4 份免费文件，优先用免费字体的：Untitled UI（Inter）、Figma 官方的 Simple Design System（Inter）、Google 的 Material 3 Design Kit（Roboto）；Apple 的 iOS UI Kit（SF Pro）字体最难，放最后、可选（2026-10-24：实际用了两份，Untitled UI – FREE Figma UI kit v2.0 和 Google Gemini - Built with Material 3 Design Kit。Material 3 官方文件的页面写着下载即同意 Google 服务条款，先没碰，要问用户；Simple Design System 和 iOS UI Kit 没做）
- [x] 每份里挑 2～4 个完整页面（不挑组件清单页），类型尽量不一样：登录 / 表单、带表格的后台、带大图的落地页、手机列表页、深色模式（2026-10-24：Untitled UI 挑了设置页、后台、信息页三页，每页 4 个桌面 + 4 个手机，共 24 个；Gemini 挑了 4 个聊天界面、插件封面和两张 Dribbble 图，共 7 个，其中有深色界面和大图。没有登录页）
- [x] 用 computer use 复制到用户的草稿，记下文件名和挑了哪些 frame（2026-10-24，记在 `cases/index.json` 每条用例的 `source` 和 verification.md §6）
- [x] 遇到要同意条款、登录或付费的地方，先停下来问用户（2026-10-24：只碰到 Material 3 官方文件的条款，停下了）

**5.2 导出和放进 cases/**

- [x] 新稿子统一放在 `real/` 分类下，和原来的 79 个用例分开（插件导出时给没有分类的 frame 名字加前缀，或者在复制出来的文件里改 frame 名字）（2026-10-24：插件按页面名判断，不在 `Test Cases` 页面上的放到 `real/<文件名>/<页面名>-<frame 名>`；选中时可以导出任意一层的 frame，见 tech.md §9.1）
- [x] 导出的 zip 先解压到临时目录，再合并进 `cases/`：拷用例目录，合并 `index.json` 的用例列表（现在直接解压会把原来的列表盖掉）（2026-10-24：`pnpm --filter @figma-to-tldraw/client import-cases <zip>…`，见 tech.md §9.2）
- [x] 看 `index.json` 里的导出警告（2026-10-24：一开始有 136 个 SVG 导出失败，都是被裁掉、画不出东西的图标，插件和转换都改成跳过，重新导出后 0 条警告，见 tech.md §9.1、§9.3）

**5.3 让对比脚本能跑大稿子**

- [x] 浏览器窗口按用例尺寸放大（现在固定 1200×1400，1440 宽的桌面稿和长页面放不下）（2026-10-24，tech.md §9.5。另外发现 Figma 导出的图盖住的是渲染范围而不是 frame 的框，截图和镜头都改成按渲染范围算，tech.md §9.4）
- [x] 补字体：按 `meta.fonts` 看缺哪些。Google 字体用 `@fontsource` 包，版本尽量和 Figma 用的一样；苹果系统字体先试本机的（2026-10-24：先做了缺字体警告，tech.md §9.6。Red Hat Display 已装 `@fontsource/red-hat-display` 5.3.0，粗体比 Figma 窄一点，见 tech.md §6.4；Product Sans 是 Google 专有字体，用开源的 Google Sans Flex 调字宽近似代替，见 tech.md §6.9。用户有 Product Sans 授权文件的话可以再换成真的）
- [x] 节点多的时候，看一下加载和截图要多久（2026-10-24：新用例每页 114～621 个节点；110 个用例全跑 1 分 45 秒，原来 79 个是 54 秒左右，实测）

**5.4 原样考一次**

- [x] 不改渲染规则，跑一遍新用例，记下"考试分数"和警告（2026-10-24：`reports/fidelity/20261024-215318/`，31 个新用例平均 1.91%、25 个小于 1%；Untitled UI 24 页全在 0.17% 以下，Gemini 7 页平均 8.39%，见 verification.md §6）
- [x] 把新暴露的问题按特性归类，记进文档（2026-10-24：缺字体、First on top 叠放、图片滤镜、文字渐变，见 verification.md §6）
- [x] 给用户看报告，一起决定先修哪些（2026-10-24：报告和问题归类给用户看了，用户还没回复，按我建议的顺序修：叠放 → Red Hat Display → 文字渐变 → 图片滤镜 → Product Sans 代替。Material 3 官方文件要同意 Google 条款，仍等用户决定）

**5.5 按报告修**（考完再细化）

- [x] 做法同第 4 步，按特性修，不针对某一张稿子调参数（2026-10-24：用户还没回复先修哪些，按建议顺序修了四项：First on top 叠放（tech.md §4.3）、Red Hat Display 字体、文字渐变（tech.md §6.7）、图片滤镜（插件加了 8 个 `image-filter/*` 用例，导出时让 Figma 渲染带滤镜的图，tech.md §6.8）。真实稿子平均 1.91% → 0.30%。之后 Product Sans 用 Google Sans Flex 代替、Figma 文字重置字体特性（tech.md §6.9）。最后全量 118 个用例平均 0.07%，全部小于 1%结果见 verification.md §6）
- [x] 留一两张稿子从头到尾只用来考试，不拿来调规则（2026-10-24：定为 `gemini-macbook-pro-14---public-links-screen` 和 `informational-pages-mobile-2`，修的时候不看它们的差异图，只看分数。最后分别是 0.22% 和 0.17%）

### 第 6 步：展示页（用户追加）

在 client 里做一个展示页，把每个用例的 Figma 原稿链接、截图、还原出来的 tldraw 画布和差异分析放在一起（用户追加）。

- [x] 开发服务器把 `reports/` 也提供出来，展示页能读到最新的 `results.json` 和差异图（2026-10-24，`serve-cases.ts` 改成通用的 `serve-dir.ts`，tech.md §1.1）
- [x] 原稿链接：从 Figma 桌面版的本地设置里找到三份文件的 file key，拼成能定位到节点的链接；两份社区稿子另给社区页面链接（2026-10-24，tech.md §10.1）
- [x] 差异分析：对比脚本把每个不同的像素归到盖在最上面的节点，按文字 / 图片 / 图标 / 背景汇总，存进 `results.json`（2026-10-24，tech.md §10.2）
- [x] `/showcase` 列表页：总分、按分组的卡片、按差异排序（2026-10-24，tech.md §10）
- [x] `/showcase?case=…` 详情页：Figma 截图、可以拖动缩放的 tldraw 画布、差异图同比例摆在一起，差异分析里悬停节点会在图上框出来（2026-10-24，tech.md §10.4）
- [x] 在 Chrome 里看过、重跑全量对比、更新文档（2026-10-24，verification.md §3 第 10～12 条、§4）

### 第 7 步：思路介绍页（用户追加）

- [x] `/how-it-works`：一句话核心思路、链路、每个节点一个图形、关键做法、怎么量、怎么一步步变像、找到的规律、还做不到的（2026-10-24，tech.md §11）
- [x] 节点树和 tldraw 画布互相选中的演示，用 `page/mobile-login`（2026-10-24）
- [x] `/showcase` 顶部加"核心思路"入口；在 Chrome 里看过；更新文档（2026-10-24，verification.md §3 第 13 条、§4）

### 第 8 步：真实稿子堆到 10 套（用户追加，2026-10-25）

用户觉得两套不够，要堆到 10 套，偏手机 App 和落地页（用户追加）。顺序按用户说的：先找素材、导出，再优化代码，最后更新展示页。

- [x] 在 Figma 社区找 8 份免费文件（只要免费、不用额外同意条款的），用 computer use 复制到用户草稿（2026-10-25：50+ Landing page designs、Social App、Bankpick 银行 App、Framer SaaS、E-Learning、Golio、FreshGo、Furniture。Emmable 要 49 美元，跳过）
- [x] 用插件导出、`import-cases` 合进 `cases/`（2026-10-25：33 页，一共 151 个用例；只有 Bankpick 引导页 2 有 3 个路径导出 SVG 失败）
- [x] 原样跑一次，按特性归类（2026-10-25：33 页平均 4.71%、11 页小于 1%，verification.md §7.1）
- [x] 按特性修（2026-10-25）：字体换成和 Figma 同版本（tech.md §12.1）、长页面分段截图（§12.2）、水平翻转（§12.3）、只有描边的投影（§12.4）、U+2028（§12.5）、没有填充的背景模糊（§12.6）。33 页平均 0.38%、30 页小于 1%；原来 118 个分数不变
- [ ] 商业字体（Circular Std、Proxima Nova、SF Pro）：现在用后备字体，Social App 3 页还在 1% 以上。要不要找开源近似字体代替，或者让插件把缺字体的文字导成轮廓，等用户决定
- [x] 展示页：`sources.ts` 加 8 份文件的 key 和社区链接，`groups.ts` 加分组标题和说明，`/how-it-works` 加一步和三条规律（2026-10-25）
- [x] 全量对比、在 Chrome 里看过、更新文档（2026-10-25，verification.md §4、§7）

### 第 9 步：在 tldraw 里编辑（用户追加，2026-10-25）

用户要求转出来的图形在 tldraw 里能编辑，不光是移动，还有文字、形状和样式。先做调研（`apps/docs/figma-to-tldraw/probe-editing.md`），定了方向：保留自定义图形，`props.node` 是唯一的数据来源，在上面加编辑能力。用户让先做前 4 步看效果（用户确认：自动布局算在范围内，组件实例当普通 frame）。

- [x] 1. 缩放、旋转；frame 按约束摆子图层；组按比例缩放、边界跟着子图层；单击 / 双击 / Esc / Enter 按 Figma 的方式选图层（2026-10-25，tech.md §13.1）
- [x] 2. 自动布局：自己写算法，整棵树重排 15644 个图层里 15620 个不动；改动后自动重排；拖动排顺序（2026-10-25，tech.md §13.2）
- [x] 3. 文字编辑：用 tldraw 自带的 TipTap，Figma 文字和 TipTap 文档互转（3215 段来回一致），打字时重新量尺寸、触发重排，删空的文字自动删掉（2026-10-25，tech.md §13.3）
- [x] 4. 属性面板：位置尺寸、自动布局、尺寸方式、约束、外观、文字、填充、描边、效果，多选显示"混合"，每次修改一个撤销步骤（2026-10-25，tech.md §13.4）
- [x] 全量对比不变（151 个平均 0.13%）、在 Chrome 里按手动验收第 18～25 条看过、更新文档（2026-10-25，verification.md §3、§4）
- [x] 4b. 对齐线（用户试用发现）：默认吸附，子图层能对齐父 frame，自动布局里会跟着动的图层不当目标（2026-10-25，tech.md §13.5）
- [x] 4c. 拖动时实时交换（用户追加，参考 Figma 录屏）：前进方向的边越过兄弟中线就交换，兄弟滑开 0.15 秒，被拖的图层钉在鼠标下、画在最上面；顺带修了刚加载就能把整张图撤销掉的问题（2026-10-25，tech.md §13.6、§13）
- [ ] 5. 矢量改成按几何数据画，能改矢量的颜色，拉伸时描边粗细不变（等用户看完 1～4 步再定）
- [x] 6a. 新建图层和图层树（用户追加）：新建 Frame / 矩形 / 椭圆 / 文字的工具，tldraw 自带工具只留画笔和箭头（用户拍板）；左栏的图层树能选中、改名、隐藏、锁定（2026-10-25，tech.md §14）
- [ ] 6b. 图层树里拖动排顺序、移进别的 frame，画布上把图层拖进别的 frame 也一起做（用户已定，等看完 6a）
- [ ] 6c. 可选：导出图片（看需要）

### 第 10 步：开源字体用例和 Figma 组件（用户追加，2026-10-25）

用户定的六件事（用户追加），说"中途帮我做决定，不要问我问题"：

- [x] 1. 去掉用到商业字体的用例，以后补用例也避开；看还原度有没有提升（2026-10-25，tech.md §15）：151 → 130 个，平均 0.1334% → 0.0662%
- [x] 1b. 补不用商业字体的新用例（优先找组件多的社区稿子）（2026-10-26，tech.md §15.1）：computer use 截不了屏，改用 `screencapture` + System Events + 发鼠标点击的小程序操作 Figma 桌面版导出。补了 45 个（130 → 175）：50+ Landing 24 张、Furniture 15、E-Learning 4、Golio 2；为此装了 Work Sans、Zilla Slab、Roboto Mono、Bitter、Space Mono。修了 4 个文字问题（Lato 斜体画成正体、缺 Lato 300 / 900、有字间距时没有连字、居中文字算了行尾空格），原来 130 个平均 0.0662% → 0.0645%，新的 45 个平均 0.19%，175 个平均 0.0961%
- [x] 2. 导出所有主组件，重建主组件和实例的关联（2026-10-25，tech.md §16.1、§16.2）：插件导出主组件和整套组件集，6 套真实稿子 43 个用例重新导出；导入时按主组件重建实例，2025 个实例连上 1671 个，字段里推断出来的只有 70 个（2026-10-26 补完新用例后 175 个用例重新量：2033 个实例连上 1984 个，推断 104 个，tech.md §16.2）
- [x] 3. 在 tldraw 里实现组件体系（2026-10-25，tech.md §16.3～§16.5）：隐藏图层也建图形、"组件"页；改主组件同步、实例改动记覆盖、撤销、复制粘贴换 id；切变体、组件属性、重置、分离、新建组件、生成实例；面板"实例"一节、紫色选框、页面切换、⌥⌘K
- [x] 4. 逐个用例切到新的组件体系，还原度不能下降（2026-10-26，verification.md §4）：130 个用例平均 0.0662%，和切换前一样，变化最大的用例差 0.003%；顺带修好了家具首页对比时好时坏（tech.md §12.2）
- [x] 5. xhigh 级别 code review，再对它带来的改动做一轮 high 级别 code review（2026-10-26，verification.md §4）：xhigh 报 15 条，修 14 条、1 条记成已知问题；high 只看那次修复的提交，报 10 条，5 条真问题已修、2 条复现不出来、3 条顺手整理；还原度不变（130 个平均 0.0662%）
- [x] 6. 汇报页面 `/report`（2026-10-26，tech.md §17）：六件事的结果、开源字体、实现思路、tldraw 里的组件和两个能直接玩的例子、遇到的问题、效果、展示页的更新、还没做的；`/canvas` 加了 `select` 参数，展示页和思路页顶上有入口

### 第 11 步：发布到 Vercel（用户追加，2026-10-26）

- [x] 代码推到 GitHub 公开仓库 `ludafa/figma-to-tldraw`（`main` 和 `feat/figma-components` 两个分支；用例数据不进 git）
- [x] `export-static.ts` 把打包结果和用例数据导出到 `.deploy/`，从本机上传到 Vercel：https://figma-to-tldraw.vercel.app （2026-10-26，tech.md §18）：175 个用例、1.24 GB，一次上传成功；四个演示页面线上都查过
- [x] 导入和对比页 `/import`（用户追加，2026-10-26，tech.md §19）：左边导入 zip、每次导入的分数和差异报告、图层树，中间画布，右边节点 inspector；整个流程在浏览器里（解 zip、截图、pixelmatch 算差异、存 IndexedDB），分数和 Playwright 一般只差零点几个百分点；下载 tldraw 渲染图、差异图、Figma 渲染图、`.tldr`
- [x] 商业字体提醒：Figma 插件导出时、`/import` 导入时都提示不在开源清单里的字体会降低还原度（tech.md §19.4）
- [x] `/import` 发布到 Vercel：https://figma-to-tldraw.vercel.app/import （2026-10-26，线上用真实 zip 测过）
- [x] 用例 id 到 Vercel 上 Figma JSON 地址的映射 `case-urls.json`，进 git，由 `export-static` 生成（用户追加，2026-10-26，tech.md §18.1）

### 第 12 步：导入对比 Demo 页 /compare（用户追加，2026-10-28）

用户要一个 demo：导入插件导出的 zip（一个 Figma section），画到新画布上，旁边放 Figma 截图，下边是两者的差异。

- [x] `/compare` 页：我们的画布、Figma 截图、差异（差异图 / 相减）、差异分析四块，镜头一起动；点差异分析里的节点四块一起缩放过去（tech.md §20.1、§20.2）
- [x] 和 `/import` 共用导入代码和 IndexedDB（`useImports()`），没比完的画板打开就自动排队（tech.md §20.1）
- [x] 大图一条一条算差异，上限 8000 万 → 1.6 亿像素：Golio 3840×30640 长页面 0.17%，和 Playwright 一样（tech.md §20.3）
- [x] 截图和差异两块换成分块的图片金字塔，长图放大拖动 5fps → 240fps（tech.md §20.4）
- [x] 顺带修了文字里的 `\r`（Figma 画成空格），Golio 3 页分数下降（tech.md §12.7）
- [x] 在 Figma 里做真实 section 导出来试：发现 Figma 导出 section 的图四周多 40px，修好后 22.55% → 0.21%（tech.md §9.7）
- [x] 展示页顶上加"导入对比 →"入口
- [x] `/import` 改用 `useImports()` 后在页面上重跑一遍：手动验收清单第 38～42 条全部通过（2026-10-28，verification.md §4）
- [x] 修 Skia 引擎里半透明图形的背景模糊（重跑 `/import` 时发现）：Figma 的背景模糊也乘图层不透明度，Free Banking All Cards 8.25% → 0.44%（2026-10-28，skia-engine tech.md §5.9）
- [x] 提交前 code review 修正：截图条带最多 8192 行、宽不超过 16384、出错时清场（2026-10-28，tech.md §20.3）；引擎那边的修正记在 skia-engine plan.md
- [ ] 发布到 Vercel（用户还没要求）

### 第 13 步：Figma 变量（用户追加，2026-10-29）

先调研（`apps/docs/figma-to-tldraw/probe-variables.md`），用户看完说"1-5 都做了吧"：做到调研 §6 的第 5 步（能改变量值），其余按调研的建议定。设计在 tech.md §21。分支 `feat/figma-variables`。

- [x] 1. 插件生成 `variables/*` 用例（主题、间距、实例、分段文字），在 Figma 里生成并导出；新用例还原度 < 1%；实测调研 §8 的未确认项，结果写回调研文档（2026-10-29：用户的文件是 Figma 免费版，集合只能有 1 个模式，用户选了改成单模式的用例，嵌套模式的用例去掉，见 tech.md §21.1）：6 个用例 0.00%～0.02%；生成页固定名字、复用同名页（tech.md §21.8）；隐藏的矢量也导出 SVG（tech.md §21.9）
- [x] 2. 插件导出变量定义和模式（快照的 `variables`）；引擎加 `document` 记录，导入时变量放进它的 `meta`；`figma/variables.ts` 算变量的值；正式测试：亮色那份按暗色算，和 Figma 导出的暗色那份逐字段一致（2026-10-29：免费版没有暗色模式，改成亮色那份换上 FT Theme Dark 的值，和暗色那份逐字段一致；描边和整段文字的绑定按导出 JSON 的实际样子改，见 tech.md §21.4）
- [x] 3. 面板和 `/import` 的 inspector 显示绑定的变量名和当前模式
- [x] 4. 给 frame 切模式，子树跟着变、自动布局重排、撤销一步回去；实例改主组件后按实例自己的模式重算；亮色那份换成暗色集合的值后和 Figma 的暗色截图差异 < 1%（免费版做不了多个模式，原来的"切到暗色模式再比"改成换值再比，切模式本身只靠单测，见 tech.md §21.7）：换值四组 0.01%、0.51%（角标颜色，已知限制，tech.md §21.9）、0.00%、0.01%；补实例的测试时修了新建图层不重算（tech.md §21.5）
- [x] 5. 变量表：改变量的值，绑定的图层跟着变；库变量只读
- [x] 6. 全量还原度不变，`pnpm lint`、`pnpm typecheck`、`pnpm test` 通过；verification.md 记结果（2026-10-29：203 个平均 0.09%，和开工前逐个比没有变差超过 0.02 个百分点；手动验收第 47～51 条通过，verification.md §4）
- [x] 7. xhigh 级别 code review 看全部改动，再对它带来的修复做一轮 high 级别 code review（用户要求，2026-10-29，verification.md §4）：xhigh 报 15 条，都修了；high 只看那批修复，报 10 条，都修了；两轮一共补 9 条测试、改 2 条

### 第 14 步：面板输入框用滚轮调数值（用户追加，2026-10-29）

用户要面板的输入框像 Figma 一样，滚轮能调数值，按住 Shift / ⌥ / ⌘ 改步进。另一个会话接下来、转给本会话做；用户定的三条（等变量那批提交后再改、点进框里滚轮才生效、步进 1 / 10 / 0.1 / 100 且方向键同一套）和 Figma 实测结果见 tech.md §13.7。和第 13 步放在同一个 PR 里，分开评审、分开提交（用户要求）。

- [x] 1. `panel-fields.tsx` 的 `TextField`：原生 wheel 监听、累加到 4px 走一步、取 2 位小数、保持全选；方向键用同一套步长；500ms 内连续的滚轮步合成一步撤销（`isMergingSteps`，面板的 `actions()` 和变量表的 `ValueCell` 都认）（2026-10-29，tech.md §13.7）
- [x] 2. 在 Chrome 里按手动验收第 52～54 条试过，`panel-fields.test.ts` 4 条（2026-10-29，verification.md §4）
- [x] 3. 第一轮 code review（xhigh）14 条修了 12 条，重跑浏览器和单测；补了手动验收第 55、56 条（2026-10-29，tech.md §13.7、verification.md §4）
- [x] 4. 第二轮 code review（high，只看第一轮的修复）7 条都修了，重跑浏览器和单测（2026-10-29，verification.md §4）
- [x] 5. 单独提交，和第 13 步放进同一个 PR（2026-10-29）

### 第 15 步：暗色主题下面板看不清（用户试用发现，2026-10-29）

- [x] 1. 面板、输入框、变量表里写死的黑白色换成主题色，暗色下截图检查（2026-10-29，tech.md §13.4、verification.md §4）

### 第 16 步：填充行看不出是图片（用户试用发现，2026-10-30）

- [x] 1. 面板填充 / 描边的图片行显示缩略图，渐变行显示渐变色块，后面垫灰白格子；亮色、暗色下截图检查（2026-10-30，tech.md §13.4、verification.md §4）

### 第 17 步：填充编辑弹窗（用户追加，2026-10-30）

用户拿 Figma 点填充行弹出的面板对照，嫌我们的预览太小看不清；跳过提问，让我直接按截图里的 Figma 功能做（用户拍板）。范围和取舍见 tech.md §22.1。

- [x] 1. 弹窗本身：点预览打开、摆在面板左边、× / Esc / 点外面关掉、"自定义 / 库"标签、类型图标、混合模式菜单（2026-10-30，tech.md §22.2；纯色、渐变这两页先放了原来的取色框和类型下拉框，第 4、5 步换掉；"库"先是一句占位）
- [x] 2. 图片：铺满方式、平铺缩放、旋转 90°（渲染器补上 `rotation`）、大图预览和换图片、7 个调整滑块（写进 `filters`）（2026-10-30，tech.md §22.2；旋转方向还没拿 Figma 对过，记在风险表）
- [x] 3. 滤镜实时画：不猜公式，用插件让 Figma 渲染色表图来量（tech.md §22.1 第 3 条）。先小调研：高光 / 阴影是不是逐像素、几种滤镜叠加的顺序；再做色表和查表的着色器，记下每种和 Figma 差多少（2026-10-30，probe-image-filters.md、tech.md §22.3：7 种都逐像素，顺序 色调 → 色温 → 对比度 → 高光 → 阴影 → 曝光 → 饱和度，单种差 3 级以上的像素 ≤ 0.32%；色表 15 MB 放 `filter-luts/` 不进 git）
- [x] 4. 纯色取色器（2026-10-31，tech.md §22.4：饱和度 / 明度方块、色相条、不透明度条、Hex 和不透明度输入框、吸管；Hex 认 `f80` 这样的缩写；格式下拉框和"本页颜色"不做）
- [x] 5. 渐变：类型、翻转、旋转、色标条和色标列表（2026-10-31，tech.md §22.5：点条加色标取原来的颜色、拖过别的色标会重排、Delete 删、最少两个；顺带修了输入框回车后按 Esc 不关弹窗；翻转和旋转方向没拿 Figma 对过，记在风险表）
- [x] 6. 库：颜色变量列表，点了绑定（2026-10-31，tech.md §22.6：按集合分组、搜索、按作用范围过滤，点了换成绑定变量的纯色；色标绑变量不做）
- [x] 7. 文档、单测、手动验收、全量对比（2026-10-31，verification.md §4：203 个用例平均 0.09%、全部 < 1%，和改之前一样；两个带图片的用例偶发多出几十～两百像素，单独重跑能回到原样，记在风险表）

### 第 18 步：混合模式和 Figma 完全对齐（用户追加，2026-10-31）

用户问"我们的 blend 和 figma 现在完全对齐了吗"。查下来只有正片叠底、叠加、滤色三种图层混合模式有用例（`blend/modes` 差 0.12%），其余 12 种从没和 Figma 比过，线性加深按正常画，填充上的混合模式 203 个用例里一次都没用过，而第 17 步的弹窗能选全部模式。用户要求写进计划、做到完全对齐（用户追加）。现状和做法见 tech.md §23。

- [ ] 1. 插件加 `blend/*` 用例：每种模式一个，底下铺一块各种颜色的色板，上面盖一块转了 90° 的色板，让每两种颜色都叠一次；图层上的模式、填充上的模式各一套；再加半透明（图层不透明度 50%、填充不透明度 50%）、填充上的模式下面还有别的图层、文字填充的模式
- [ ] 2. 在 Figma 里生成、导出（computer use），`import-cases` 导入，对比脚本跑一遍，记下每种模式差多少
- [ ] 3. 先弄清填充上的混合模式和谁混合（只和同一图层下面的填充，还是连下面的图层一起），按 Figma 改渲染器
- [ ] 4. 对不上的模式逐个查：在哪个颜色空间混合、柔光用哪个公式、色相 / 饱和度 / 颜色 / 明度用的亮度系数；线性加深（Skia 没有）用运行时着色器补上
- [ ] 5. 目标：每个 `blend/*` 用例差异 < 0.5%（`blend/modes` 现在 0.12%）；达不到的写进 tech.md 风险表，写清差在哪、为什么
- [ ] 6. 文档、单测、手动验收、全量对比

## 7. 小细节（自己定的，可以改）

- seed 自带的后端、登录和示例页面保留不动，Demo 用不到。`/canvas` 不需要登录，这样 Playwright 能直接打开。
- `cases/` 放在仓库根目录，先不提交进 git，因为图片和截图体积大。
- 每个图层先只支持选中和移动，不支持缩放。
  > 2026-10-25 → 改成可以缩放、旋转和编辑，见第 9 步。
- 每一步做完提交一次 git，提交前先跟用户确认。提交信息按 seed 的约定写：用 Conventional Commits 格式，不加 co-author 尾注。

## 8. Demo 阶段不做

WebSocket 和后端中转、往 Figma 里写入、数据精简和去掉默认值、渲染性能优化。等 Demo 结果出来再决定，完整讨论见交接材料里的 `figma-to-tldraw-plan.md`（2026-10-31 起要点和现在的状态见 §9）。

## 9. 交接材料：原来的打算和现在的状态（2026-10-31 整理）

2026-10-24 开工时拿到三份交接材料，放在仓库根目录 `docs/handoff/`。2026-10-31 整理文档时删掉了，要点并进这一节（用户要求）。原文在提交 `24be4d2` 里，要看用 `git show 24be4d2:docs/handoff/<文件名>`。

### 9.1 三份材料

| 文件                      | 内容                                                                                                                                     | 现在去了哪                                                                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HANDOFF.md`              | Demo 目标、已定决策、插件现状、导出数据的格式、要做的 6 件事、"和我协作的方式"                                                           | 目标和改动见本计划 §1、§2；导出格式见 [tech.md §1](tech.md#1-链路和快照格式2026-10-24)；6 件事就是本计划第 0～4 步；协作方式并进根目录 `CLAUDE.md`「协作方式」 |
| `figma-to-tldraw-demo.md` | 一页的 Demo 方案：插件导出快照文件，tldraw 页面加载，一个 section 一个图形，先不做 WebSocket                                             | 被本计划代替，改了的三条见 §2                                                                                                                                  |
| `figma-to-tldraw-plan.md` | Demo 之后的完整方案（2026-10-17）：WebSocket 中转、插件的读写命令、往 Figma 写入、三层分工、接入 tldraw 的两种做法、性能、难点、推进顺序 | 逐条状态见 9.2                                                                                                                                                 |

### 9.2 完整方案里的打算

| 打算                                                                                | 现在                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 用自己写的 Figma 插件取数据，不用 REST API 或 MCP                                   | ✅ 照做：`apps/figma-plugin/`，见 [tech.md §1](tech.md#1-链路和快照格式2026-10-24)                                                                                                                                            |
| 后端做 WebSocket 中转，插件一直连着，服务端能随时推命令                             | ❌ 没做。插件导出 zip，`import-cases` 合并进 `cases/`。2026-10-30 定了不回 Figma（[产品方向 product.md §2](../product-direction/product.md#2-已经定下的事2026-10-30)），中转最大的用处（往 Figma 写入）没了                   |
| 插件的读取命令：渲染用的快照、按属性名读、读图片字节、导出 SVG / PNG                | 🟡 改成插件界面上的几个按钮：生成用例、导出、按列表导出、量图片滤镜（`apps/figma-plugin/README.md`），没有命令协议                                                                                                            |
| 插件的写入命令和往 Figma 写入的注意事项（先加载字体、整批撤销、命令去重、写入开关） | ❌ 不做：不回 Figma                                                                                                                                                                                                           |
| 插件补齐 REST 格式里没有的数据：矢量路径、文字分段样式、图片                        | 🟡 图片、`transforms`（矩阵和宽高）、`textSegments`、`mains`（主组件）、`variables` 都导了；矢量路径还没导，矢量照旧画插件导出的 SVG（本计划第 9 步第 5 条，[产品方向 plan.md](../product-direction/plan.md) 路线第 1、2 步） |
| 转换层去默认值、归一化（相对坐标、颜色转 hex、数字留 1～2 位），共用 `defaults.ts`  | ❌ 没做：REST 节点原样放进图形的 `props.node`，画的时候直接读 REST 字段。去默认值、写短颜色和数字改在[设计稿方言](../dialect/README.md)里做                                                                                   |
| 渲染层按 `node.type` 分发 React 组件，递归画子节点                                  | 🟡 tldraw 时期用 HTML、CSS、SVG 按节点类型画（[tech.md §3](tech.md#3-自定义图形2026-10-24)、§6），2026-10-27 起改成自研 Skia 引擎（[自研 Skia 画面引擎](../skia-engine/README.md)）                                           |
| 先用做法 A：一个 section 一个图形                                                   | ❌ 没用：用户 2026-10-24 拍板直接用做法 B（§2）                                                                                                                                                                               |
| 以后做法 B：一个节点一个图形                                                        | ✅ 一开始就这么做（[tech.md §3](tech.md#3-自定义图形2026-10-24)、§4）                                                                                                                                                         |
| 性能：缩小时换图片、屏幕外不画、少重复渲染、拖动时关特效、图片缩到合适尺寸          | 🟡 tldraw 时期没专门做；换 Skia 引擎时定了性能目标和基准（skia-engine 的 product.md §4、verification.md）                                                                                                                     |
| 已知难点：文字、内外描边、蒙版、布尔运算、阴影模糊混合模式                          | ✅ 都碰上了，做法见 [tech.md §5](tech.md#5-裁剪和蒙版2026-10-24)、[§6](tech.md#6-样式怎么画2026-10-24)，混合模式见本计划第 18 步                                                                                              |
| 推进顺序（中转 → 转换层 → 渲染 → 按结果补 → 写入 → 做法 B）                         | 被本计划 §6 的步骤代替                                                                                                                                                                                                        |
