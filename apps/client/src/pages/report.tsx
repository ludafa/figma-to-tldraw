import { Link } from '@tanstack/react-router';
import { type ReactNode, useEffect, useState } from 'react';

import { type FidelityReport, loadLatestReport } from '../figma/report';
import { formatDiff } from '../showcase/score';

// See apps/docs/figma-to-tldraw/tech.md §17.

const GOALS: { title: string; status: 'done' | 'open'; result: string }[] = [
  {
    title: '去掉用到商业字体的用例，以后补用例也避开',
    status: 'done',
    result: '151 → 130 个用例，平均差异 0.1334% → 0.0662%',
  },
  {
    title: '补不用商业字体的新用例',
    status: 'done',
    result:
      '补了 45 个（130 → 175）：50+ Landing 24 张、Furniture 15、E-Learning 4、Golio 2，为此装了 5 种开源字体。顺带修了 4 个文字问题，原来 130 个平均 0.0662% → 0.0645%，新的 45 个平均 0.19%',
  },
  {
    title: '导出所有主组件，重建主组件和实例的关联',
    status: 'done',
    result:
      '175 个用例里 2033 个实例连上 1984 个，28.5 万个字段里只有 104 个说不出来源',
  },
  {
    title: '在 tldraw 里实现组件体系',
    status: 'done',
    result:
      '改主组件同步到实例、实例里的改动记成覆盖、切变体、组件属性、重置、分离、新建组件',
  },
  {
    title: '逐个用例切到新的组件体系，还原度不下降',
    status: 'done',
    result: '130 个用例平均 0.0662%，和切换前一样；变化最大的一个差 0.003%',
  },
  {
    title: 'xhigh + high 两轮代码审查',
    status: 'done',
    result:
      'xhigh 一轮报了 15 条，修了 14 条，1 条记成已知问题；high 一轮只看那次修复，报了 10 条：5 条是真问题、已修，2 条复现不出来，3 条是顺手的整理',
  },
];

const REMOVED: { file: string; cases: number; fonts: string }[] = [
  { file: 'Google Gemini', cases: 7, fonts: 'Product Sans' },
  {
    file: 'Social App',
    cases: 5,
    fonts: 'Circular Std、Proxima Nova、SF Pro Text',
  },
  { file: 'Bankpick 银行 App', cases: 5, fonts: 'SF Pro Display' },
  { file: 'FreshGo 外卖 App', cases: 3, fonts: 'SF Pro' },
  { file: 'SaaS Framer 手机页', cases: 1, fonts: 'Switzer（npm 上没有）' },
];

const ADDED: { file: string; cases: number; note: string }[] = [
  {
    file: '50+ Landing page designs',
    cases: 24,
    note: '55 张里原来有 6 张；16 张字体本来就在清单里，8 张装了 Work Sans、Zilla Slab、Roboto Mono、Bitter、Space Mono 以后补上；25 张用了 Avenir、Times、Helvetica 这些商业字体，没导',
  },
  {
    file: 'Furniture 家具电商',
    cases: 15,
    note: '剩下的 15 页：首页 2～5、搜索 1～5、商品详情 2～3、下单流程 4 页，Lato + Montserrat，组件多',
  },
  {
    file: 'Mobile E-Learning App',
    cases: 4,
    note: '线框图页的 4 张，只有形状',
  },
  {
    file: 'Golio 落地页',
    cases: 2,
    note: 'Consulting 公司官网（15320px 高，最长的一页）和 Dribbble Shot',
  },
];

const TEXT_FIXES: { problem: string; cause: string; fix: string }[] = [
  {
    problem: 'Lato 粗斜体的 “digital” 画成了正体',
    cause:
      '斜体一律写 oblique 10deg（给 Inter 用的），Chrome 遇到它不选真正的斜体字形',
    fix: '只有 Inter 写 oblique 10deg，别的字体写 italic',
  },
  {
    problem: 'Lato Light、Black 的字变宽，换行不一样',
    cause: 'lato.css 只声明了 400～800，浏览器拿相邻的字重代替',
    fix: '补上 300 和 900，每个字重都带斜体',
  },
  {
    problem: '“beautiful” 里的 ti 没连起来',
    cause: 'Chrome 在字间距不为 0 时关掉连字，Figma 不关',
    fix: '有字间距时打开 liga、clig',
  },
  {
    problem: '居中的标题整行偏左 6～7px',
    cause:
      '文字末尾有空格。Figma 居中、右对齐时不算行尾的空格，Chrome 的 pre-wrap 算',
    fix: '居中、右对齐的固定宽度文字，画的时候去掉每段末尾的空格',
  },
];

const GROUPS: [string, number, string, string, string][] = [
  ['单项用例（插件生成）', 87, '0.0409%', '0.0409%', '0.498%'],
  ['Untitled UI', 24, '0.0222%', '0.0223%', '0.167%'],
  ['50+ Landing page designs', 6, '0.3387%', '0.3387%', '0.855%'],
  ['Mobile E-Learning App', 4, '0.1790%', '0.1790%', '0.212%'],
  ['Furniture 家具电商', 4, '0.1429%', '0.1429%', '0.231%'],
  ['Golio 落地页', 3, '0.0649%', '0.0645%', '0.115%'],
  ['SaaS Website UI Kit（Framer）', 2, '0.4987%', '0.5009%', '0.751%'],
];

const PIPELINE: { title: string; code: string; text: string }[] = [
  {
    title: '插件找主组件',
    code: 'figma-plugin/code.js · findMains',
    text: '每个实例问 Figma 要主组件；在组件集里就取整套，主组件里套的组件也接着找，直到没有新的。',
  },
  {
    title: '快照多一个 mains',
    code: 'snapshot.json · mains',
    text: '用例外面的主组件导进 mains 字段；被删掉的主组件跳过；隐藏的图层也记位置。',
  },
  {
    title: '按主组件重建实例',
    code: 'figma/components.ts · rebuildTree',
    text: '实例 = 主组件 + 覆盖。每个字段找出来源：主组件、Figma 的覆盖记录、组件属性，说不出来源的补进覆盖。',
  },
  {
    title: '主组件放"组件"页',
    code: 'figma/editor.ts · putSnapshot',
    text: '用例画在第一页，主组件和组件集排在第二页"组件"上；截图对比时不建这一页。',
  },
  {
    title: '组件引擎',
    code: 'figma/editing/instances.ts',
    text: '改主组件时把没被覆盖的字段抄到每个实例；在实例里改东西记成覆盖；撤销、复制粘贴都照顾到。',
  },
];

const FIELDS: [string, string, string][] = [
  ['主组件', '275031', '和主组件一样，直接用主组件的值'],
  ['Figma 的覆盖记录', '8529', '实例的 overrides 里列了这个字段'],
  ['组件属性', '962', '布尔、文字、换实例属性管的字段'],
  ['推断的覆盖', '104', '和主组件不一样又没记录，保留实例的值并补进覆盖'],
];

const BEHAVIORS: { action: string; result: string }[] = [
  {
    action: '改主组件里的图层',
    result:
      '所有实例里对应的图层跟着变；实例自己改过的字段不动，组件属性管的字段不动',
  },
  {
    action: '改实例里的图层',
    result:
      '字段名记进最外层实例的 overrides，以后主组件再改这个字段也不会冲掉',
  },
  {
    action: '在实例里删图层',
    result:
      '和 Figma 一样变成隐藏，记一条 visible 覆盖；实例里的图层也不能拖动、缩放',
  },
  {
    action: 'Duplicate、复制粘贴实例',
    result:
      '新实例拿到新的 id，里面的图层跟着换前缀，所以照样跟着主组件；粘贴主组件得到的是它的实例',
  },
  {
    action: '切变体',
    result:
      '在组件集里找属性对得上的变体，按它重新复制图层；覆盖按名字路径搬过去，尺寸跟着新变体',
  },
  {
    action: '布尔、文字属性',
    result: '按图层的 componentPropertyReferences 显示隐藏图层、换文字',
  },
  {
    action: '重置、分离、新建组件、生成实例',
    result: '面板按钮；⌥⌘K 把 frame 变成主组件，和 Figma 一样',
  },
  { action: '撤销', result: '同步出去的改动和原来的改动是同一步，一起撤回' },
];

const PROBLEMS: { title: string; seen: string; fix: string }[] = [
  {
    title: '被删掉的主组件是空壳',
    seen: 'E-Learning、50+ Landing、Untitled UI、Framer 都有实例的主组件导出来没有子图层、位置在 0, 0。Figma 删了主组件以后，实例还能用，主组件被藏到一个不在页面列表里的内部页面。',
    fix: '插件看主组件所在页面在不在 figma.root.children 里，不在就跳过并警告；导入时主组件是空壳、实例却有子图层，也当作连不上，实例原样保留。',
  },
  {
    title: '1650 个说不出来源的字段',
    seen: '第一次重建时 1650 个字段和主组件不一样、又没有覆盖记录。',
    fix: '三类规则没写对：换过主组件的嵌套实例要和新主组件比；fills 的覆盖也包括填充样式 styles；background 这类跟着 fills 变的派生字段不比。改完降到 70 个。',
  },
  {
    title: '导出时丢了子图层',
    seen: 'Furniture 每页导航栏里有一个隐藏的嵌套实例，Figma 的 REST 导出不带它的子图层，切出来就是空的。',
    fix: '父图层是隐藏的、实例里又找不到的图层，按主组件补上一份，挪到对应位置（补了 12 个图层）。',
  },
  {
    title: '隐藏的图层原来不导',
    seen: '变体和布尔属性会把隐藏的图层显示出来，但插件以前跳过隐藏的图层，转换时也不建图形。',
    fix: '插件对隐藏的子树也记位置和图片；转换时建成隐藏的图形，不显示也点不中；隐藏的矢量 Figma 渲染不出 SVG，先放一个占位。',
  },
  {
    title: '"组件"页一个图形都没有',
    seen: 'Untitled UI 的"组件"页有 11892 个图形，结果一个也没建出来。',
    fix: 'tldraw 一页最多 4000 个图形，而且数的是当前页。把 maxShapesPerPage 调到 10 万。',
  },
  {
    title: 'Duplicate 出来的实例不跟主组件',
    seen: '复制出来的实例换了新 id，里面的图层却各自拿到不相干的 id，改主组件时它不变。',
    fix: 'tldraw 的 duplicate 先建子图层、后建父图层，子图层建的时候还不知道父图层的新 id。把 createShapes 包一层，按"父图层在前"重新排。',
  },
  {
    title: '两轮代码审查',
    seen: 'xhigh 一轮报的 15 条大多在嵌套实例上：外面主组件给嵌套实例设的覆盖被冲掉、有覆盖的实例切变体报错、实例拉大以后切变体图层不按约束挪。high 一轮只看这次修复，又找到 5 条，比如主组件里分离嵌套实例后，实例里那一层再也不同步。',
    fix: '每条先在 Node 里写测试复现、确认修之前失败再修，测试从 12 条加到 26 条。复现不出来的 2 条没改；"在主组件里重置嵌套实例，实例给那一层记的覆盖值会丢"记成已知问题。',
  },
  {
    title: '夜里没法操作 Figma',
    seen: '补新用例要在 Figma 桌面版里点插件导出。自动操作电脑的工具一直报“屏幕不可用”；Figma 桌面版又不认远程调试参数，没法像网页那样控制。',
    fix: '换成 macOS 自带的办法：screencapture 截屏看界面，System Events 点菜单打开插件、等保存对话框，再写一个十几行的 Swift 小程序发鼠标点击。不选东西时插件导出整页的 frame，每页点一次。',
  },
  {
    title: '新用例里的四个文字问题',
    seen: '新补的 37 个用例第一次跑平均 0.29%，最差的 designs-48 2.29%，三个最差的都是 Lato 的稿子，差异几乎全在文字上。',
    fix: '斜体画成正体、缺两个字重、有字间距时没有连字、居中文字算了行尾空格，四处都改了（见第 2 节）。全量重跑，老用例也跟着变好一点，没有变差的。',
  },
  {
    title: '家具首页时好时坏',
    seen: '同一页对比结果 0.23%、1.82%、2.62%、9.07% 都出现过，每次空白的地方不一样。',
    fix: '浏览器窗口按整页高度开，Chrome 要同时备好大约 245 MB 的画面图块，超了就丢块。改成窗口只有一段高、移动镜头分段截，每段截到稳定为止，连跑 4 次都是 0.23%。',
  },
];

const SHOWCASE: string[] = [
  '展示页 /showcase：去掉 Gemini、Social App、Bankpick、FreshGo 四套稿子的分组和原稿链接；Framer、Furniture 的说明按现在的情况改写；顶上四个数字跟着最新报告变成 130 个用例。',
  '思路介绍页 /how-it-works：示例换成不缺字体的用例；"还做不到的"里去掉"只能移动"（现在能编辑），加上组件；字体那条规律改成"只用开源字体"。',
  '展示页的分组说明：50+ Landing 从 6 张补到 30 张，Furniture 从 4 张到 19 张，E-Learning 多了 4 张线框图，Golio 多了 2 页，写明了没导的稿子用的是哪些商业字体。',
  '调试页 /canvas：图层树上面多了页面标签，能切到"组件"页；实例、主组件是紫色；面板多了"实例""组件"两节；网址加 select=<节点 id> 能直接选中一个图层。',
];

const LEFT: string[] = [
  '50+ Landing 还有 25 张用了 Avenir、Times、Helvetica 这些商业字体，按规则没导。',
  '大小字号混排的一行（designs-48 的 “digital”，1.24%）基线比 Figma 高 10px 左右；混排的规则只验证过一个用例。',
  '换实例属性（INSTANCE_SWAP）只显示不能改：Figma 给的候选是组件 key，导出的数据里对不上 node id。',
  'Slots、组件属性的新建和改名、变量模式都没做。',
  '在主组件里重置嵌套实例或给它切变体时，实例给那一层记的覆盖值会丢（覆盖记录还在）；Figma 里这种操作少，先记下。',
  '"组件"页让大稿子打开变慢：Untitled UI 一页 5.5 秒；以后可以等打开"组件"页时再建。',
];

const DEMOS: { title: string; dir: string; select: string; steps: string }[] = [
  {
    title: '切变体、改文字属性',
    dir: 'real/saas-website-ui-kit-framer-website-kit-c/light-page-desktop',
    select: '2015:1191',
    steps:
      '已经选中 Hero 里的 "Get for free" 按钮（紫色选框）。在右边面板把 CTA 换成 "Black S arrow"：按钮里多了箭头、变宽，旁边的 "Learn more" 跟着右移。再把 Text 改成别的字，或点"重置所有覆盖""分离实例"。Cmd+Z 撤销。',
  },
  {
    title: '改主组件，实例跟着变',
    dir: 'real/furniture-e-commerce-community/design-cart',
    select: '108:9788',
    steps:
      '已经选中 "Input" 实例，它的文字在 Figma 里改成了 "Your voucher code"。点面板里的"跳到主组件"，切到"组件"页；改主组件里文字的颜色，再点图层树上面的 "Page 1" 回来：实例里的字跟着变了色，内容还是 "Your voucher code"，因为文字是实例自己改过的字段，主组件冲不掉。',
  },
];

function canvasUrl(dir: string, select: string) {
  return `/canvas?case=${encodeURIComponent(dir)}&select=${encodeURIComponent(select)}`;
}

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

function Stats({ report }: { report: FidelityReport }) {
  const results = report.results;
  const average = results.reduce((s, r) => s + r.diff, 0) / results.length;
  const stats = [
    [String(results.length), '用例（只用开源字体）'],
    [formatDiff(average), '平均差异'],
    [String(results.filter((r) => r.diff < 1).length), '差异小于 1%'],
    ['1984', '连上主组件的实例'],
  ];
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
        前三个数字来自最新一次对比（{report.startedAt}）
      </p>
    </div>
  );
}

function Demo({ demo }: { demo: (typeof DEMOS)[number] }) {
  const [open, setOpen] = useState(false);
  const url = canvasUrl(demo.dir, demo.select);
  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-medium">{demo.title}</h3>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="text-sm underline underline-offset-4"
        >
          在新标签页打开
        </a>
      </div>
      <p className="text-sm leading-relaxed text-muted-foreground">
        {demo.steps}
      </p>
      {open ? (
        <iframe
          title={demo.title}
          src={url}
          className="h-[640px] w-full rounded-md border bg-white"
        />
      ) : (
        <button
          type="button"
          className="h-10 rounded-md border px-4 text-sm hover:bg-muted"
          onClick={() => setOpen(true)}
        >
          在这里打开编辑器
        </button>
      )}
    </div>
  );
}

export function ReportPage() {
  const [report, setReport] = useState<FidelityReport | null>(null);

  useEffect(() => {
    loadLatestReport()
      .then(setReport)
      .catch(() => setReport(null));
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-16 px-6 py-10">
      <header className="space-y-6">
        <nav className="flex gap-4 text-sm text-muted-foreground">
          <Link to="/showcase" className="hover:text-foreground">
            还原展示
          </Link>
          <Link to="/how-it-works" className="hover:text-foreground">
            核心思路
          </Link>
          <Link to="/canvas" className="hover:text-foreground">
            调试页
          </Link>
        </nav>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">汇报 · 2026-10-26</p>
          <h1 className="text-3xl font-semibold tracking-tight">
            开源字体用例和 Figma 组件
          </h1>
          <p className="max-w-3xl leading-relaxed text-muted-foreground">
            这一轮做了两件事：用例只留开源字体，让还原度只反映渲染本身；把 Figma
            的主组件和实例搬进
            tldraw，实例不再是一堆普通图层，改主组件时会跟着变。
          </p>
        </div>
        {report && <Stats report={report} />}
      </header>

      <Section title="1. 六件事做到哪了">
        <ol className="space-y-3">
          {GOALS.map((g, i) => (
            <li key={g.title} className="flex gap-4 rounded-lg border p-4">
              <span
                className={`flex size-7 shrink-0 items-center justify-center rounded-full border text-sm tabular-nums ${g.status === 'done' ? 'border-foreground' : 'border-dashed text-muted-foreground'}`}
              >
                {g.status === 'done' ? '✓' : i + 1}
              </span>
              <div className="min-w-0 space-y-1">
                <h3 className="font-medium">{g.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {g.result}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        title="2. 只留开源字体的用例"
        lead="商业字体没有合法的网页版，浏览器只能用后备字体画，这部分差异和渲染无关，混在平均分里看不出真实水平。规则：一个用例只能用开源、能从 npm 装上的字体（Inter、Noto Sans SC、Red Hat Display、Poppins、Montserrat、Lato、DM Sans、Urbanist、Lexend、Nunito，补新用例时又加了 Work Sans、Zilla Slab、Roboto Mono、Bitter、Space Mono），导入脚本自动跳过不合规的用例。"
      >
        <Table
          head={['去掉的稿子', '用例数', '用到的商业字体']}
          rows={REMOVED.map((r) => [r.file, r.cases, r.fonts])}
        />
        <p className="text-sm leading-relaxed">
          去掉的 21 个用例原来平均 0.549%，剩下的 130 个平均
          <b className="font-medium"> 0.1334% → 0.0662%</b>
          ：平均分里一半的差异来自商业字体。130 个全部小于 1%，47 个逐像素一致。
        </p>
        <h3 className="pt-2 font-medium">补的新用例</h3>
        <p className="text-sm leading-relaxed text-muted-foreground">
          按同一条规则从已经复制到草稿里的社区稿子补，优先挑组件多的页面。新装的
          5 种字体先量过宽度，和 Figma 的比值在 0.991～1.001 之间。
        </p>
        <Table
          head={['稿子', '补的用例', '说明']}
          rows={ADDED.map((a) => [a.file, a.cases, a.note])}
        />
        <p className="text-sm leading-relaxed text-muted-foreground">
          第一次跑 37 个新用例（那时还没装新字体）平均 0.29%，最差的三个都是
          Lato 的稿子。看差异图找到四个文字问题：
        </p>
        <Table
          head={['问题', '原因', '改法']}
          rows={TEXT_FIXES.map((f) => [f.problem, f.cause, f.fix])}
        />
        <p className="text-sm leading-relaxed">
          改完以后 175 个用例平均 <b className="font-medium">0.0961%</b>，174
          个小于 1%。原来的 130 个
          <b className="font-medium"> 0.0662% → 0.0645%</b>
          ，没有一个变差；新的 45 个平均 0.19%，最差的 designs-48 从 2.29% 降到
          1.24%，剩下的差异在大小字号混排的那一行。
        </p>
      </Section>

      <Section
        title="3. 实现思路"
        lead="方向按调研的方案 A：实例里的图层还是真实的 tldraw 图形，实例只多记一份覆盖；主组件放单独的“组件”页；不用 tldraw 的绑定。数据仍然只有 props.node 一份。"
      >
        <ol className="grid gap-6 lg:grid-cols-5">
          {PIPELINE.map((step, i) => (
            <li
              key={step.title}
              className="relative space-y-2 rounded-lg border p-4"
            >
              <div className="text-xs text-muted-foreground tabular-nums">
                {i + 1} / {PIPELINE.length}
              </div>
              <div className="font-medium">{step.title}</div>
              <code className="block text-[11px] break-all text-muted-foreground">
                {step.code}
              </code>
              <p className="text-sm leading-relaxed">{step.text}</p>
              {i < PIPELINE.length - 1 && (
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
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 rounded-lg border p-4">
            <h3 className="font-medium">实例和主组件怎么对上</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              实例里图层的 id 是{' '}
              <code>I&lt;实例 id&gt;;&lt;主组件里图层的 id&gt;</code>
              ，嵌套的实例往后接，比如 <code>I9:1;1:3;5:2</code>
              。靠这个 id，主组件里每个图层都能找到它在每个实例里的那一份。
            </p>
          </div>
          <div className="space-y-2 rounded-lg border p-4">
            <h3 className="font-medium">位置永远用实例自己的</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              位置和尺寸是 Figma
              排好版的结果，重建时一律用实例的；其他字段按来源取值。所以重建后画出来和以前一模一样。
            </p>
          </div>
        </div>
        <Table
          head={['字段来源', '个数', '意思']}
          rows={FIELDS.map(([a, b, c]) => [
            a,
            <span key="n" className="tabular-nums">
              {b}
            </span>,
            c,
          ])}
        />
        <p className="text-sm text-muted-foreground">
          175 个用例（2026-10-26 补完新用例后）：实例 2033
          个（最外层和换过主组件的），连上主组件 1984 个，连不上的 49
          个是主组件被删掉的（或嵌在这些实例里的）；换过主组件的 333 个；图层
          15927 个，实例比主组件多或少的图层都是 0。
        </p>
      </Section>

      <Section
        title="4. tldraw 里的组件"
        lead="选中实例或主组件时选框是 Figma 的紫色；右边面板多了“实例”和“组件”两节，图层树上面能切到“组件”页。"
      >
        <Table
          head={['操作', '结果']}
          rows={BEHAVIORS.map((b) => [b.action, b.result])}
        />
        <div className="grid gap-4">
          {DEMOS.map((d) => (
            <Demo key={d.dir} demo={d} />
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          这些行为有 26 条单测（在 Node 里建真的 tldraw
          编辑器跑），另外在浏览器里用 Playwright 点过面板上的每个按钮。
        </p>
      </Section>

      <Section title="5. 遇到的问题">
        <div className="grid gap-4 md:grid-cols-2">
          {PROBLEMS.map((p) => (
            <div key={p.title} className="space-y-2 rounded-lg border p-4">
              <h3 className="font-medium">{p.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {p.seen}
              </p>
              <p className="text-sm leading-relaxed">{p.fix}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="6. 效果"
        lead="切到组件体系以后（实例按主组件重建、隐藏图层也建成图形），130 个用例全量对比一遍，和切换前逐个比。"
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ['0.0662%', '平均差异，和切换前一样'],
              ['0.003%', '变化最大的一个用例（Framer 亮色页）'],
              ['121 / 130', '差异像素数一个不差的用例'],
            ] as const
          ).map(([value, label]) => (
            <div key={label} className="rounded-lg border px-4 py-3">
              <div className="text-2xl font-semibold tracking-tight tabular-nums">
                {value}
              </div>
              <div className="text-xs text-muted-foreground">{label}</div>
            </div>
          ))}
        </div>
        <Table
          head={['分组', '用例', '切换前平均', '切换后平均', '最大']}
          rows={GROUPS.map(([name, n, before, after, max]) => [
            name,
            n,
            <span key="b" className="tabular-nums">
              {before}
            </span>,
            <span key="a" className="tabular-nums">
              {after}
            </span>,
            <span key="m" className="tabular-nums">
              {max}
            </span>,
          ])}
        />
        <p className="text-sm leading-relaxed text-muted-foreground">
          130 个全部小于 1%，47 个逐像素一致。差异最大的是 50+ Landing 的
          designs-30（0.855%），差异集中在一个星形图案和一行粗体标题的边缘上，和组件无关。打开"组件"页会多建很多图形：Untitled
          UI 一页的"组件"页有 11892 个图形，打开要 5.5
          秒；截图对比时不建这一页。xhigh 审查修完后又全量跑了一遍：平均还是
          0.0662%，129 个用例差异像素数一个不差（high
          那轮只改了编辑时的同步，截图不经过这段代码）。
        </p>
        <p className="text-sm leading-relaxed text-muted-foreground">
          上面的表是 130 个用例时的结果。补到 175
          个、修完四个文字问题以后全量再跑：平均 0.0961%，174 个小于 1%，48
          个逐像素一致；差异最大的是 designs-48（1.24%），其次是
          designs-30（0.855%）。
        </p>
        <p className="text-sm">
          <Link to="/showcase" className="underline underline-offset-4">
            在展示页逐个用例看 →
          </Link>
        </p>
      </Section>

      <Section title="7. 展示页的更新">
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed">
          {SHOWCASE.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </Section>

      <Section title="8. 还没做的">
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed">
          {LEFT.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </Section>

      <footer className="border-t pt-6 text-sm text-muted-foreground">
        详细记录在 <code>apps/docs/figma-to-tldraw/</code>：tech.md §15
        是开源字体，§16 是组件，§17 是这个页面，verification.md
        记每份报告的结果。
      </footer>
    </div>
  );
}
