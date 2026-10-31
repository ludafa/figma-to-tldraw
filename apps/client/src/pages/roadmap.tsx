import { Link } from '@tanstack/react-router';
import { type ReactNode, useEffect, useState } from 'react';

import { type FidelityReport, loadLatestReport } from '../figma/report';
import { formatDiff } from '../showcase/score';

// See apps/docs/product-direction/tech.md §1.

const GOALS: { who: string; what: string; weight: string }[] = [
  {
    who: 'agent',
    what: '读懂设计稿的结构、数值和组件关系，按要求改对。',
    weight: '主要场景',
  },
  {
    who: '设计师',
    what: '在我们的画布上看稿，体验和 Figma 一样；需要时手工改稿。',
    weight: '次要场景',
  },
  {
    who: '导入',
    what: '把 Figma 里的页面、组件库、变量、样式、图片一次性导进来，画出来和 Figma 一样。',
    weight: '前提',
  },
  {
    who: '不回 Figma',
    what: '导进来以后用户就留在新产品里，不再同步回 Figma。',
    weight: '方向',
  },
];

const DECISIONS: { decision: string; why: string; source: string }[] = [
  {
    decision:
      '不回 Figma。写回 Figma 的整套同步不做：插件执行器、新节点 id 回填、和 Figma 当前状态三方比较。',
    why: '目标是把用户留在新产品。',
    source: '用户说明 · 2026-10-30',
  },
  {
    decision: '代码优先：代码是真实数据，画布用的 JSON 从代码算出来。',
    why: 'agent 读写设计稿是主要场景。',
    source: '用户拍板 · 2026-10-30',
  },
  {
    decision: '画布上的手工修改由转换层写回代码，设计师感觉不到自己在改代码。',
    why: '手工编辑虽然是次要场景，也要好用。',
    source: '用户拍板 · 2026-10-30',
  },
  {
    decision:
      '代码借 React Native 的外形，每个属性按 Figma 的意思理解；意思不一样的不借 RN 的名字，改用 fg- 前缀。',
    why: '模型熟悉 JSX；RN 没有 CSS 层叠；借了名字却改了意思，agent 会自信地理解错。',
    source: '原始方案原则 1',
  },
  {
    decision:
      '"往返无损"改成"导入无损"：导入时和 Figma 截图比一次还原度，之后不再和 Figma 比。',
    why: '不回 Figma 了。',
    source: '2026-10-30 讨论',
  },
];

const FLOW: { title: string; text: string; arrow?: string; main?: boolean }[] =
  [
    {
      title: 'Figma 文件',
      text: '历史设计稿：页面、组件库、变量、样式、图片。',
    },
    {
      title: '快照 JSON',
      text: '我们自己的插件一次性导出，现在已经有了。',
      arrow: '插件导出',
    },
    {
      title: '设计稿代码',
      text: '真实数据，用 git 管理。agent 在这里读和改。',
      arrow: '生成代码',
      main: true,
    },
    {
      title: '画布 JSON',
      text: '从代码算出来，交给 Skia 引擎画。设计师在这里看稿、手改。',
      arrow: '求值 ⇄ 补丁',
    },
  ];

const CODE_SAMPLE = `/** @figma frame 20:1 "Cart" · 标签：主线 */
export default (
  <View nodeId="20:1" name="Cart"
    style={{ width: 390, flexDirection: 'column', gap: t.space.md, padding: 16 }}>
    <Header />  {/* 子块 20:5，另一个文件 */}
    <Button nodeId="20:900" variant="primary" size="md"
      fg-overrides={{ '10:4': { characters: '去结算' } }} />  {/* 10:4 = Label */}
  </View>
)`;

const KEPT: string[] = [
  '每个 Figma 节点对应代码里一个元素，带上 nodeId，树结构不改（原则 3）。',
  'Figma 里共享的才共享，复制粘贴的重复结构照样展开（原则 4）。',
  '矢量路径、图片这些"只需搬运"的数据放资源文件，代码里只写引用（原则 6）。',
  '目录跟着 Figma 的页面、Section、顶层画框走；文件太长按规则拆子块；给画框打"主线 / 探索 / 标注"标签，agent 从粗到细地读（§5～§8）。',
];

const EXISTING: [string, string, string][] = [
  [
    '还原度',
    '每个用例和 Figma 导出的图逐像素比，数字见顶上',
    'figma/skia/、engine/render/',
  ],
  [
    '自动布局',
    '自己写的算法，规则对着真实稿子一条条找出来；重排 21085 个图层只有 59 个对不上，原因都知道。换行、网格还不重排',
    'figma/editing/auto-layout.ts',
  ],
  [
    '文字',
    '用 Skia 排版量尺寸，2812 段文字里 2811 段行数和 Figma 一样；能直接在画布上编辑',
    'figma/editing/text-measure.tsx',
  ],
  [
    '组件',
    '按主组件重建实例；改主组件同步到实例，切变体、组件属性、重置、分离',
    'figma/components.ts、figma/editing/instances.ts',
  ],
  [
    '变量',
    '模式继承、别名；改了变量的值，绑定的字段重算、再重排',
    'figma/variables.ts',
  ],
  [
    '编辑器',
    '选择、缩放、约束、拖动排顺序、属性面板、图层树、新建工具、填充弹窗',
    'figma/editing/',
  ],
];

const DATA: [string, string, string][] = [
  ['页面节点', '22245', ''],
  [
    '在组件实例里面的节点',
    '72%',
    '实例只写一行就省很多：Golio 一页 1468 个节点，实例外只有 20 个；88 页里实例外最多 247 个',
  ],
  ['在实例里面的文字', '74%', '页面上的文案几乎都是"覆盖"'],
  [
    '有覆盖的最外层实例',
    '90%',
    '共覆盖 3592 个图层，改文字内容 1157 处。覆盖是页面内容的主体，不是边角',
  ],
  [
    '主组件和组件集里的节点',
    '按文件去重后 24134',
    '和页面节点数差不多，是页面上实例外节点的 4 倍左右，体积的大头在组件库：Untitled UI 一个图表组件集 24 个变体、2453 个节点',
  ],
  ['变体里名字路径重复的图层', '65%', '按名字写覆盖，找不到唯一的那个图层'],
  ['用了样式的节点 / 绑了变量的节点', '47% / 8 个', 'token 主要来自样式'],
  ['父图层不是自动布局、或自己是绝对定位', '30%', '大量"绝对定位 + 约束"'],
  ['名字是 "Frame 427" 这类默认名的节点', '16%', '确实存在，没有想的那么多'],
  ['原型交互、开发状态', '0', '靠 Figma 原生标记分类，这些稿子里用不上'],
];

const FIXES: { title: string; text: string }[] = [
  {
    title: '覆盖按 id 写，不按名字',
    text: 'Figma 自己的覆盖记录按 I<实例 id>;<主组件里图层的 id> 记，我们的 components.ts 也是这么对应的。key 写主组件里图层的 id，名字写在注释里给 agent 看。覆盖是页面的主体，要当核心来设计。',
  },
  {
    title: '拆分要管组件库',
    text: '页面折叠完实例以后很小，1000 行的阈值几乎碰不到；组件库反而巨大。组件文件拆成"接口"（props、变体的联合类型，agent 主要读这部分）和"每个变体的内部结构"。',
  },
  {
    title: 'token 要包括样式',
    text: '真实稿子用的几乎全是样式，tokens/ 要有颜色、文字、效果样式。插件现在只导出样式的名字，值从用到这个样式的图层上反推：203 个样式的所有用处取值都一样。token 引用的值按节点所在的模式算，不能在求值时写死。',
  },
  {
    title: '折叠的矢量只读',
    text: '把图标折叠成一个 Fg.Vector 和"一一对应"冲突。实例外能折叠的纯矢量组只有 0.7%，图标基本都是实例。折叠的块只读，要改就先展开。',
  },
];

const MISMATCH: [string, string, string][] = [
  [
    '嵌套 Text',
    'RN 的嵌套 Text 会继承父 Text 的样式，正好对上 Figma 的"整段样式 + 分段覆盖"',
    '只嵌套一层，子 Text 只写和整段不同的字段',
  ],
  [
    "fontWeight: '600'",
    'Figma 存的是字体样式名（"Semi Bold Italic"），数字字重会丢信息',
    'fg-fontStyle',
  ],
  [
    'lineHeight、letterSpacing',
    'Figma 有百分比和像素两种单位，RN 只有像素',
    '带单位，或用 fg-',
  ],
  [
    'transform: [{ rotate }]',
    'Figma 旋转后的 x/y 是转过之后的左上角；RN 的 left/top 是没转之前的框，再绕中心转',
    'left / top 写没转之前的框，按 RN 的意思用 transform',
  ],
  [
    '组写成 <View>',
    'Figma 的组没有自己的坐标系，组的框跟着子图层算',
    'Fg.Group',
  ],
  [
    'flexbox（Yoga）',
    '旋转过的子图层按外接框占位；包裹内容时交叉轴不算"填充"的子图层；描边不占布局空间',
    '名字可以借，计算必须用我们自己的 auto-layout.ts',
  ],
];

const RULES: string[] = [
  '不改就不变：代码 → JSON → 代码，文件一个字节都不变。',
  '只动改到的地方：画布上的一次操作，在 git diff 里只出现相关的几行。',
  '结果对得上：补丁写回以后重新求值，和画布上的 JSON 完全一样。',
  '拖动过程中只改 JSON，松手时才写回代码。',
  '改了绑 token 的值就解绑：t.space.md 换成 16，和 Figma 改变量的规则一样；改 token 本身就改 tokens 文件。',
];

const APPROACHES: {
  name: string;
  who: string;
  editable: string;
  cost: string;
}[] = [
  {
    name: '行为挂在图层外面',
    who: 'Framer 代码覆盖',
    editable:
      '图层全都能改。行为函数挂在图层上，只在预览和发布后的网站里跑，画布上是静态稿。',
    cost: '不能按数据生成新图层。',
  },
  {
    name: '编辑器只认几种逻辑',
    who: 'Plasmic、Builder.io',
    editable:
      '重复（一个模板按数据生成多份）、绑定数据（文字、显示隐藏、变体）、按状态的变体（先"录制"某个变体再改）。',
    cost: '超出这几种的逻辑要写成代码组件，画布上改不了。',
  },
  {
    name: '解析代码、改语法树',
    who: 'CrossUI Studio、Utopia',
    editable:
      '写死的部分能改；循环可以钻进去单独显示一项、手填假数据；条件的两个分支分别钻进去改。改动都是精确的源码补丁。',
    cost: '认不出的代码只能保留和显示。',
  },
  {
    name: '画布改动交给 agent',
    who: 'Figma Make',
    editable:
      '面板里的改动先排队，点 Apply 后由 agent 改代码。Figma 自己的建议：确定要的改动直接改，改交互逻辑用批注。',
    cost: '结果不确定，耗 AI 额度。',
  },
];

const VOCAB: [string, string, string, string][] = [
  ['状态', "state={{ tab: 'home' }}", '顶上一个"当前状态"切换器', '变量和模式'],
  [
    '绑定',
    'visible={$.count === 0}',
    '字段显示成"已绑定"；手改就解绑成写死的值',
    '解绑规则 detachEdited',
  ],
  [
    '按状态的样式',
    '每个状态一份覆盖',
    '选中一个状态进入"录制"，改动只记在这个状态上',
    '组件变体、覆盖记录',
  ],
  [
    '重复',
    '<Fg.Repeat data={items}>',
    '改任何一项都是改模板；每项不同的地方只来自数据',
    '改主组件同步到所有实例',
  ],
  [
    '条件显示',
    '隐藏的图层',
    '在图层树里选中时临时显示出来编辑',
    '隐藏的图层也建了图形',
  ],
  [
    '事件',
    'onPress={set({ count: $.count + 1 })}',
    '面板里列出动作，能改目标和值',
    '没有，要新做',
  ],
  [
    '任意代码',
    '自定义 hook、网络请求',
    '只显示，不能直接改；选中后"让 agent 改"',
    '没有，要新做',
  ],
];

const MODES: { mode: string; meaning: string }[] = [
  { mode: '没选状态时改', meaning: '改所有状态（改基础样式）' },
  { mode: '进入"录制某个状态"再改', meaning: '只记在这个状态上' },
  { mode: '改的字段绑着数据', meaning: '改的是这条数据' },
];

const SOURCES: { label: string; href: string }[] = [
  {
    label: 'Framer Overrides',
    href: 'https://www.framer.com/developers/overrides-introduction',
  },
  {
    label: 'Plasmic 变体',
    href: 'https://docs.plasmic.app/learn/variants/',
  },
  {
    label: 'Plasmic 重复元素',
    href: 'https://docs.plasmic.app/learn/repeated-elements/',
  },
  {
    label: 'Builder.io 数据绑定',
    href: 'https://www.builder.io/c/docs/data-binding-entries',
  },
  {
    label: 'CrossUI Studio',
    href: 'https://dev.to/linb/edit-inside-a-map-a-ternary-even-a-component-in-another-file-2e7',
  },
  { label: 'Utopia', href: 'https://github.com/concrete-utopia/utopia' },
  {
    label: 'Figma Make 连本地代码',
    href: 'https://www.figma.com/blog/figma-make-now-on-your-local-code/',
  },
];

const MUST: { title: string; text: string }[] = [
  {
    title: '矢量按几何数据画',
    text: '现在矢量按 Figma 导出的 SVG 画，颜色写死在 SVG 里：改了填充画面不变，大部分隐藏的矢量没有 SVG。导入时要导出路径数据，自己画、自己算布尔运算。这也是可交互和画布编辑的前提。',
  },
  {
    title: '图片滤镜自己算',
    text: '现在用 Figma 渲染好的图；自己实现 7 种滤镜正在做。',
  },
  {
    title: '整份文件和团队库',
    text: '插件现在一次导一个用例或一个 section。迁移要导整份文件的所有页面，还有跨文件的组件库和变量库，引用要对得上。',
  },
  {
    title: '样式体系',
    text: '47% 的节点用了样式，我们还没有样式。',
  },
  {
    title: '代码的存储',
    text: '现在用例从文件读，导入页存在浏览器里，服务端只有登录。',
  },
  {
    title: 'Figma 算好的字段',
    text: 'absoluteBoundingBox 这类字段编辑后就不准了，要么自己重算，要么不存。',
  },
  {
    title: '和 Figma 一样的编辑体验',
    text: '还缺钢笔工具、换行和网格自动布局、评论、多人协作、整份大文件的性能（Untitled UI 的"组件"页 11892 个图形，打开要 5.5 秒）。',
  },
];

const STEPS: {
  title: string;
  what: string;
  done: string;
  status: 'todo' | 'doing' | 'done';
}[] = [
  {
    title: '补全导入',
    what: '插件导出矢量的路径数据、样式的值；导整份文件的所有页面和团队库。',
    done: '一份真实文件整份导进来，组件库和变量库的引用都连上。',
    status: 'todo',
  },
  {
    title: '渲染不靠 Figma',
    what: '矢量按几何数据画，图片滤镜自己算。',
    done: '现有用例的还原度不下降；改矢量的颜色能在画布上看到。',
    status: 'todo',
  },
  {
    title: 'Figma → 代码',
    what: '从快照生成方言代码：覆盖按 id，组件拆成接口和变体。',
    done: '88 个真实页面都能生成，代码通过方言规则检查。',
    status: 'todo',
  },
  {
    title: '代码 → JSON',
    what: '解析代码、求值，每个节点带上源码位置。',
    done: '生成再求值，和快照逐字段一致，画出来逐像素一样。',
    status: 'todo',
  },
  {
    title: '画布改动 → 代码',
    what: '画布上的每种编辑操作变成最小的源码补丁。',
    done: '满足上面第 7 节的五条。',
    status: 'todo',
  },
  {
    title: 'agent 任务对比',
    what: '同样的修改任务，一次给原始 JSON，一次给代码。',
    done: '有改对率和 token 数的对比，据此决定方言要不要调整。',
    status: 'todo',
  },
  {
    title: '可交互的最小验证切片',
    what: '拿现有的 variables 用例（角标的显示隐藏绑了变量），加演示模式和三种编辑模式。',
    done: '演示模式里点按钮能切状态；三种模式的改动都生成对的补丁。',
    status: 'todo',
  },
];

const STATUS_LABEL = { todo: '未开始', doing: '进行中', done: '完成' };

const QUESTIONS: string[] = [
  '交互的分界线：只用第 8 节那几种写法，任意代码画布上只读、交给 agent？（建议：是）',
  '迁移期间设计师还会不会继续在 Figma 里改？会的话同一份文件要能多次导入，还要和我们这边的修改合并。',
  '代码存在哪：每份设计稿一个 git repo？服务端怎么存、agent 怎么访问？',
  '方言的运行时、生成代码和求值的代码放在哪：新的 packages/*（属于架构改动）。',
  'fg- 扩展属性的名字：沿用 Figma 插件 API 的名字，还是自己定一套？',
  '拆分阈值（1000 / 600 / 100 行）要用真实文件调。',
];

function Section({
  title,
  lead,
  children,
}: {
  title: string;
  lead?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-5">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {lead && (
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            {lead}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b text-left text-xs text-muted-foreground">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((cell, j) => (
                <td key={j} className="px-4 py-2 align-top">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Stats({ report }: { report: FidelityReport | null }) {
  const stats: [string, string][] = [];
  if (report && report.results.length > 0) {
    const results = report.results;
    const average = results.reduce((s, r) => s + r.diff, 0) / results.length;
    stats.push(
      [String(results.length), '还原度用例'],
      [formatDiff(average), '和 Figma 的平均差异'],
      [String(results.filter((r) => r.diff < 1).length), '差异小于 1%'],
    );
  }
  stats.push(['72%', '真实页面的节点在组件实例里']);
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map(([value, label]) => (
          <div key={label} className="rounded-lg border px-4 py-3">
            <div className="text-2xl font-semibold tracking-tight tabular-nums">
              {value}
            </div>
            <div className="text-xs text-muted-foreground">{label}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {report ? `还原度来自最新一次对比（${report.startedAt}）；` : ''}
        72% 来自 2026-10-30 对 88 个真实页面的统计
      </p>
    </div>
  );
}

export function RoadmapPage() {
  const [report, setReport] = useState<FidelityReport | null>(null);

  useEffect(() => {
    loadLatestReport()
      .then(setReport)
      .catch(() => setReport(null));
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-16 px-6 py-10">
      <header className="space-y-6">
        <nav className="flex flex-wrap gap-4 text-sm text-muted-foreground">
          <Link to="/" className="hover:text-foreground">
            首页
          </Link>
          <Link to="/showcase" className="hover:text-foreground">
            还原展示
          </Link>
          <Link to="/how-it-works" className="hover:text-foreground">
            核心思路
          </Link>
          <Link to="/report" className="hover:text-foreground">
            上一轮汇报
          </Link>
          <Link to="/import" className="hover:text-foreground">
            导入和对比
          </Link>
          <Link to="/canvas" className="hover:text-foreground">
            调试页
          </Link>
        </nav>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            目标和计划 · 2026-10-31
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            从 Figma 搬到我们自己的设计工具
          </h1>
          <p className="max-w-3xl leading-relaxed text-muted-foreground">
            把 Figma 里沉淀的设计稿导进我们自研的 Skia
            产品。设计稿写成代码：agent
            用读写代码的本事读懂、修改设计稿，这是主要场景；设计师在画布上看稿、手工改稿，体验和
            Figma 一样，改动自动写进代码。用户留在新产品里，以后不回 Figma。
          </p>
        </div>
        <Stats report={report} />
      </header>

      <Section title="1. 目标">
        <div className="grid gap-3 sm:grid-cols-2">
          {GOALS.map((g) => (
            <div key={g.who} className="space-y-1 rounded-lg border p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="font-medium">{g.who}</h3>
                <span className="text-xs text-muted-foreground">
                  {g.weight}
                </span>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {g.what}
              </p>
            </div>
          ))}
        </div>
        <p className="max-w-3xl text-sm leading-relaxed">
          为什么写成代码：Figma
          的原始数据又长又散，模型很少见过；截图只能看出长什么样，看不出结构和数值；而
          agent 最擅长的就是读写代码。
        </p>
      </Section>

      <Section title="2. 已经定下的事">
        <Table
          head={['决定', '理由', '出处']}
          rows={DECISIONS.map((d) => [
            d.decision,
            d.why,
            <span key="s" className="whitespace-nowrap text-muted-foreground">
              {d.source}
            </span>,
          ])}
        />
      </Section>

      <Section
        title="3. 整体怎么运转"
        lead="代码是中心：agent 直接读写它；画布上看到的东西是从代码算出来的，设计师在画布上的改动再变成对代码的小改动。"
      >
        <ol className="grid gap-6 lg:grid-cols-4">
          {FLOW.map((step, i) => (
            <li
              key={step.title}
              className={`relative space-y-2 rounded-lg border p-4 ${step.main ? 'border-foreground' : ''}`}
            >
              {step.arrow && (
                <div className="text-xs text-muted-foreground">
                  ← {step.arrow}
                </div>
              )}
              <div className="font-medium">
                {step.title}
                {step.main && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    真实数据
                  </span>
                )}
              </div>
              <p className="text-sm leading-relaxed">{step.text}</p>
              {i < FLOW.length - 1 && (
                <span
                  aria-hidden
                  className="absolute top-1/2 -right-5 hidden -translate-y-1/2 text-muted-foreground lg:block"
                >
                  →
                </span>
              )}
            </li>
          ))}
        </ol>
        <div className="space-y-2">
          <h3 className="font-medium">代码长什么样</h3>
          <pre className="overflow-x-auto rounded-lg border bg-muted/40 p-4 text-xs leading-relaxed">
            <code>{CODE_SAMPLE}</code>
          </pre>
          <p className="text-sm leading-relaxed text-muted-foreground">
            View、Text 和 flexDirection、gap 这些名字和 React Native
            同名同义；Figma 特有的东西用 fg- 属性和 Fg.
            元素。按钮是组件实例，只写一行；里面改过的文字是"覆盖"，按主组件里图层的
            id 写。
          </p>
        </div>
        <div className="space-y-2">
          <h3 className="font-medium">原始方案里仍然成立的</h3>
          <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed">
            {KEPT.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        </div>
      </Section>

      <Section
        title="4. 已经有的基础"
        lead="这个仓库做的 Figma 还原和编辑器就是新产品的底子。原始方案最担心的“自研引擎要画得和 Figma 一样”，静态稿已经做到了。"
      >
        <Table
          head={['能力', '现在的情况', '代码']}
          rows={EXISTING.map(([a, b, c]) => [
            <span key="a" className="font-medium whitespace-nowrap">
              {a}
            </span>,
            b,
            <code key="c" className="text-xs break-all text-muted-foreground">
              {c}
            </code>,
          ])}
        />
      </Section>

      <Section
        title="5. 真实数据说明了什么"
        lead="2026-10-30 用 6 套社区稿子的 88 个真实页面统计。这些是 UI kit，组件特别多；主组件按整套导出，组件库的倍数偏高。产品稿的比例会不一样，但方向应该一致。"
      >
        <Table
          head={['项', '数', '意味着']}
          rows={DATA.map(([a, b, c]) => [
            a,
            <span key="n" className="whitespace-nowrap tabular-nums">
              {b}
            </span>,
            c,
          ])}
        />
      </Section>

      <Section title="6. 方言要改的地方">
        <div className="grid gap-4 md:grid-cols-2">
          {FIXES.map((f) => (
            <div key={f.title} className="space-y-2 rounded-lg border p-4">
              <h3 className="font-medium">{f.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {f.text}
              </p>
            </div>
          ))}
        </div>
        <h3 className="pt-2 font-medium">几处"同名不同义"</h3>
        <Table
          head={['RN 的写法', 'Figma 的实际意思', '改法']}
          rows={MISMATCH.map(([a, b, c]) => [
            <code key="a" className="text-xs whitespace-nowrap">
              {a}
            </code>,
            b,
            c,
          ])}
        />
      </Section>

      <Section
        title="7. 代码和画布怎么双向转换"
        lead="代码优先以后，难点都在转换层：画布上的改动要落成源码里最小的改动，不能整个文件重新生成，否则会冲掉 agent 写的注释、顺序和拆分方式。"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 rounded-lg border p-4">
            <h3 className="font-medium">代码 → JSON（求值）</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              打开文件时把代码算成画布用的
              JSON，现有的渲染、自动布局、组件、变量都能照用。每个节点记下自己在哪个文件、哪一行哪一列，改回代码要靠它。
            </p>
          </div>
          <div className="space-y-2 rounded-lg border p-4">
            <h3 className="font-medium">画布改动 → 代码（补丁）</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              改间距只把 gap: 12 改成 gap: 16；新建图层插入一行 JSX；拖到别的
              frame 就从一处剪下、贴到另一处，可能还跨文件。
            </p>
          </div>
        </div>
        <h3 className="pt-2 font-medium">"无感"要满足的五条</h3>
        <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed">
          {RULES.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ol>
        <p className="max-w-3xl text-sm leading-relaxed">
          建议<b className="font-medium">页面代码直接解析、不执行</b>
          。画布要改回代码，本来就得解析源码、知道每个节点在第几行；不执行还有两个好处：不用在产品里跑
          agent 写的任意代码，结果也完全确定。等要支持交互行为时再引入执行。
        </p>
      </Section>

      <Section
        title="8. 可交互设计稿还能不能手工改"
        lead="这是现在最核心的难点：设计稿加了状态、循环、条件以后，设计师还能不能在画布上改。调研结论：能，前提是交互用编辑器认得的几种固定写法；认不出的代码只能显示，不能直接改。查到的产品都是这样划线的，只是划法不同。"
      >
        <Table
          head={['做法', '代表', '画布上能改什么', '代价']}
          rows={APPROACHES.map((a) => [
            <span key="n" className="font-medium">
              {a.name}
            </span>,
            <span key="w" className="whitespace-nowrap">
              {a.who}
            </span>,
            a.editable,
            a.cost,
          ])}
        />
        <h3 className="pt-2 font-medium">建议：交互只用这几种写法（还没定）</h3>
        <Table
          head={['写法', '例子', '画布上怎么改', '现在有的基础']}
          rows={VOCAB.map(([a, b, c, d]) => [
            <span key="a" className="font-medium whitespace-nowrap">
              {a}
            </span>,
            <code key="b" className="text-xs">
              {b}
            </code>,
            c,
            <span key="d" className="text-muted-foreground">
              {d}
            </span>,
          ])}
        />
        <div className="space-y-3">
          <h3 className="font-medium">"改的到底是哪个"由编辑模式定</h3>
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            设计师改了一张图，可能是想改所有状态、只改这个状态，或者只改这条数据。不用
            LLM 去猜，学 Plasmic 的“录制”：让设计师先选模式。
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            {MODES.map((m) => (
              <div key={m.mode} className="rounded-lg border px-4 py-3">
                <div className="text-sm font-medium">{m.mode}</div>
                <div className="text-sm text-muted-foreground">
                  → {m.meaning}
                </div>
              </div>
            ))}
          </div>
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            编辑和演示分开：画布上编辑时显示选定的那个状态，交互行为只在演示模式里跑（Framer
            也是这样）。
          </p>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          出处：
          {SOURCES.map((s, i) => (
            <span key={s.href}>
              {i > 0 && '、'}
              <a
                href={s.href}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                {s.label}
              </a>
            </span>
          ))}
          。只看了资料，没有试用；Utopia 怎么处理循环没找到正式说明。
        </p>
      </Section>

      <Section
        title="9. 离开 Figma 必须自己补的"
        lead="以前可以靠 Figma 事先画好的东西，不回 Figma 以后都要自己算。"
      >
        <div className="grid gap-4 md:grid-cols-2">
          {MUST.map((m) => (
            <div key={m.title} className="space-y-2 rounded-lg border p-4">
              <h3 className="font-medium">{m.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {m.text}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="10. 计划"
        lead="建议的顺序，还没开工。前两步不依赖方言，现在就能做；3～5 步是转换层；第 6 步决定方言值不值得继续；第 7 步要等第 2 步的矢量。每一步都能单独跑起来看结果。"
      >
        <ol className="space-y-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-4 rounded-lg border p-4">
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-full border text-sm tabular-nums ${s.status === 'done' ? 'border-foreground' : 'border-dashed text-muted-foreground'}`}
              >
                {s.status === 'done' ? '✓' : i + 1}
              </span>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-medium">{s.title}</h3>
                  <span className="text-xs text-muted-foreground">
                    {STATUS_LABEL[s.status]}
                  </span>
                </div>
                <p className="text-sm leading-relaxed">{s.what}</p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  做完的标准：{s.done}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="11. 还没定的问题">
        <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed">
          {QUESTIONS.map((q) => (
            <li key={q}>{q}</li>
          ))}
        </ol>
      </Section>

      <footer className="border-t pt-6 text-sm text-muted-foreground">
        详细记录在 <code>apps/docs/product-direction/</code>：product.md
        是目标、决定和数据，probe-interactive-editing.md 是可交互的调研，plan.md
        是计划清单，tech.md §1 是这个页面。原始方案是{' '}
        <code>tmp/interactive-plan.md</code>。
      </footer>
    </div>
  );
}
