# 调研：带交互的设计稿还能不能在画布上手工改？

> 2026-10-30，网上资料调研，没有试用这些产品
> 起因：用户说"最核心的难点现在是'可交互设计稿'还能不能手工编辑的问题。我现在没有更好的办法，你可以再搜索和调研一下。"
> 这份文档只回答可行性，不做设计。结论落地后写进 [产品设计](product.md) §7。

## 1. 结论

**能，前提是交互用编辑器认得的几种固定写法来表达；认不出的代码只能显示，不能在画布上直接改。** 查到的产品没有一家能在画布上随意修改任意 React 代码，分界线都画在这里，只是画法不同：

| 做法                         | 代表                     | 画布上能改什么                                                                   | 代价                                               |
| ---------------------------- | ------------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------- |
| 1. 行为挂在图层外面          | Framer 的代码覆盖        | 图层全能改；行为只在预览和发布后的网站里跑，画布上是静态稿                       | 不能按数据生成新图层                               |
| 2. 编辑器只认几种逻辑        | Plasmic、Builder.io      | 重复（一个模板生成多份）、绑定数据（文字、显示隐藏、变体）、按状态的变体         | 超出这几种的逻辑要写成代码组件，画布上改不了       |
| 3. 解析代码、改语法树        | CrossUI Studio、Utopia   | 写死的部分；循环里改模板（钻进去单独显示一项、手填假数据）；条件分别钻进两个分支 | 认不出的代码只能保留和显示                         |
| 4. 画布改动交给 agent 落代码 | Figma Make（连本地代码） | 面板里的改动先排队，点 Apply 后 agent 改代码                                     | 结果不确定，耗 AI 额度；Figma 建议改交互逻辑用批注 |

## 2. 怎么查的

- 网页搜索加读官方文档、博客、发布讨论，2026-10-30。
- 判定标准：资料里有没有明确写画布上怎么改循环、条件、状态相关的元素，改动怎么落回数据或代码。没写的标"资料没说"，不靠推测。

## 3. 逐项结果

### 3.1 Framer：代码覆盖（Overrides）

- 覆盖是"小函数"，就是普通的 React 高阶组件，在属性面板里挂到图层上。
- 原话："They are applied to the layer on the canvas, however they are only active in the preview and on your published site." 画布上看到的是静态的图层，行为只在预览里跑。
- 共享状态用 `createStore`：一个覆盖显示计数，另一个在 `onTap` 里 `setStore` 加一。Framer 自己说这只适合简单状态，"真的应用"建议用 React 或无代码应用搭建工具。
- 资料没说：挂了覆盖的图层在画布上是不是还能照常改（推测能，因为画布上不跑覆盖）。
- 出处：[Overrides 介绍](https://www.framer.com/developers/overrides-introduction)、[Overrides 示例](https://www.framer.com/developers/overrides-examples)

### 3.2 Plasmic：重复、动态值、变体录制

- **重复元素**：选中一个元素，在 Repeat element 里给一个数组，画布上生成多份；绑定数据时用 `currentItem`、`currentIndex`。代码里没有专门的重复 API，要自己 `map`。资料没明说"改一份等于改模板"，但模型就是一个元素按数据复制。
- **动态值**：在属性上右键"Use dynamic value"，文字、显示隐藏、变体都能绑数据；"Writing code is optional"，表达式是只能用部分全局对象的 JavaScript；数据还没到时用后备值。
- **变体录制**：先激活一个变体，界面标红，原话 "you're now recording changes for that variant"；这时改的样式在面板上带红点，表示"对基础变体的覆盖"。所有变体默认继承基础变体，右键"Remove Style"去掉覆盖。交互变体（Hovered、Pressed、Disabled、Focused）在预览里按用户操作自动打开。
- **隐藏的元素**：显示方式分"显示""渲染但不可见""不渲染"三种；Studio 默认在右侧栏或画布里聚焦一个隐藏元素时自动把它显示出来编辑（"Auto-open"）。
- 出处：[变体](https://docs.plasmic.app/learn/variants/)、[重复元素](https://docs.plasmic.app/learn/repeated-elements/)、[显示隐藏](https://docs.plasmic.app/learn/visibility/)、[动态值](https://docs.plasmic.app/learn/dynamic-values/)、[交互和状态](https://docs.plasmic.app/learn/interactions/)

### 3.3 Builder.io：数据绑定

- 选一个块，在"Repeat for each"里选查询结果，块按记录数重复；里面的元素绑每条记录的字段。文字、链接、显示隐藏都能绑。
- 资料没说：设计时画布上显示几份。
- 出处：[绑定数据](https://www.builder.io/c/docs/data-binding-entries)

### 3.4 CrossUI Studio：解析代码、钻进循环和分支（2026-07 的产品文章）

- 在 `.map()` 上 Ctrl+点击，"钻进去"：给循环体单独开一块画布，只显示一项。
- 循环变量在设计时没有值，用"Test Data Injector"手填假数据（JSON、字符串、布尔值），"Your mock data never touches the file"。
- 改动写回回调函数的函数体，原话 "Each change writes back into the callback body as a precise AST patch"；`map`、`key`、三元表达式不动。
- 三元和 `&&` 的两个分支能分别钻进去单独改；点子组件会打开定义它的文件。
- 这些都是静态解析语法树，不需要把应用跑起来。
- 资料没说：不支持哪些写法。这是一篇产品宣传文章，不是正式文档。
- 出处：[Edit inside a map, a ternary, even a component in another file](https://dev.to/linb/edit-inside-a-map-a-ternary-even-a-component-in-another-file-2e7)

### 3.5 Utopia：代码是真实数据

- README："It uses React code as the source of truth"，代码和画布实时双向同步，自称"early software"。
- 2021 年发布讨论里维护者说：有一条"happy path"，看得懂的代码能在检查器里显示、在画布上编辑；离开这条路，代码照样能解析、保留、画出来。
- 资料没说清楚（只有讨论的摘要里提到）：循环里每张卡片选中后对应回 `map` 里的那个元素；元素 id 静态生成。讨论里提到的"Working with generated and conditional content"那一节没找到。
- 出处：[仓库](https://github.com/concrete-utopia/utopia)、[发布讨论](https://news.ycombinator.com/item?id=27516212)

### 3.6 Onlook

- README："We instrument the code in order to map elements to their place in code"。改动先改预览里的元素，再改代码。
- 资料没说：循环和条件怎么处理。现在的桌面版改用 agent。
- 出处：[仓库](https://github.com/onlook-dev/onlook)

### 3.7 Figma Make：画布改动交给 agent（2026-05-28 起连本地代码，测试版）

- 连上代码库以后能在画面上直接改："Select elements, adjust properties, change layouts, colors, fonts, or sizing."
- 分工：原话 "Use direct edits for changes you know you want to make." 和 "Use annotations for changes that alter interaction logic."
- 面板里的改动不是直接改代码：点 Apply 以后"The agent applies the changes you made"，要花 AI 额度。
- 出处：[Figma Make, now on your local code](https://www.figma.com/blog/figma-make-now-on-your-local-code/)、[编辑工具](https://help.figma.com/hc/en-us/articles/42009840449175)

## 4. 对设计的建议

1. 交互只用几种固定写法：状态、绑定、按状态的样式、重复、条件显示、事件（做法 2 的词汇），写成 TSX（做法 3，能确定地改语法树），认不出的代码交给 agent（做法 4），编辑和演示分开（做法 1）。写法和画布上怎么改见 [product.md §7](product.md)。
2. 原始方案 §15.4 的"回流"难题用 Plasmic 的录制模式解决：设计师先选"改所有状态"还是"只改这个状态"，改动的意思由界面定，不靠 LLM 猜。
3. 循环里的元素：改哪一份都是改模板，每项不同的地方只来自数据；钻进去时用假数据显示一项（CrossUI 的做法），或者用状态清单里的数据点。
4. 最小验证切片：拿现有的 `variables/*` 用例（`visible` 绑了变量的角标就是"状态控制显示"），加演示模式点按钮切状态，再在画布上用三种编辑模式各改一次，看生成的补丁对不对。
