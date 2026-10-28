# Figma 还原到 tldraw：验证方案

> 相关：[模块说明](README.md) · [技术实现](tech.md) · 施工计划 [`docs/施工计划.md`](../../../docs/施工计划.md)

## 1. 自动测试

| 测试文件                                            | 测什么                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 日期                      |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `apps/client/src/figma/to-shapes.test.ts`           | 节点树拆成图形：根节点放原点、子节点相对父节点、旋转节点用 `transforms`、隐藏节点建成隐藏的图形（隐藏的矢量没有 SVG 时按包围盒占位，不报警告）、兄弟顺序、不认识的类型给警告、矢量按渲染范围摆放和蒙版、画不出东西的矢量直接跳过、First on top 倒过来排、带滤镜的图片用渲染好的图（缺图给警告）；镜像矩阵拆成不旋转的框 + `flipX`（水平翻转、它的子节点、垂直翻转）                                                                                                                                                                                                                                                                                                                                             | 2026-10-24，2026-10-25 补 |
| `apps/client/src/figma/paint.test.ts`               | 文字渐变用的 SVG 渐变图：尺寸等于文字框、变换矩阵按渐变手柄算、颜色正确；角度渐变不生成                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 2026-10-24                |
| `apps/client/src/figma/image-filters.test.ts`       | 带滤镜图片的 key：只列不为 0 的滤镜、固定顺序、保留 3 位小数；没有滤镜时不生成                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 2026-10-24                |
| `apps/client/src/figma/fonts.test.ts`               | 字体代替：Product Sans 后面紧跟 Google Sans Flex 和字宽设置，判断缺字体时只看第一个字体；别的字体不受影响；斜体只有 Inter 写 `oblique 10deg`，别的字体写 `italic`（2026-10-26）；`closedFonts` 挑出不在开源清单里的字体，插件 `ui.html` 里抄的 `OPEN_FONTS` 和 `fonts.ts` 一样（tech.md §19.4，2026-10-26）                                                                                                                                                                                                                                                                                                                                                                                                     | 2026-10-24                |
| `apps/client/src/figma/diff-attribution.test.ts`    | 差异归因：红色像素算给盖在最上面的节点，按种类汇总、按像素数排序，文字节点带内容和字体；裁剪框外的部分不算给子节点；First on top 倒过来排；半透明遮罩、只有描边的框、不画东西的容器不抢下面的像素                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 2026-10-24                |
| `apps/client/src/importer/zip.test.ts`              | 导入页读 zip（tech.md §19.1）：读 `cases/index.json`；只解一个画板目录（不会多解名字相近的目录）；图片类型按文件头认；图片路径换成 blob 地址、不改原快照；不是插件导出的 zip 报错                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 2026-10-26                |
| `apps/client/src/importer/capture.test.ts`          | 浏览器截图挑字体（tech.md §19.2）：`unicode-range` 的范围、单个码位、`?` 通配，没写范围的字体都要                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 2026-10-26                |
| `apps/client/src/importer/diff-core.test.ts`        | 导入页算差异（tech.md §19.3）：一样的图 0 个像素；不同的像素算给下面的节点；一条一条算和整张图结果一样（tech.md §20.3，2026-10-28）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 2026-10-26                |
| `apps/client/src/figma/geometry.test.ts`            | 圆角矩形拆成四条边和四个角（虚线按段排用），段长正确；没有圆角时不出现长度为 0 的角                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 2026-10-24                |
| `apps/client/src/figma/editing/auto-layout.test.ts` | 自动布局：横排、两端对齐里的填充、旋转子图层不改尺寸、绝对定位不参与排列；读 `cases/` 时每个用例整棵树重排一遍，21085 个图层里最多 59 个动（已知的几处，tech.md §13.2；2026-10-26 加新用例前是 15644 个里最多 24 个），没有 `cases/` 时跳过                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 2026-10-25                |
| `apps/client/src/figma/editing/constraints.test.ts` | 约束：左 / 右 / 居中 / 左右 / 缩放各自怎么挪，旋转的图层在拉伸约束下只挪半个变化量，尺寸不会变成负数                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 2026-10-25                |
| `apps/client/src/figma/editing/rich-text.test.ts`   | 文字和 TipTap 互转：段落、段内换行、样式片段；新打的字跟着所在片段的样式；Cmd+B 变成一条共用的样式覆盖；空文字；读 `cases/` 时 3215 段文字经过 TipTap 的 schema 转一圈完全一样                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 2026-10-25                |
| `apps/client/src/figma/editing/panel-ops.test.ts`   | 面板操作：字号统一、相对行高跟着缩放、固定行高不变、"自动"行高、文字填充统一、圆角统一、自动布局开关                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 2026-10-25                |
| `apps/client/src/figma/editing/create.test.ts`      | 新图层：名字接着同类最大的编号往下编；矩形灰色 #D9D9D9、frame 白色并裁剪内容；文字是空的、自动宽度、Inter 12、自动行高，名字跟着内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 2026-10-25                |
| `apps/client/src/figma/components.test.ts`          | 按主组件重建实例（tech.md §16.2）：`copyId` / `templateIdOf` 互拆；没改过的字段来自主组件；Figma 记了的覆盖保留实例的值和位置；说不出原因的差异补进覆盖记录；换过主组件的嵌套实例按新主组件重建；隐藏的嵌套实例按主组件补上图层；主组件被删掉（空壳）的实例原样保留                                                                                                                                                                                                                                                                                                                                                                                                                                             | 2026-10-25                |
| `apps/client/src/figma/editing/instances.test.ts`   | 组件引擎（tech.md §16.4），在 Node 里建真的 tldraw `Editor`：改主组件同步到实例、跳过实例覆盖了的字段、撤销一起回去、主组件新加的图层实例里也有；删实例里的图层变成隐藏并记覆盖；Duplicate 出来的实例有自己的 id 并跟着主组件；粘贴主组件得到实例；切变体换成另一个主组件的图层和尺寸；布尔属性显示隐藏图层；重置清空覆盖；分离后不再同步；新建组件再生成实例，实例跟着改；主组件删字段、嵌套实例经外面主组件同步、主组件里换嵌套实例、切变体时的根字段和覆盖、拉大的实例切变体时按约束摆图层、分离时搬嵌套覆盖、只导了一部分的组件集、再导入清空旧的"组件"页；换实例属性管的嵌套实例不被主组件改、主组件里分离或重置嵌套实例、主组件里改嵌套实例的属性、重置嵌套实例后重新显示、分离时抄主组件给嵌套实例的覆盖 | 2026-10-25，2026-10-26    |

命令：`pnpm --filter @figma-to-tldraw/client test`。

## 2. 端到端检查

| 检查                                                        | 预期                                                                                                  | 日期       |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ---------- |
| `pnpm dev` 后打开 `http://localhost:5173/canvas`            | 左侧是用例列表，画布上是示例 frame                                                                    | 2026-10-24 |
| `curl localhost:5173/cases/index.json`                      | 200，返回用例列表                                                                                     | 2026-10-24 |
| `pnpm --filter @figma-to-tldraw/client compare`             | 跑完全部用例，在 `reports/fidelity/<时间>/` 生成报告，`latest` 指向它                                 | 2026-10-24 |
| `pnpm --filter @figma-to-tldraw/client import-cases <zip>…` | 打印每个 zip 导入了哪些用例，`cases/index.json` 里原来的用例还在                                      | 2026-10-24 |
| `curl localhost:5173/reports/fidelity/latest/results.json`  | 200，返回最近一次对比结果（每个用例带 `breakdown`）；`/reports/fidelity/latest/` 这种文件夹地址是 404 | 2026-10-24 |
| `pnpm lint`、`pnpm typecheck`、`pnpm test`                  | 都通过                                                                                                | 2026-10-24 |

## 3. 手动验收清单

1. 打开 `/canvas?case=fill/solid` → 画布上是一个白色 frame 和一个蓝色矩形；点工具条上的"差异" → frame 区域全黑。
2. 在左侧列表点任意用例 → 网址里的 `case` 跟着变，刷新后还是这个用例。
3. 打开 `/canvas?case=page/mobile-login` → 登录页完整显示，中文和英文字体正确。
4. 在画布上点一个子图形 → 选中根 frame 下面包含它的那一层（2026-10-25 起和 Figma 一样，见第 18 条）；拖动根 frame → 子图形跟着动。
5. 打开 `/canvas?case=不存在` → 工具条显示 1 条警告（读取失败 404），页面不崩。
6. 打开 `reports/fidelity/latest/index.html` → 顶部有用例数、平均差异、小于 1% 的个数；表格按差异从大到小排，每行三张图。
7. （2026-10-26 起不再适用：Gemini 用例按只用开源字体的规则去掉了，tech.md §15。字体代替由 `fonts.test.ts` 兜底。）
8. 打开 `/canvas?case=real/untitled-ui-free-figma-ui-kit-and-design/settings-pages-desktop` → 截图模式（加 `&shot=1`）下整页都在画面里，包括超出 960 高的部分。
9. 打开 `/canvas?case=image-filter/combined` → 下面那块色卡变暗、变暖、对比更强，和 `cases/image-filter/combined/expected@2x.png` 一样，工具条没有警告。
10. 打开 `/showcase` → 顶部四个数字和最新报告一致（2026-10-26：130、0.07%、130、47）；卡片按分组排，有 6 个"真实稿子"分组，每组都有"社区原稿"链接；切到"按差异从大到小"后第一张是 50+ Landing 的 `designs-30`（0.86%）。
11. 点开任意卡片 → 四格依次是 Figma 截图、tldraw 画布、差异图、差异分析，三张图大小一样、内容位置对得上；在画布上拖动会平移，点"复位"回到原位；按 → / ← 切换用例，Esc 回列表。
12. 打开 `/showcase?case=real/50-landing-page-designs-community/designs-30` → "在 Figma 里打开"跳到用户草稿里的这一页，"社区原稿"跳到社区页面；差异分析写"最多的是图标和矢量，占 63%"；鼠标移到 "We take good care of your pet" 那一行上，差异图里这行标题被蓝框框住。（2026-10-26 前用的是 Gemini 的一页，已去掉。）
13. 打开 `/how-it-works`（或在 `/showcase` 点"核心思路"）→ 开头四个数字和 `/showcase` 一样；第 2 节点左边的 "Primary button"，右边画布上的 Sign in 按钮被选中；在画布上点 "Forgot password?"，左边这一行高亮；第 4 节三张图都显示出来。
14. （2026-10-26 起不再适用：FreshGo 用例按只用开源字体的规则去掉了，tech.md §15。水平翻转由 `to-shapes.test.ts` 的镜像测试兜底。）
15. 打开 `/canvas?case=real/saas-website-ui-kit-framer-website-kit-c/light-page-desktop` → 只有描边的卡片外面是淡淡的一圈影子，不是整块的深影子。（2026-10-26 起去掉了原来的后半句：`light-page-mobile` 用了 Switzer 字体，已按 tech.md §15 去掉。）
16. 打开 `/canvas?case=real/50-landing-page-designs-community/designs-29` → 左边文字区块右下角后面的那艘船是清楚的，没有被糊掉。
17. `pnpm --filter @figma-to-tldraw/client compare real/furniture-e-commerce-community/design-homepage-1` → 6782 高的页面分 4 段截图拼起来，不报错；连跑几次都是 0.23%。（2026-10-26 前用的是 9497 高的 Framer 手机页，已去掉。）
18. 打开 `/canvas?case=page/mobile-login`，单击 Sign in 按钮 → 选中 "Primary button"，不是整页；再双击按钮上的字 → 直接进入编辑，文字全选；按 Esc 退出编辑，再按 Esc 选中按钮，再按 Esc 选中整页，按 Enter 选中整页的全部子图层。
19. 同一页，拖整页根 frame 的右边往右拉 100 → 输入框、按钮这些"填充"的子图层一起变宽，里面的内容跟着重新居中；按一次撤销，全部回到原样。
20. 同一页，选中 Sign in 按钮慢慢往上拖 → 按钮上边越过上面图层的中线时两者交换，被越过的图层滑下去，按钮一直在鼠标下面、画在最上面；松手 → 按钮落进空位；撤销一次全部恢复。再拖一次，拖到一半按 Esc → 顺序和位置恢复原样。
21. 同一页，双击按钮上的字，输入 "Continue to your workspace" → 文字一边打一边变宽，始终在按钮里居中；按 Esc 退出后文字位置不跳。
22. 同一页，选中副标题"登录后继续使用你的工作区"，按 Enter 编辑，按 → 再按 Enter，输入"第二段" → 副标题变成多行，下面的输入框整体下移；选中"第二段"按 Cmd+B → 退出编辑后这三个字是粗体。清空 "Welcome back" 后按 Esc → 这个图层被删掉，下面的图层往上补位。
23. 选中 Sign in 按钮，看右上角属性面板 → 有位置和尺寸（X、Y 置灰）、自动布局（横向）、尺寸方式（宽 填充、高 包裹）、外观（圆角 10）、填充（2563EB）、效果（投影）；把填充改成 16A34A、圆角改成 24、上内边距改成 24 → 按钮变绿、变圆、变高，下面的图层下移；撤销三次，一次退一步。
24. 选中按钮里的 "Sign in"，面板里字号改成 22 → 文字变大、按钮变高；选中 "Remember me" 那一行，取消"两端对齐"、间距改成 12、点对齐网格右上角 → 两项挤在一起靠右；方向改成"纵向" → 两项上下排列，这一行变高，下面的按钮下移。
25. 打开 `/canvas?case=container/group`，选中 Group 拖右下角手柄放大 → 里面的矩形、圆和文字框一起放大（字号不变）；把组里的圆往右下挪 → 组的选框跟着变大。
26. 打开 `/canvas?case=page/mobile-login`，选中 Sign in 按钮，拖它的右边往左拉到页面中间 → 出现一条竖着的红色对齐线，按钮右边吸在页面中线上；按住 Cmd 再拉 → 不吸附。选中 Logo 拖它的右边往右拉到和下面输入框右边差不多齐 → 吸住并显示对齐线。拖动 Sign in 按钮排顺序 → 没有对齐线。
27. 打开任意用例，什么都不改直接按 Cmd+Z → 画布不变（加载用例不进撤销记录）；改一处再连按几次 Cmd+Z → 退回到刚加载时为止，不会把整张图撤没。
28. 打开 `/canvas?case=page/mobile-login`，按 R 在 SSO 按钮下面的空白处拖出一个矩形 → 矩形灰色，图层名 "Rectangle 1"，排进整页的 SSO 按钮和 Spacer 之间，Spacer 变矮；按 O 在分隔线左边那段上点一下 → 100×100 的圆排进分隔线那一行，那一行变高；撤销两次全部恢复。
29. 同一页，按 T 在空白处点一下再打字 → 文字一边打一边变宽，图层树里的名字跟着变；按 T 点一下就按 Esc → 什么都没留下；按 T 拖出一段宽度再打一长句 → 按这个宽度折行。按 F 在空白处拖出一个 frame，再按 R 在 frame 里画 → 图层树里矩形是 frame 的子图层。工具栏只有移动、抓手、Frame、矩形、椭圆、文字、画笔、箭头 8 个按钮。
30. 同一页，看左边 → 上面是可以折叠的用例列表，下面是图层树，第一行是整页，下面从 "Don't have an account? Sign up" 排到 "Logo"（叠在上面的排在前面）；在画布上点 Sign in 按钮再按 Enter → 树里 "Primary button" 展开，"Sign in" 那一行变蓝；鼠标停在某一行上 → 画布上描出这个图层的边框。
31. 同一页，鼠标停在 "Logo" 那一行，点眼睛 → Logo 不见，下面的图层往上补；点 "Welcome back" 的锁 → 在画布上点不中它；双击 "Logo" 的名字改成别的再按 Enter → 名字改了；每一步都能撤销。
32. 打开 `/canvas?case=real/saas-website-ui-kit-framer-website-kit-c/light-page-desktop` → 图层树上面有 "Page 1" 和 "组件" 两个页面标签；实例和主组件在图层树里是紫色的菱形图标和紫色名字；点 "组件" → 画布上是一排排主组件和组件集，再点 "Page 1" 回来。
33. 同一页，选中 Hero 里的 "Get for free" 按钮 → 选框是紫色；面板 "实例" 一节写 "Buttons"，Icon 显示组件名，Text 是 "Get for free"，CTA 下拉框是 "Black S"；CTA 改成 "Black S arrow" → 按钮里多了箭头、宽度从 115 变成 139，右边的 "Learn more" 跟着右移；撤销一次全部恢复。
34. 同一个按钮，Text 改成 "Probe text" 回车 → 按钮上的字变了；再改按钮里文字的颜色，面板写 "覆盖了 1 个字段"；点 "重置所有覆盖" → 颜色回到主组件的，字还是 "Probe text"；点 "分离实例" → "实例" 一节消失，图层树里图标不再是紫色。
35. 打开 `/canvas?case=real/furniture-e-commerce-community/design-cart`，选中 "Input" 实例，点 "跳到主组件" → 切到 "组件" 页并选中主组件；把主组件里 "Your E-mail" 的文字颜色改成红色 → 回到 "Page 1"，实例里的这行字也是红的；把实例里这行字改成蓝色，再把主组件改成绿色 → 实例里还是蓝的；在实例里选中这行字按 Delete → 字不见了，但图层还在（隐藏），覆盖数加 1。
36. 同一页，选中一个实例按 Cmd+D → 多出一个实例；改主组件 → 两个实例都跟着变。选中一个普通 frame 按 ⌥⌘K → 它变成主组件（紫色），面板里点 "生成实例" → 右边出现它的实例并被选中。
37. 打开 `/report` → 顶上四个数字（用例数、平均差异、小于 1% 的个数来自最新报告）；第 1 节六件事各一行结果，没做完的那件是虚线圈；第 4 节两个例子点 "在这里打开编辑器" 才出现嵌入的画布，打开时已经选中 "Get for free" 按钮 / "Input" 实例；`/showcase` 顶上有 "这一轮的汇报 →"，`/how-it-works` 顶上有 "汇报"。手机宽度（390）下没有横向滚动条。
38. 打开 `/import`，点"导入 Figma 插件导出的 zip"选 E-Learning 线框图那份 zip（`figma-test-cases-20261026-0128.zip`，4 张）→ 进度条走完，导入记录里 4 个画板都有分数（都小于 0.02%），画布上是第一张；左下图层树是这张的图层。刷新页面 → 导入记录和分数还在，画布还是这张。
39. 同一页，点分数最高的画板，在差异报告的"差异最多的节点"上移动鼠标 → 画布上红框框出这个节点；点它 → 画布和图层树都选中它，右栏显示属性面板、"差异"一块写它占多少、"原始节点数据"能展开。叠加切到"半透明""差异""差异图" → 画布上分别盖上半透明的 Figma 图、差异混合、红黄的差异图。
40. 同一页，四个下载按钮各点一次 → 下载 `<画板名>-tldraw@2x.png`、`-diff.png`、`-figma@2x.png`、`.tldr`，`.tldr` 里没有 `blob:` 地址。点导入记录右上角的垃圾桶并确认 → 这次导入消失，画布清空。
41. 导入用了 SF Pro Display 的 zip（Free Banking，`figma-test-cases-20261024-2335.zip`）→ 导入后的提示、导入记录的黄框、每个画板后面的 ⚠、差异报告的"说明"里都写了商业字体会降低还原度。在 Figma 里用插件导出这种稿子 → 导出完状态下面出现黄框，日志里每个画板写了用到的商业字体。
42. 把 zip 拖到 `/import` 页面上 → 出现"松开鼠标导入 zip"，松开后开始导入，画布上没有多出图片图形。
43. 打开 `/compare`（展示页顶上"导入对比 →"），没导入过时是三步说明；点"导入 zip"选 E-Learning 那份 zip → 四块出来：左上我们的画布、右上 Figma 截图、左下差异图、右下差异分析，分数小于 0.02%；在 `/import` 里也能看到这次导入，点"在编辑页打开"跳到 `/import` 的同一个画板。
44. 同一页，在任意一块上 ⌘ + 滚轮缩放、拖动 → 四块一起动、看的是同一块地方；鼠标移到"差异最多的节点"上 → 三块图上都有红框；点它 → 四块一起缩放到它；放大到很大 → 截图和差异图是一格一格的像素，不糊；切到"相减" → 一样的地方是黑的；点"复位" → 回到整个画板。
45. 导入 Golio 那份 zip（含 3840×30640 的 Personal Portfolio）→ 不报"太大了"，两个画板都出分数（Personal Portfolio 0.17% 左右）；放大以后拖动截图那块，不卡。

## 4. 各次实际结果

### 2026-10-24

- 第 1 步：`hello.json` 示例在 Chrome 里按 Figma 样式显示；真实鼠标点击只选中矩形，拖动 frame 子图形跟着动；6 条单测通过。
- 第 2 步：用 agent-browser 在 Chrome 里打开 10 个用例（fill/angular-gradient、image/crop、mask/ellipse-image、mask/star-gradient、text/mixed-styles、boolean/union、page/gallery、component/instances、layout/wrap、effect/drop-shadow），都能显示，没有报错和警告。
- 第 3 步：第一份还原度报告 `reports/fidelity/20261024-202524/`，79 个用例跑完用时约 54 秒（4 个页面并行）。**平均差异 0.53%，73 / 79 个小于 1%**，34 个是 0.00%。差异最大的前 10 名：

| 排名 | 用例                    | 差异   | 看到的问题                                         |
| ---- | ----------------------- | ------ | -------------------------------------------------- |
| 1    | container/group-opacity | 15.53% | 组透明度被分别乘到每个子图形上，重叠的地方颜色不对 |
| 2    | effect/background-blur  | 5.62%  | 背景模糊完全没生效                                 |
| 3    | page/gallery            | 2.40%  | 图片里的细网格线有偏差，图片缩放或摆放的细节不一样 |
| 4    | text/mixed-styles       | 2.36%  | 文字                                               |
| 5    | text/decoration-case    | 1.84%  | 文字（下划线、删除线、大小写）                     |
| 6    | text/wrap               | 1.68%  | 文字换行                                           |
| 7    | text/fixed-overflow     | 0.87%  | 文字                                               |
| 8    | stroke/dashed           | 0.84%  | 虚线                                               |
| 9    | layout/vertical-fill    | 0.68%  | 文字为主                                           |
| 10   | layout/wrap             | 0.64%  | 文字为主                                           |

第 4 步的修复记录（每行是改完以后重跑受影响的用例）：

| 修了什么                                                         | 用例                    | 修之前 | 修之后 |
| ---------------------------------------------------------------- | ----------------------- | ------ | ------ |
| 矢量图形的透明度乘了两次（SVG 里已经带了），见 tech.md §4.1      | container/group-opacity | 15.53% | 2.64%  |
| 背景模糊层放到裁剪包装层外面，见 tech.md §6.3                    | effect/background-blur  | 5.62%  | 0.01%  |
| Inter 换回 3.19 版本，斜体用倾斜 10° 的可变字体，见 tech.md §6.4 | text/single-line        | 0.56%  | 0.00%  |
|                                                                  | text/letter-spacing     | 0.56%  | 0.01%  |
|                                                                  | text/wrap               | 1.68%  | 0.95%  |
|                                                                  | text/decoration-case    | 1.84%  | 1.36%  |
|                                                                  | text/mixed-styles       | 2.36%  | 2.15%  |
|                                                                  | text/truncation         | 0.54%  | 0.11%  |
|                                                                  | text/line-height        | 0.44%  | 0.13%  |
|                                                                  | page/mobile-login       | 0.32%  | 0.26%  |
| 自动行高用无单位倍数，大字能撑高所在的行                         | text/mixed-styles       | 2.15%  | 0.75%  |
| 下划线、删除线用字体自带的粗细和位置                             | text/decoration-case    | 1.36%  | 1.29%  |
| 按 Chrome 和 Figma 的基线取整规则补 -1～1px（tech.md §6.4）      | text/decoration-case    | 1.29%  | 0.19%  |
|                                                                  | text/align-horizontal   | 0.23%  | 0.00%  |
|                                                                  | layout/wrap             | 0.61%  | 0.06%  |
|                                                                  | layout/absolute-child   | 0.36%  | 0.01%  |
|                                                                  | page/mobile-login       | 0.26%  | 0.02%  |
|                                                                  | page/product-list       | 0.34%  | 0.13%  |
|                                                                  | component/instances     | 0.06%  | 0.00%  |
|                                                                  | container/clip-on       | 0.17%  | 0.01%  |
| 截图时抵消 tldraw 画布层的 0.125px 偏移（tech.md §7）            | page/gallery            | 2.02%  | 1.03%  |

全量重跑（`reports/fidelity/20261024-205207/`）：**平均差异 0.53% → 0.10%，小于 1% 的 73 → 77 / 79**。还剩两个超过 1%：`container/group-opacity` 2.64%（组透明度，需要架构改动，见 tech.md §4.1）、`page/gallery` 1.03%。

改用真实 2 倍屏截图（tech.md §7），基线公式加上屏幕倍数（tech.md §6.4）后全量重跑（`reports/fidelity/20261024-205614/`）：**平均差异 0.09%，小于 1% 的 78 / 79**；`page/gallery` 1.03% → 0.07%，`text/mixed-styles` 0.86% → 0.55%。全部单行文字里，顶部位置和 Figma 一样的占绝大多数（量法见下面的说明）。

量文字上下偏移的办法：在每个文字节点的框里分别找 Figma 图和截图里第一行、最后一行有字的像素行，两边相减。脚本是临时写的，没有放进仓库。

| 修了什么                                                                             | 用例                    | 修之前 | 修之后 |
| ------------------------------------------------------------------------------------ | ----------------------- | ------ | ------ |
| 重置 tldraw 继承下来的圆头线帽，描边按 `strokeCap` / `strokeJoin` 设（tech.md §6.2） | stroke/cap-join         | 0.18%  | 0.00%  |
| 矩形虚线按段排，每段整数个周期、从半个实线开始（tech.md §6.2）                       | stroke/dashed           | 0.93%  | 0.00%  |
| 自动行高四舍五入到整像素，每段按自己的字号算（tech.md §6.4）                         | text/wrap               | 0.93%  | 0.02%  |
|                                                                                      | text/fixed-overflow     | 0.47%  | 0.01%  |
|                                                                                      | text/paragraphs         | 0.23%  | 0.01%  |
|                                                                                      | text/truncation         | 0.15%  | 0.03%  |
| 基线补偿按字体分别用 Figma（typo）和 Chrome（hhea）的高度数据（tech.md §6.4）        | text/cjk-mixed          | 0.40%  | 0.00%  |
|                                                                                      | page/mobile-login       | 0.09%  | 0.00%  |
| 下划线往下补半个线粗，删除线改用背景按 Figma 的位置画（tech.md §6.4）                | text/decoration-case    | 0.23%  | 0.00%  |
| 透明的组里，把被上层不透明兄弟盖住的部分从下层裁掉（tech.md §4.1）                   | container/group-opacity | 2.66%  | 0.00%  |

| 比基础行高大的文字只把行往上撑，不往下撑（tech.md §6.4） | text/mixed-styles | 0.57% | 0.00% |

最后一次全量重跑（`reports/fidelity/20261024-211751/`）：**平均差异 0.004%，79 / 79 个小于 1%，65 个是 0.00%**，没有出错和警告。剩下差异最大的几个都不到 0.1%：

- `page/gallery` 0.07%：FIT 和 TILE 两张图片里面的内容差半个像素左右，像是图片缩放取样不一样；其余是文字边缘的抗锯齿。
- `blend/modes` 0.04%：multiply 圆下面的文字边缘。
- `text/truncation` 0.03%：省略号截断的位置不一样。Figma 可以截在单词中间（"onto s…"），Chrome 多行截断只截在单词之间（"onto …"）。

这些都属于目标里说的"1% 以下的细微差异"，没有继续追。

第 5 步：用 Figma 社区的两份稿子导出 31 个整页，不改渲染规则跑全部 110 个用例（`reports/fidelity/20261024-215318/`，用时 1 分 45 秒）。原来 79 个不变（平均 0.004%），31 个新用例平均 1.91%、25 个小于 1%。详细结果和问题归类见 §6。导出时遇到 136 个 SVG 导出失败，查下来都是被裁掉、画不出东西的图标，插件改成跳过（tech.md §9.1）。

### 2026-10-24（展示页，用户追加）

- `pnpm lint`、`pnpm typecheck` 通过；`pnpm test` 6 个文件 20 条通过（新增 `diff-attribution.test.ts` 3 条）。
- 全量对比重跑两次（加差异归因前后的渲染没变）：`reports/fidelity/20261024-225829/`、`reports/fidelity/20261024-230214/`，都是 118 个用例平均 0.07%、118 个小于 1%、47 个逐像素一致，和 `20261024-223846` 一样。每个用例的 `breakdown.byKind` 加起来都等于 `diffPixels`（脚本核对，118/118）。
- 第一版归因把 `gemini-plugin-file-cover` 82% 的差异算给了一块半透明渐变遮罩 "Rectangle 1"，改成"只有盖住下面内容的节点才涂整个范围"（tech.md §10.2）后，这一页 100% 在文字上：「Hello, Team …」（Product Sans）、「Unofficial Recreation」（Red Hat Display 700，粗体比 Figma 窄，tech.md §6.4）。8 个图片滤镜用例 100% 在图片上；Gemini 其余页面 73%～100% 在文字上。
- 用 agent-browser 在 Chrome 里看过（1440×900，暗色和亮色）：列表页、按差异排序、Gemini 详情页、Untitled UI 手机长页面（0.5 倍，页面可以往下滚）、`text/cjk-mixed`；节点悬停的蓝框、← → Esc 键盘切换都正常。手动验收 10～12 条通过；"在 Figma 里打开"没有在浏览器里实际点开（链接指向用户的草稿，需要用户登录 Figma）。
- 发现并修好：tldraw 水印压在设计稿右下角（三格四周加 24px 白边）；长页面缩得太小（高度方向最少 0.5 倍）；只差十几个像素时比例显示成 0%（改成 <1%）。

### 2026-10-24（思路介绍页，用户追加）

- `pnpm lint`、`pnpm typecheck` 通过；`pnpm test` 20 条通过（这次没加单测，页面是静态内容加一个演示）。
- 用 agent-browser 在 Chrome 里看过（1440×900，亮色）：整页七节都在；节点树 25 行，类型从画布读出来（FRAME → figma-frame、ELLIPSE → figma-vector 等）；点 "Primary button" 行选中画布上的按钮，在画布上点 "Forgot password?" 高亮对应的行。手动验收第 13 条通过。
- 发现并修好：演示画布用了白色背景，白底的登录页看不出边界，改回 tldraw 默认的浅灰。整页截图时第 4 节的图和画布是空白的，是懒加载还没触发，正常滚动浏览时都显示。

### 2026-10-25（再加 8 套真实稿子，用户追加）

- `pnpm lint`、`pnpm typecheck` 通过；`pnpm --filter @figma-to-tldraw/client test` 6 个文件 21 条通过（`to-shapes.test.ts` 新增 1 条：镜像）。`pnpm docs:check-refs`：98 处代码引用、189 个文档链接都对。
- 全量对比 `reports/fidelity/20261025-001604/`：151 个用例平均 0.13%，148 个小于 1%，47 个逐像素一致；原来 118 个分数都没变。详细见 §7。
- 字宽实测（tech.md §12.1 的办法）：装上的字体里，样本多的平均比值都在 0.997～1.002 之间；Inter 400 共 483 段，平均 1.0001。
- 用 agent-browser 在 Chrome 里看过（1280 宽，暗色）：`/showcase` 列表页 10 个真实稿子分组都有标题、平均差异和"社区原稿"链接；Social App `design-message` 详情页的"在 Figma 里打开"指向 `vc9Y8rli90BbmvQeMQ00oM`、"社区原稿"指向社区页面，差异分析写"最多的是文字，占 99%"；`/how-it-works` 第 5 节多了一步、第 6 节 9 条规律排成 3 × 3。手动验收第 10 条通过；第 14～17 条是在修的过程中对着差异图看过的，没有再按清单逐条点一遍。
- 过程中发现并修好：一次截很长的页面会报错或缺块（分段截图）；字体包版本不对（DM Sans 退回 4.5.9、Lato 换成 2.0）；水平翻转、只有描边的投影、U+2028、没有填充的背景模糊（tech.md §12）。

### 2026-10-25（在 tldraw 里编辑，第 1～4 步，用户追加）

- `pnpm lint`、`pnpm typecheck` 通过；`pnpm --filter @figma-to-tldraw/client test` 10 个文件 42 条通过（新增 4 个文件 21 条：自动布局 5、约束 5、文字转换 5、面板操作 6）。
- 全量对比 `reports/fidelity/20261025-142657/`：151 个用例平均 0.13%，148 个小于 1%，47 个逐像素一致；和上一份 `20261025-001604` 逐个比，没有一个用例的差异变化超过 0.005%。导入时的画法没变（tech.md §13）。第 1、2 步做完时另跑过一次（`20261025-135830`），结果一样。
- tldraw 里整树重排（临时脚本：Playwright 打开每个用例，调 `window.__figmaRelayoutAll()`，数位置变了的图形）：15172 个图形里 28 个动了，没有页面报错；28 个的原因见 tech.md §13.2 末尾，都是已知的。
- 用 agent-browser 在 Chrome 里看过（1400 宽，亮色）：手动验收第 18～24 条按清单做过，结果和清单一致；第 25 条的放大是拖手柄做的，挪圆是用 API 改位置验证的（组从 220 × 220 变成 280 × 260），没有用鼠标拖。另外用 API 验证了旋转：Logo 转 45° 后外接框高 79.2，下面的图层下移 23.2，撤销恢复；拉伸密码框里的眼睛图标后图标跟着变形，仍然靠右。
- 过程中发现并修好的：
  - agent-browser 的标签页处在后台（`document.visibilityState` 是 `hidden`），`requestAnimationFrame` 不跑，TipTap 拿不到焦点，进入编辑后打字没反应。用 Playwright 连上同一个浏览器调 `page.bringToFront()` 后正常。只影响测试环境，记进 tech.md §8 风险。
  - 面板宽度只改了 `width`，tldraw 还设了 `max-width: 148px`，面板挤成一条；补上 `max-width`。
  - 十六进制颜色输入框获得焦点时没有全选，新输入的值接在原值后面，颜色改不了；改成获得焦点时全选。
  - 编辑框的缓存一开始用 ref 在渲染时读写，`pnpm lint` 的 `react(refs)` 报错；改成 tldraw 的 atom。

### 2026-10-25（对齐线，用户试用发现）

- 现象：用户试用时发现拖手柄调整大小没有对齐线。原因和改法见 tech.md §13.5。
- `pnpm lint`、`pnpm typecheck` 通过；`pnpm --filter @figma-to-tldraw/client test` 10 个文件 42 条通过（这次没加单测，吸附要靠真实拖动才能测）。
- 用 Playwright 在无头 Chrome 里用鼠标拖手柄测了 7 种情况，结果见 tech.md §13.5 的实测表；第 26 条也按清单在无头 Chrome 里测过：Sign in 按钮吸到中线、按住 Cmd 拉到同一位置不吸附（宽 164，不是 163.5）、Logo 吸到 351、拖按钮排顺序时没有对齐线。没在 agent-browser 里用真鼠标看。
- 改之前先确认过原因：同样拖 Logo 的右边，不按键时没有对齐线，按住 Cmd 或打开"总是吸附"就有。
- 只影响拖动时的吸附，导入和画法没动，所以没重跑全量对比。

### 2026-10-25（拖动时实时交换，用户追加）

- 参考用户给的 Figma 录屏（7 秒，没有声音）：用 watch-video 抽帧，再逐帧量两个矩形的位置，得出交换时机和动画时长，结论见 tech.md §13.6。
- 第 20 条按新行为改写；第 27 条新加。两条都在无头 Chrome 里用 Playwright 鼠标操作测过，各项结果见 tech.md §13.6 的实测表。没在 agent-browser 里用真鼠标看。
- 改了加载用例的代码，重跑全量对比 `reports/fidelity/20261025-150113/`：151 个用例平均 0.13%，148 个小于 1%，47 个逐像素一致；和 `20261025-142657` 逐个比，变化最大的用例差 0.002%。`pnpm lint`、`pnpm typecheck` 通过，测试 10 个文件 42 条通过。
- 过程中发现并修好的：刚加载用例时按 Cmd+Z 整张图会被删掉（加载本身是一步撤销，以前就有）。改成加载不进撤销记录、加载后清空撤销记录（tech.md §13）。

### 2026-10-25（新建图层和图层树，用户追加）

- 第 28～31 条新加，都在无头 Chrome 里用 Playwright 鼠标操作测过，各项结果见 tech.md §14.1 和 §14.2 的实测表。没在 agent-browser 里用真鼠标看。
- `pnpm lint`、`pnpm typecheck` 通过；测试 11 个文件 45 条通过（新增 `create.test.ts` 3 条）。
- 全量对比 `reports/fidelity/20261025-210043/`：151 个用例平均 0.13%，148 个小于 1%，47 个逐像素一致；和 `20261025-150113` 逐个比，变化最大的用例差 0.001%。这次没改画法，只改了隐藏的图层不参与自动布局和组的边界，导入的图层都不是隐藏的，所以不变。
- 过程中发现并修好的：画进自动布局的图层总是排到最后。tldraw 的"一次操作结束"回调在 `editor.run` 里也是每改一次触发一次，先改节点就先触发了重排；改成先算好位置，节点和顺序一次改完（tech.md §14.1）。

### 2026-10-26（开源字体用例和 Figma 组件，用户追加）

- 去掉商业字体的 21 个用例后重算（同一份对比数据）：130 个平均 0.0662%，全部小于 1%，47 个逐像素一致（tech.md §15）。
- 重新导出 6 套真实稿子 43 个用例后，`check-components.ts` 的结果见 tech.md §16.2：2025 个实例连上 1671 个，推断的字段 70 个，多 / 少的图层 0 / 0。
- 切到组件体系后（实例按主组件重建、隐藏图层建成隐藏图形）全量对比 `reports/fidelity/20261026-001511/`：130 个用例平均 0.0662%，130 个小于 1%，47 个逐像素一致，最大 0.855%（50+ Landing 的 designs-30）。和切换前 `20261025-225156` + `20261025-225515` 逐个比，变化最大的是 Framer 亮色桌面页（0.003%），121 个用例差异像素数一个不差。没有用例需要重跑。
- 过程中发现并修好的：Furniture 首页对比结果时好时坏（9.07%、2.62%、1.82%、0.23% 都出现过）。原因是浏览器窗口按整页开，Chrome 丢画面图块；改成窗口只开一段高、移动镜头分段截、每段截到稳定为止，连跑 4 次都是 0.23%（tech.md §12.2）。
- 测试 13 个文件 65 条通过（新增 `components.test.ts` 8 条、`instances.test.ts` 12 条）；`pnpm lint`、`pnpm typecheck` 通过。
- 手动验收第 32～36 条的主要步骤在无头 Chrome 里用 Playwright 点过（切变体、撤销、改文字属性、改主组件文字、重置、分离、⌥⌘K 新建组件、生成实例、Duplicate），结果符合；第 34 条"改按钮文字颜色后覆盖数"和第 35 条"在实例里按 Delete"是在页面里直接调编辑器测的，没有用鼠标点。没在 agent-browser 里用真鼠标看。
- Duplicate 出来的实例一开始不跟主组件：tldraw 的 `duplicateShapes` 先建子图层，改名表查不到父图层的新 id。改成每次 `createShapes` 都按父图层在前的顺序建（tech.md §16.4），`instances.test.ts` 里有一条专门测它，去掉这个修复时那条测试失败。
- 代码评审发现并修好的（tech.md §16.3、§16.4 的修订说明）：有覆盖的实例切变体报错、主组件删字段时同步报错、切变体时底色不跟新变体、嵌套实例绕过外面主组件的覆盖、分离丢嵌套覆盖、只导了一部分的组件集不画、换用例时旧的"组件"页图形留着、实例被拉大以后切变体图层不按约束挪。每条都先在 Node 里复现，修完 `instances.test.ts` 20 条通过，测试 13 个文件 73 条通过；`pnpm lint`、`pnpm typecheck` 通过。另有一条没修：在主组件里重置或切换嵌套实例时，实例给那一层记过的覆盖值保不住（tech.md 风险表）。修完以后在无头 Chrome 里把第 32～36 条的探测脚本重跑了一遍（Framer 亮色页的 "Get for free" 按钮：切变体、撤销、改文字属性、改主组件文字、重置、分离、新建组件、生成实例），结果和修之前一样。没有重跑全量对比：`shot=1` 不建"组件"页，改动只影响编辑和"组件"页。
- 第二轮代码评审（high，只看第一轮修复的提交 `7410128`）报了 10 条，在 Node 里逐条复现：
  - 是真的、已修（tech.md §16.4 的第二条修订说明）：主组件里分离嵌套实例后实例里那一层坏掉、换实例属性管的嵌套实例被主组件改掉、主组件里改嵌套实例的布尔属性实例里图层不跟、分离新生成的实例丢主组件给嵌套实例的覆盖、重置嵌套实例后隐藏还在覆盖却没了。每条先写测试、确认修之前失败，`instances.test.ts` 26 条通过，测试 13 个文件 79 条通过；修完在浏览器里重跑第 32～36 条的探测脚本，结果和修之前一样。
  - 复现不出来、没改：说主组件里重置嵌套实例会把各实例里的图层删光（实际每写一次 store 就同步一次，旧副本先删、再按新的建，加了一条测试守着）；说约束只挪一层（`quiet` 每次写入后就清空，孙图层照样按约束挪，在 Node 里试过）。
  - 顺手做的：每次同步只给改到的主组件的实例往上找祖先；`SWAP_FIELDS` 改成从 `components.ts` 导出一份；合并覆盖记录抽成 `withOverride`；tech.md 里测试条数写错的改了。
- xhigh 那轮修复后的全量对比 `reports/fidelity/20261026-005838/`：130 个平均 0.0662%，130 个小于 1%，47 个逐像素一致，最大 0.855%；和 `20261026-001511` 逐个比，129 个差异像素数一样，变化最大 0.0008%（designs-27）。
- 汇报页 `/report`（tech.md §17）：Playwright 打开截了全页，顶上数字读到最新报告；点"在这里打开编辑器"后嵌入的画布已选中 "Get for free" 按钮；`/canvas?case=…design-cart&select=108:9788` 打开就选中 "Input" 实例，在这一页把主组件文字改红，实例里的字变红、内容还是自己的 "Your voucher code"；390 宽没有横向滚动。手动验收第 37 条。

### 2026-10-26（补不用商业字体的新用例，用户追加）

- 用 `screencapture` + System Events + 一个发鼠标点击的 Swift 小程序操作 Figma 桌面版（computer use 报"屏幕不可用"，Figma 不认 CDP 参数），导出 6 个 zip：Golio 2 页、50+ Landing 49 张、E-Learning 线框图 4 张、Furniture 15 页（tech.md §15.1）。
- `import-cases` 第一次导入 37 个（字体不在清单里的 33 张落地页跳过），130 → 167 个。第一次对比 `reports/fidelity/20261026-013307/`：37 个平均 0.29%，35 个小于 1%，最差 designs-48 2.29%。
- 修了 4 个文字问题（Lato 斜体画成正体、缺 Lato 300 / 900、有字间距时 Chrome 关掉连字、居中文字行尾空格），全量 167 个 `reports/fidelity/20261026-014551/`：平均 0.1164% → 0.0930%；原来的 130 个 0.0662% → 0.0646%，新的 37 个 0.29% → 0.19%。和 `20261026-005838` + `20261026-013307` 逐个比：变好的 19 个（designs-48 2.29% → 1.24%、designs-23 0.90% → 0.28%、designs-50 1.01% → 0.46%，老用例 designs-28 0.37% → 0.19%），变差的只有 designs-51 和 designs-42，各多 0.006%、0.007%，其余差别都在 0.005% 以内。
- 装 Work Sans、Zilla Slab、Roboto Mono、Bitter、Space Mono（`@fontsource/*` 5.3.0）后再导入同样 3 个 zip，补上 8 张，175 个。这 8 张单独对比 `reports/fidelity/20261026-015301/`：平均 0.16%，全部小于 1%。
- 最终全量 175 个 `reports/fidelity/20261026-015324/`：平均 0.0961%，174 个小于 1%，48 个逐像素一致，最大 1.237%（designs-48）。原来的 130 个 0.0645%（改之前 0.0662%），和改之前逐个比没有一个变差；新的 45 个平均 0.19%。和上一轮全量 `20261026-014551` 比，代码没变的用例最多差 0.014%（designs-39），是两次运行之间的抖动。
- `check-components.ts`（175 个用例）：实例 2033 个，连上 1984，找不到 49，换过 333；图层 15927；字段 284626 个，推断 104；多 / 少 0 / 0，补上 96（tech.md §16.2 的修订）。
- 测试 13 个文件 80 条通过（`fonts.test.ts` 加 1 条斜体）；`auto-layout.test.ts` 整棵树重排 21085 个图层 59 个动，和加 8 张以前一样，上限不用改。`pnpm lint`、`pnpm typecheck` 通过。
- 汇报页 `/report` 和展示页的分组说明跟着更新（tech.md §17 的补充说明）。

### 2026-10-26（发布到 Vercel，用户追加）

- `pnpm --filter @figma-to-tldraw/client build` 3 秒；`export-static` 导出 175 个用例到 `.deploy/`：2343 个文件，1.24 GB，最大 50 MB（tech.md §18）。
- 上线前用按 `vercel.json` 规则写的本机静态服务器跑 `.deploy/`：`/` 跳到 `/showcase`，`/canvas` 画出 Furniture 购物车页 359 个图形，`/report` 读到 175 个用例，没有 404。
- `vercel link` 在 `.deploy/` 里生成了带令牌的 `.env.local`，删掉，脚本加上 `.vercelignore`（`.env*`）。
- `npx vercel deploy --prod` 第一次上传成功，正式地址 https://figma-to-tldraw.vercel.app 。线上用 curl 和 Playwright 查过：`/` 307 到 `/showcase`；`/canvas` 两个用例 2.8 秒、2.5 秒画好；`/report` 数字对；50 MB 快照压缩传输 32 MB；缺的数据文件 404；`.env.local` 没传上去。展示页的"原始对比报告"原来 404，导出时补了说明页，重新部署后正常。
- `pnpm lint`、`pnpm typecheck` 通过（`.oxlintrc.json`、`.oxfmtrc.json` 加了 `.deploy/**`）。

### 2026-10-26（导入和对比页 /import，用户追加）

- 先做了三轮截图实验（tech.md §19.2 的表）：`editor.toImage` 丢跨图形效果；modern-screenshot 直接用文字退回系统字体；自己内嵌字体 + 等画面稳定后 `text/wrap` 0.022%，和 Playwright 一样。
- 用 Playwright 打开本机的 `/import` 选真实 zip（`setInputFiles`），等 IndexedDB 里每个画板都有结果：E-Learning 线框图 4 张 5.2 秒，分数 0.012%、0.001%、0、0；Furniture 15 页 92 秒，每页和 `reports/fidelity/20261026-015324/` 差不到 0.03 个百分点；Free Banking 5 页 7.6 秒，商业字体提示都出来了（History 1.66%）。
- 交互脚本：点"差异最多的节点"→ 画布和图层树选中、右栏出属性面板和"差异"；四个下载都拿到文件（tldraw 图 123 KB、差异图 53 KB、Figma 图 133 KB、`.tldr` 127 KB）；刷新后 4 个画板还在。
- 发现并修了：叠加图被图形压住（图形 `z-index` 从 200000 起，叠加图是 100000，`/canvas` 也一样），改成 1000000；缩放到画板时底部工具栏挡住画板下沿，四周留白加到 160px。
- Figma 插件的字体提醒没有在 Figma 里实际跑（屏幕操作不方便）；`fonts.test.ts` 检查插件里的清单和 `fonts.ts` 一样。
- `pnpm test` 16 个文件 92 条通过（新增 12 条：`zip.test.ts` 5、`capture.test.ts` 3、`diff-core.test.ts` 2、`fonts.test.ts` 2）；`pnpm lint`、`pnpm typecheck` 通过。
- 正式构建（`vite preview`）里同样两份 zip（E-Learning + Free Banking，9 个画板）一起导入，分数和开发服务器一模一样，10.8 秒。重新 `build` + `export-static`（2344 个文件，1243 MB）+ `vercel deploy --prod`，https://figma-to-tldraw.vercel.app/import 上用 Playwright 再跑一遍：9 个画板 13.6 秒、分数一样；选节点、四个下载、刷新后记录还在都正常。

### 2026-10-26（用例 JSON 的线上地址映射，用户追加）

- `export-static` 生成仓库根目录的 `case-urls.json`：175 条，用例 id → `https://figma-to-tldraw.vercel.app/cases/<id>/snapshot.json`（tech.md §18.1）。
- 175 个地址逐个用 `curl -I` 请求：全部 200、`application/json; charset=utf-8`；`fill/solid` 下载下来是完整的快照（`meta`、`rest`、`svgs`、`transforms`）。
- `pnpm lint`、`pnpm typecheck` 通过。

### 2026-10-28（导入对比 Demo 页 /compare，用户追加）

- 用 Playwright 打开本机的 `/compare`（`setInputFiles` 选 zip），每份 zip 跑一遍：导入、等比完、移到节点上、点节点、在截图那块 ⌘ + 滚轮缩放、在差异那块拖动、切"相减"、"复位"，每步截图看四块是不是对齐。
  - E-Learning 线框图：0.01%，上面每一步四块都对齐、一起动。
  - Golio 2 页：原来 Personal Portfolio（3840×30640）超过 8000 万像素报错；改成一条一条算（tech.md §20.3）以后 11 秒比完，0.17%（Playwright 0.173%）。
- 发现并修了：
  - Golio 长图放大后拖动 5fps（Chrome 每帧重新解码大 `<img>`，CPU profile 里主线程空闲）→ 换成分块的图片金字塔（tech.md §20.4），实测 240fps（240Hz 屏幕）。
  - 两块共用一个金字塔时，后一块把前一块的"块好了"回调盖掉，前一块不重画 → 改成一组监听。
  - 页面每次重新渲染都重设一遍镜子 canvas 的尺寸（重设会清空画面）→ 图层列表 `useMemo`，尺寸真变了才重设。
- `/import` 改用 `useImports()` 后，用 Playwright 把手动验收清单第 38～42 条在本机 `/import` 上跑了一遍（用户要求，2026-10-28），全部通过、页面没有报错：
  - E-Learning 4 张 3 秒比完，分数都小于 0.02%；刷新后记录、分数和打开的画板都还在。
  - 点"差异最多的节点"→ 画布选中它，右栏属性面板里有"差异"；四种叠加都能切。
  - 四个下载：tldraw 图 80 KB、差异图 53 KB、Figma 图 133 KB、`.tldr` 126 KB（里面没有 `blob:`）。
  - 把 zip 拖到页面上：出现"松开鼠标导入 zip"，松开后多了一条导入，画布上没有多出别的图形。
  - Free Banking（SF Pro Display）3.7 秒比完，商业字体提示和 ⚠ 都在；打开 `/compare` 能看到同样的 3 条导入；删掉一条要确认，删完剩 2 条。
- `pnpm test` 23 个文件 134 条通过（这次新增 1 条：`diff-core.test.ts` 1）；`pnpm lint`（含 `docs:check`）、`pnpm typecheck` 通过。

## 5. Demo 结论（2026-10-24）

最后一份报告是 `reports/fidelity/20261024-211751/`（实测，macOS 上的 Playwright Chromium，真实 2 倍屏，pixelmatch 阈值 0.1）：**79 个用例平均差异 0.004%，全部小于 1%，65 个是 0.00%**，没有出错和警告。第一份报告是平均 0.53%、73 / 79 个小于 1%。

| 分类                    | 用例数 | 第一份报告最大差异               | 最后最大差异 | 主要靠哪次修复                                       |
| ----------------------- | ------ | -------------------------------- | ------------ | ---------------------------------------------------- |
| container               | 8      | 15.53%（group-opacity）          | 0.01%        | 矢量透明度不重复乘、透明组里裁掉被盖住的部分（§4.1） |
| effect                  | 6      | 5.62%（background-blur）         | 0.00%        | 背景模糊层放到裁剪层外面（tech.md §6.3）             |
| page                    | 3      | 2.40%（gallery）                 | 0.07%        | 抵消 0.125px 偏移、真实 2 倍屏、文字基线             |
| text                    | 12     | 2.36%（mixed-styles）            | 0.03%        | Inter 3.19、行高取整、基线补偿、装饰线（§6.4）       |
| stroke                  | 7      | 0.84%（dashed）                  | 0.00%        | 线帽重置、虚线按段排（tech.md §6.2）                 |
| layout                  | 4      | 0.68%（vertical-fill）           | 0.01%        | 文字基线                                             |
| blend                   | 1      | 0.62%（modes）                   | 0.04%        | 抵消 0.125px 偏移、真实 2 倍屏                       |
| image                   | 6      | 0.43%（tile）                    | 0.00%        | 同上                                                 |
| misc                    | 2      | 0.39%（subpixel）                | 0.01%        | 同上                                                 |
| fill                    | 9      | 0.21%（gradient-alpha、opacity） | 0.00%        | 同上                                                 |
| mask                    | 2      | 0.17%（ellipse-image）           | 0.00%        | 同上                                                 |
| component               | 1      | 0.06%                            | 0.00%        | 文字基线                                             |
| shape                   | 5      | 0.01%                            | 0.00%        | 一开始就基本一致                                     |
| boolean、radius、vector | 13     | 0.00%                            | 0.00%        | 一开始就一致                                         |

**还原得好的**：填充（纯色、四种渐变、多层、透明度）、描边（三种对齐、虚线、线帽、四边不同粗细、渐变描边）、阴影和模糊、圆角（包括四角不同和平滑圆角用例）、图片四种模式、旋转、frame 裁剪和嵌套、蒙版、布尔运算和矢量、组件实例、自动布局的结果、三个整页用例，在这些用例上都和 Figma 逐像素一致或只差几十个像素。

**还差一点的**（都在 0.1% 以下，见 §4 最后一段）：图片缩放取样（`page/gallery`）、混合模式下的文字边缘（`blend/modes`）、省略号截在单词中间还是单词之间（`text/truncation`）。

**用例全过不代表所有情况都对**，下面这些是已知的限制或只验证过一个用例的规则：

1. 组透明度只在上层兄弟是"完全不透明的简单形状"时准确（tech.md §4.1）。上层半透明、带渐变 / 图片 / 阴影、或者是任意矢量和文字时，重叠的地方还会透出来；要完全一致得把整个子树画进一个图形，属于架构改动，要先问用户。
2. 一段文字里混着不同字号时"大字只往上撑"的规则，只有 `text/mixed-styles` 一个用例支撑（tech.md §6.4）。大字在最后一行、或者一行里有好几种大字号时没验证过。
3. 文字的基线补偿、下划线和删除线位置只有 Inter 和 Noto Sans SC 的字体数据（`figma-text.tsx` 的 `FONT_METRICS`）。换别的字体时不补，可能差 1px。
4. 对比只在缩放 100%、真实 2 倍屏、macOS 的 Chromium 上做过（tech.md §7）。在 tldraw 里缩放画布、1 倍屏、Windows / Linux 的字体渲染都没量过。
5. 用例是插件生成的 79 个单特性用例（含 3 个整页），真实项目里的大稿子（几百上千个节点、组件层层嵌套）没有试过，渲染性能也没测（Demo 不做）。
   > 2026-10-24 修订：后来用 Figma 社区的 31 个整页考过一次，见 §6。
6. 每个图层只能选中和移动，缩放、旋转、改文字都没做（施工计划 §7 定的）。

下一步可以考虑的方向（交给用户决定）：拿一两页真实设计稿导进来看看；组透明度的一般情况要不要做架构改动；量一下画布缩放以后的还原度；交接文档里 Demo 阶段不做的 WebSocket 中转、写回 Figma、数据精简和性能优化。

## 6. 真实稿子考试（2026-10-24）

稿子都来自 Figma 社区的免费文件（用户拍板：用户手上没有真实项目；复制到用户草稿这一步由我用 computer use 做）：

| 文件                                                   | 挑了哪些                                                                       | 用例数 | 字体                                 | 每页节点数 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------ | ------ | ------------------------------------ | ---------- |
| Untitled UI – FREE Figma UI kit and design system v2.0 | Settings pages、Dashboards、Informational pages 三页，每页 4 个桌面 + 4 个手机 | 24     | Inter                                | 186～621   |
| Google Gemini - Built with Material 3 Design Kit       | 4 个 MacBook Pro 14" 页面、插件封面、两张 Dribbble 图                          | 7      | Product Sans、Red Hat Display、Inter | 114～489   |

原计划里的 Google 官方 Material 3 Design Kit 没用：它的页面写着下载即同意 Google 服务条款，要先问用户。

报告 `reports/fidelity/20261024-215318/`（实测，同 §5 的环境），没改任何渲染规则：

| 分组        | 用例数 | 平均差异 | 小于 1% | 0.00% | 最大差异 |
| ----------- | ------ | -------- | ------- | ----- | -------- |
| 原来的用例  | 79     | 0.004%   | 79      | 65    | 0.07%    |
| Untitled UI | 24     | 0.02%    | 24      | 15    | 0.17%    |
| Gemini      | 7      | 8.39%    | 1       | 0     | 41.74%   |
| 新用例合计  | 31     | 1.91%    | 25      | 15    | 41.74%   |

**Untitled UI 只用 Inter，24 页全部在 0.17% 以下**，说明第 4 步的规则在没见过的稿子上也成立。剩下的差异没有逐张细看。

Gemini 7 页：

| 用例                                         | 差异   | 主要原因                                     |
| -------------------------------------------- | ------ | -------------------------------------------- |
| gemini-dribbble-thumbnail                    | 41.74% | 背景大图的滤镜没画；卡片叠放顺序反了；缺字体 |
| gemini-dribbble-screenshot                   | 9.64%  | 同上，加上文字渐变                           |
| gemini-macbook-pro-14---existing-chat-screen | 1.91%  | 缺字体                                       |
| gemini-macbook-pro-14---new-chat-screen      | 1.84%  | 缺字体、卡片叠放顺序、文字渐变               |
| gemini-macbook-pro-14---extension-screen     | 1.41%  | 缺字体、卡片叠放顺序                         |
| gemini-plugin-file-cover                     | 1.37%  | 缺两种字体、卡片叠放顺序、文字渐变           |
| gemini-macbook-pro-14---public-links-screen  | 0.79%  | 缺字体                                       |

按特性归类（数字是出现次数）：

| 原因                                                                                      | 出现在                                                                                           | 难度 | 怎么修                                                              |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ---- | ------------------------------------------------------------------- |
| 缺字体 Product Sans                                                                       | 全部 7 页                                                                                        | —    | Google 的专有字体，没有网页版；只能由用户提供字体文件，否则接受差异 |
| 缺字体 Red Hat Display                                                                    | plugin-file-cover                                                                                | 低   | 免费字体，装 `@fontsource` 的包                                     |
| 自动布局的 First on top 叠放（`itemReverseZIndex: true`），卡片背景盖住了上面的文字和图标 | 21 个 Stacked card 实例：screenshot 8、thumbnail 4、new-chat 4、plugin-file-cover 4、extension 1 | 低   | 转换时把这类 frame 的子节点倒过来排                                 |
| 图片滤镜（`filters`：曝光、对比度、饱和度、色调、高光），背景图还叠了 48px 的图层模糊     | thumbnail 2、screenshot 1                                                                        | 中   | 用 CSS `filter` 或 SVG 滤镜近似，色调和高光要自己推算               |
| 文字的渐变填充（`styleOverrideTable` 里的 `GRADIENT_LINEAR`，如 "Hello, Team"）           | screenshot 2、thumbnail 1、new-chat 1、plugin-file-cover 1                                       | 中   | CSS `background-clip: text`                                         |

考完按我建议的顺序修了四项，又给 Product Sans 找了代替字体（用户还没回复先修哪些），每行是改完以后重跑受影响的 Gemini 用例：

| 修了什么                                                                   | 用例                                     | 修之前 | 修之后 |
| -------------------------------------------------------------------------- | ---------------------------------------- | ------ | ------ |
| First on top 叠放：子节点倒过来排（tech.md §4.3）                          | gemini-macbook-pro-14---new-chat-screen  | 1.84%  | 1.56%  |
|                                                                            | gemini-dribbble-thumbnail                | 41.74% | 41.58% |
|                                                                            | gemini-dribbble-screenshot               | 9.64%  | 9.50%  |
|                                                                            | gemini-macbook-pro-14---extension-screen | 1.41%  | 1.41%  |
|                                                                            | gemini-plugin-file-cover                 | 1.37%  | 1.49%  |
| 装上 Red Hat Display 400、700（tech.md §6.4）                              | gemini-plugin-file-cover                 | 1.49%  | 1.39%  |
| 文字渐变填充：叠一层只露渐变文字的 `background-clip: text`（tech.md §6.7） | gemini-macbook-pro-14---new-chat-screen  | 1.56%  | 1.49%  |
|                                                                            | gemini-plugin-file-cover                 | 1.39%  | 1.34%  |
|                                                                            | gemini-dribbble-screenshot               | 9.50%  | 9.44%  |
|                                                                            | gemini-dribbble-thumbnail                | 41.58% | 41.54% |
| 图片滤镜：插件导出时让 Figma 渲染带滤镜的图（tech.md §6.8）                | gemini-dribbble-thumbnail                | 41.54% | 1.09%  |
|                                                                            | gemini-dribbble-screenshot               | 9.44%  | 0.84%  |
| Product Sans 用 Google Sans Flex（字宽 93.5）代替（tech.md §6.9）          | Gemini 7 页平均                          | 1.27%  | 0.87%  |
| Figma 文字的字体特性重置成 `normal`（tech.md §6.9）                        | Gemini 7 页平均                          | 0.87%  | 0.53%  |

封面修完叠放顺序反而变高：卡片上的文字原来被背景盖住，现在露出来了，但用的是后备字体 Inter（缺 Product Sans），比 Figma 宽、换行也不一样，差异算进来了。卡片本身已经和 Figma 一样（文字、图标都在背景上面）。其他 103 个用例里没有 `itemReverseZIndex`，没有重跑。

7 个 Gemini 用例重跑（`reports/fidelity/20261024-220745/`）：平均 8.39% → 8.31%。剩下的大头是图片滤镜（两张 Dribbble 图）和缺 Product Sans。

文字渐变修完以后，"Hello, Team" 从蓝到粉的过渡和 Figma 一样，下面一行灰字没有被染色；剩下的差别是字体（Inter 代替 Product Sans，字更宽）。

三项修完全量重跑（`reports/fidelity/20261024-221207/`，110 个用例）：原来 79 个和 Untitled UI 24 页的分数都没变；Gemini 7 页平均 8.39% → 8.28%，31 个新用例平均 1.91% → 1.89%，小于 1% 的还是 25 个。剩下的大头是两张 Dribbble 图的图片滤镜（41.54%、9.44%）和全部 7 页缺 Product Sans。

图片滤镜（2026-10-24）：插件加了 8 个 `image-filter/*` 用例（tech.md §6.8），第一次导出用插件 API 的滤镜值算 key，`contrast` 和 `combined` 两个用例对不上（4.53%、29.87%）；改成用 REST 数据里的值算以后（`reports/fidelity/20261024-222510/`）8 个都在 0.50% 以下，平均 0.41%。剩下的差异只在色卡相邻两行的分界线上，一个像素宽，没加滤镜的那块色卡也一样，是图片放大取样方式不同，和滤镜无关。Gemini 7 页用新插件重新导出。

四项修完全量重跑（`reports/fidelity/20261024-222808/`，118 个用例，实测）：**平均差异 0.11%，113 / 118 个小于 1%**。

| 分组               | 用例数 | 平均差异      | 小于 1% | 最大差异       |
| ------------------ | ------ | ------------- | ------- | -------------- |
| 原来的用例         | 79     | 0.004%        | 79      | 0.07%          |
| 图片滤镜用例（新） | 8      | 0.41%         | 8       | 0.50%          |
| Untitled UI        | 24     | 0.02%         | 24      | 0.17%          |
| Gemini             | 7      | 8.39% → 1.27% | 1 → 2   | 41.74% → 1.91% |
| 真实稿子合计       | 31     | 1.91% → 0.30% | 25 → 26 |                |

还超过 1% 的 5 个都是 Gemini 页面（1.09%～1.91%），警告里只剩缺 Product Sans。留作考试的 `gemini-macbook-pro-14---public-links-screen` 一直是 0.79%（这几项修复都没有涉及它），`informational-pages-mobile-2` 一直是 0.17%。

补上字体代替、重置字体特性以后全量重跑（`reports/fidelity/20261024-223846/`，118 个用例，实测）：**平均差异 0.07%，118 / 118 个小于 1%**。原来 79 个、图片滤镜 8 个、Untitled UI 24 页的分数都没变；Gemini 7 页平均 1.27% → 0.53%，最大 0.97%（`extension-screen`）。31 个真实稿子平均 0.14%，全部小于 1%。警告只剩"Product Sans 用 Google Sans Flex 近似代替"。留作考试的两页：`public-links-screen` 0.79% → 0.22%（字体代替规则对它也管用，拟合字宽时没看它的差异图），`informational-pages-mobile-2` 0.17% 没变。

剩下的差异都是文字字形（代替字体和 Product Sans 本来就不一样）和图片取样，属于目标里说的"1% 以下的细微差异"，没有继续追。

## 7. 再加 8 套真实稿子（2026-10-25）

两套不够，用户要求堆到 10 套，偏手机 App 和落地页（用户追加）。还是只用 Figma 社区的免费文件，复制到用户草稿由我用 computer use 做；收费的（Emmable，49 美元）和要额外同意条款的跳过。

| 文件                                       | 挑了哪些                                       | 用例数 | 字体                                            | 每页节点数 | 宽度       |
| ------------------------------------------ | ---------------------------------------------- | ------ | ----------------------------------------------- | ---------- | ---------- |
| 50+ Landing page designs                   | designs-25～30 六张落地页                      | 6      | Poppins、Montserrat、Lato                       | 12～81     | 1440       |
| Social App - Free UI Kit                   | 登录、首页、发现、消息、编辑资料               | 5      | Circular Std、Proxima Nova、SF Pro Text、Nunito | 72～205    | 375        |
| Free Banking Mobile App UI Kit（Bankpick） | 卡片、记录、首页、统计、引导页 2               | 5      | Poppins、Inter、SF Pro Display                  | 84～312    | 375        |
| SaaS Website UI Kit — Framer Website Kit   | 浅色桌面、浅色手机、深色桌面                   | 3      | DM Sans、Inter、Switzer                         | 139～393   | 1200 / 430 |
| Mobile E-Learning App Design               | 引导、分类、分类首页、详情                     | 4      | Urbanist、Inter（含 Light）                     | 21～116    | 375        |
| Golio - Free Landing Page UI Kit           | 3 个整站模板（代理公司、公司官网、个人作品集） | 3      | Lexend、Inter                                   | 350～444   | 1920       |
| FreshGo - Food Delivery App UI KIT         | 引导、首页、详情                               | 3      | Inter、SF Pro                                   | 37～123    | 375        |
| Furniture E-commerce                       | 首页、商品详情、购物车、登录                   | 4      | Lato、Montserrat                                | 187～426   | 1920       |

（节点数按快照里的整棵树数，含根节点和隐藏节点。）导出时只有 1 条问题：Bankpick 引导页 2 有 3 个路径（Path 266 / 292 / 318）SVG 导出失败，那一块画不出来，整页差异 0.17%，没有继续查。

### 7.1 第一次跑（规则不改）

报告 `reports/fidelity/20261024-235115/`（实测，同 §5 的环境）：**33 页平均 4.71%，11 页小于 1%**。Framer 手机页截图报错，记 100%；不算它，32 页平均 1.73%。

| 原因                                                                                              | 出现在                                        | 怎么修                                   |
| ------------------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------- |
| 字体没装或者版本不对（Poppins、Montserrat、Lato、DM Sans、Urbanist、Lexend、Nunito、Inter Light） | 除 Golio 外几乎每页                           | 装和 Figma 同版本的字体（tech.md §12.1） |
| 页面太长，一次截图报错或缺块                                                                      | Framer 手机页（9497 高）、家具首页（6782 高） | 分段截图（tech.md §12.2）                |
| 水平翻转的图层画成了上下颠倒                                                                      | FreshGo 首页、Framer 两张浅色页               | 镜像拆成翻转 + 旋转（tech.md §12.3）     |
| 没有填充、只有描边的卡片投影太深                                                                  | Framer 两张浅色页                             | 按描边那一圈画投影（tech.md §12.4）      |
| 文字里的 U+2028 没换行                                                                            | Framer 手机页                                 | 换成段内换行（tech.md §12.5）            |
| 没有可见填充的容器画了背景模糊                                                                    | designs-29                                    | 没填充就不画（tech.md §12.6）            |
| 商业字体（Circular Std、Proxima Nova、SF Pro）                                                    | Social App 全部、几套手机稿的状态栏           | 没有合法的网页版，先接受                 |

### 7.2 一项一项修

每行是改完以后重跑受影响的用例（实测）：

| 修了什么                               | 报告              | 结果                                                                                                                                  |
| -------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 装字体（tech.md §12.1）                | `20261025-000039` | 33 页平均 4.71% → 3.85%，小于 1% 的 11 → 25 页；designs-29 3.80% → 1.17%、designs-28 3.17% → 0.37%、E-Learning 分类首页 2.18% → 0.14% |
| 分段截图（§12.2）                      | `20261025-000244` | 家具首页 8.82% → 0.23%；Framer 手机页从报错变成 5.12%                                                                                 |
| 镜像（§12.3）                          | `20261025-000617` | FreshGo 首页 3.36% → 0.39%；Framer 浅色桌面 3.21% → 0.88%、浅色手机 5.12% → 1.74%                                                     |
| 只有描边的投影、U+2028（§12.4、§12.5） | `20261025-001159` | Framer 浅色桌面 0.88% → 0.25%、浅色手机 1.74% → 0.70%                                                                                 |
| 背景模糊要有填充（§12.6）              | `20261025-001541` | designs-29 1.17% → 0.36%；另外 3 个带背景模糊的用例（`effect/background-blur`、Social App 编辑资料、Framer 深色桌面）不变             |

### 7.3 最后结果

全量重跑 `reports/fidelity/20261025-001604/`（151 个用例，实测）：**平均 0.13%，148 / 151 小于 1%，47 个逐像素一致**。原来的 118 个用例每个的分数都没变（和 `20261024-230214` 逐个比，差值都小于 0.01%），平均还是 0.066%。

| 套                       | 用例数 | 第一次平均 | 第一次小于 1% | 最后平均 | 最后小于 1% | 最后最大 |
| ------------------------ | ------ | ---------- | ------------- | -------- | ----------- | -------- |
| 50+ Landing page designs | 6      | 2.74%      | 0             | 0.34%    | 6           | 0.85%    |
| Social App               | 5      | 1.23%      | 2             | 1.23%    | 2           | 1.94%    |
| Bankpick                 | 5      | 1.00%      | 2             | 0.11%    | 5           | 0.17%    |
| Framer SaaS              | 3      | 34.89%     | 1             | 0.57%    | 3           | 0.75%    |
| E-Learning               | 4      | 1.74%      | 0             | 0.18%    | 4           | 0.21%    |
| Golio                    | 3      | 0.12%      | 3             | 0.06%    | 3           | 0.12%    |
| FreshGo                  | 3      | 1.14%      | 2             | 0.15%    | 3           | 0.39%    |
| Furniture                | 4      | 3.07%      | 1             | 0.14%    | 4           | 0.23%    |
| **8 套合计**             | 33     | 4.71%      | 11            | 0.38%    | 30          | 1.94%    |

还超过 1% 的 3 页都是 Social App：design-message 1.94%、design-sign-in 1.58%、design-discover 1.31%。差异像素 97% 以上落在文字上，差得最多的都是 Circular Std / Proxima Nova 的文字（拿不到的商业字体，tech.md §12.1）。修的这几项都没碰到 Social App，所以它的分数一直没变。

其余 1% 以下的差异没有逐张细看。看过的几张：designs-30（0.85%）主要在 "Asterisk image" 矢量和 Lato 800 的大标题上；Framer 深色桌面（0.75%）主要在 DM Sans 700 的大标题上，字宽比值是对的（0.9997），差在字形边缘。
