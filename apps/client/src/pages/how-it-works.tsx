import { Link } from '@tanstack/react-router';
import { type ReactNode, useEffect, useState } from 'react';

import {
  type FidelityReport,
  loadLatestReport,
  reportUrl,
} from '../figma/report';
import { NodeTreeDemo } from '../showcase/node-tree-demo';
import { formatDiff } from '../showcase/score';

// See apps/docs/figma-to-tldraw/tech.md §11.

const EXAMPLE_CASE =
  'real/google-gemini---built-with-material-3-de/gemini-macbook-pro-14---extension-screen';

const PIPELINE: { title: string; code: string; text: string }[] = [
  {
    title: 'Figma 插件',
    code: 'apps/figma-plugin/',
    text: '在 Figma 里把 frame 导出成快照：节点树、矢量 SVG、变换矩阵、图片，外加 Figma 自己渲染的 2 倍图，当作标准答案。',
  },
  {
    title: 'cases/',
    code: 'snapshot.json + expected@2x.png',
    text: '每个用例一个文件夹，快照和标准答案放在一起，换电脑、换浏览器都能重跑。',
  },
  {
    title: '转换',
    code: 'figma/to-shapes.ts',
    text: '一个纯函数：节点树进去，一串 tldraw 图形出来，带类型、位置、父子关系和上下层。',
  },
  {
    title: 'tldraw 画布',
    code: 'figma/shapes/',
    text: '四种自定义图形，照着 Figma 的样式画填充、描边、阴影、文字、裁剪和蒙版。',
  },
  {
    title: '对比',
    code: 'scripts/compare.ts',
    text: 'Playwright 在真实 2 倍屏下截图，pixelmatch 和标准答案逐像素比，出报告和差异归因。',
  },
];

const SHAPES: { shape: string; nodes: string; draws: string }[] = [
  {
    shape: 'figma-frame',
    nodes: 'FRAME、COMPONENT、INSTANCE、GROUP、SECTION',
    draws: '填充、描边、圆角、阴影',
  },
  {
    shape: 'figma-rect',
    nodes: 'RECTANGLE、ELLIPSE',
    draws: '填充（含图片）、描边、圆角、阴影',
  },
  {
    shape: 'figma-text',
    nodes: 'TEXT',
    draws: '字体、字号、行高、对齐、混排样式、渐变文字',
  },
  {
    shape: 'figma-vector',
    nodes: 'VECTOR、布尔运算、星形、多边形、线',
    draws: '直接放 Figma 导出的 SVG',
  },
];

const DECISIONS: { title: string; text: string }[] = [
  {
    title: '自己写 Figma 插件取数据',
    text: '插件的 exportAsync 一次就能导出节点树、SVG 和 PNG，标准答案也是 Figma 自己画的。节点树缺的 size 和 relativeTransform，插件顺手补上 absoluteTransform。',
  },
  {
    title: '用 HTML、CSS、SVG 照着 Figma 画',
    text: '不用 tldraw 自带的手绘风格图形。渐变按 Figma 的三个控制点算成变换矩阵，描边按内侧 / 居中 / 外侧调整几何，阴影用 box-shadow，背景模糊用 backdrop-filter。',
  },
  {
    title: '子图形自己裁剪',
    text: 'tldraw 3.x 的图形在网页里是平铺的，只有自带的 frame 能裁剪。所以反过来：每个图形找出要裁剪它的祖先，把祖先的形状换算到自己的坐标里，用 CSS clip-path 裁自己。蒙版也走这一套。',
  },
  {
    title: '位置统一用矩阵算',
    text: '局部矩阵 = 父图形的页面矩阵⁻¹ × 自己的页面矩阵。旋转、多层嵌套、组里的图层都用同一个公式，不用分情况处理。',
  },
  {
    title: '算不准的交给 Figma',
    text: '矢量直接用 Figma 导出的 SVG；图片滤镜没有公开公式，导出时让 Figma 把加了滤镜的图渲染好；字体用和 Figma 一样的版本（Inter 必须用 3.19）。',
  },
];

const STEPS: { title: string; text: string; result: string }[] = [
  {
    title: '79 个单项用例',
    text: '插件生成，每个只测一种特性：纯色填充、虚线描边、混排文字、蒙版……',
    result: '第一份报告：平均 0.53%，73 / 79 个小于 1%',
  },
  {
    title: '按特性修',
    text: '看差异图找规律，一次修一类问题，不针对某一张图调参数。',
    result: '平均 0.004%，79 / 79 个小于 1%',
  },
  {
    title: '拿真实稿子考试',
    text: '从 Figma 社区复制两份稿子，导出 31 页，规则一条不改直接跑。只用 Inter 的 Untitled UI 24 页全部在 0.17% 以下；Gemini 7 页暴露出缺字体、First on top 叠放、图片滤镜、文字渐变几类问题。',
    result: 'Gemini 7 页平均 8.39%',
  },
  {
    title: '再按特性修，留两页只考不调',
    text: '修的时候不看那两页的差异图，只看分数，用来检验规则对没见过的稿子是不是也管用。',
    result: 'Gemini 平均 0.53%；留作考试的两页 0.22%、0.17%',
  },
];

const FINDINGS: {
  title: string;
  seen: string;
  rule: string;
  effect: string;
}[] = [
  {
    title: 'Inter 的版本',
    seen: '24px 的 "The quick brown fox jumps"，新版 Inter 宽 306.9px，Figma 是 305px。',
    rule: 'Figma 用的是 Inter 3.19（量出来 304.6px），锁定这个版本。',
    effect: '所有文字的换行和宽度对上',
  },
  {
    title: '自动行高',
    seen: '16px 的 Inter 数据里行高是 19.36，5 行段落的框却是 95 高。',
    rule: 'Figma 把自动行高四舍五入到整像素：5 × 19 = 95。',
    effect: 'text/wrap 0.93% → 0.02%',
  },
  {
    title: '文字基线',
    seen: '同一段文字，Chrome 和 Figma 的基线常常差 1px，和字号有关。',
    rule: '两边取整方式不同，用的字体高度表也不同（Chrome 用 hhea，Figma 用 OS/2）。按各自的公式算出差值补上。',
    effect: 'text/cjk-mixed 1.77% → 0.00%',
  },
  {
    title: '虚线',
    seen: 'SVG 的虚线从起点一路重复下去，拐角处和 Figma 不一样。',
    rule: 'Figma 把矩形拆成四条边、四个圆角，每段各放整数个周期，从半个实线开始。',
    effect: 'stroke/dashed 1.09% → 0.00%',
  },
  {
    title: '0.125px 的偏移',
    seen: '深色 frame 的上边和左边总有一条半透明的边。',
    rule: 'tldraw 画图形的那一层故意多平移了 0.125px，截图时把镜头往回挪同样的距离。',
    effect: 'page/gallery 2.02% → 1.03%',
  },
  {
    title: '对比度的单位',
    seen: '加了对比度滤镜的图，按插件里的值去找渲染好的图，全部对不上。',
    rule: '同一个对比度，插件 API 里是 -1，导出的节点树里是 -0.3，要按节点树里的值找。',
    effect: '8 个滤镜用例都在 0.5% 以下',
  },
];

const LIMITS = [
  '组透明度：Figma 是"先画在一起再整体变淡"，tldraw 是每个子图形各自变淡，重叠处会透出下层。上层是不透明的简单形状时已经补上；其他情况要把整个子树画成一个图形，属于架构改动，没做。',
  '没有网页版的字体只能近似：Product Sans 用 Google Sans Flex 代替，剩下的差异都在字形上。',
  '图片滤镜用的是 Figma 渲染好的图，在 tldraw 里改不了滤镜参数。',
  '图层现在只能选中和移动，缩放、旋转手柄关掉了。',
  'Demo 阶段不做：和 Figma 实时同步、写回 Figma、性能优化。',
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

function LiveStats({ report }: { report: FidelityReport }) {
  const results = report.results;
  const average = results.reduce((s, r) => s + r.diff, 0) / results.length;
  const stats = [
    [String(results.length), '用例'],
    [formatDiff(average), '平均差异'],
    [String(results.filter((r) => r.diff < 1).length), '差异小于 1%'],
    [String(results.filter((r) => r.diffPixels === 0).length), '逐像素一致'],
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
        最新一次对比（{report.startedAt}），
        <Link to="/showcase" className="underline underline-offset-4">
          逐个用例看
        </Link>
      </p>
    </div>
  );
}

export function HowItWorksPage() {
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
            ← 还原展示
          </Link>
          <Link to="/canvas" className="hover:text-foreground">
            调试页
          </Link>
        </nav>
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight">
            Figma → tldraw：核心思路
          </h1>
          <p className="max-w-3xl leading-relaxed text-muted-foreground">
            目标是把 Figma 设计稿原样搬到 tldraw 画布上：每个图层到了 tldraw
            里还是一个能选中、能拖动的图形，而且能用数字说清楚还原得有多像。
          </p>
        </div>
        <blockquote className="border-l-4 border-foreground py-1 pl-4 text-lg leading-relaxed font-medium">
          拿 Figma 自己画出来的图当标准答案，逐像素对比；哪里不像，就按 Figma
          的特性找规律去修，不针对某一张稿子调参数。
        </blockquote>
        {report && <LiveStats report={report} />}
      </header>

      <Section
        title="1. 整条链路"
        lead="数据只朝一个方向流：Figma 导出一次，后面每一步都能单独重跑。"
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
      </Section>

      <Section
        title="2. 每个 Figma 节点变成一个 tldraw 图形"
        lead="Figma 里的每个图层都变成 tldraw 里一个独立的自定义图形，父子关系原样保留，所以搬过来以后还能编辑：单独选中一个按钮、拖动一段文字。没选的做法是把整块画成一张图，那样最容易像，但到了 tldraw 里就是一张改不了的图（用户拍板）。"
      >
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">tldraw 图形</th>
                <th className="px-4 py-2 font-medium">对应的 Figma 节点</th>
                <th className="px-4 py-2 font-medium">画什么</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {SHAPES.map((s) => (
                <tr key={s.shape}>
                  <td className="px-4 py-2 font-mono text-xs">{s.shape}</td>
                  <td className="px-4 py-2">{s.nodes}</td>
                  <td className="px-4 py-2">{s.draws}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-muted-foreground">
          试一试：点左边的节点或右边画布上的图形，另一边会跟着选中；拖动一个
          frame，里面的图层会跟着走。点"复位"恢复原样。
        </p>
        <NodeTreeDemo />
      </Section>

      <Section title="3. 几个关键做法">
        <div className="grid gap-4 md:grid-cols-2">
          {DECISIONS.map((d) => (
            <div key={d.title} className="space-y-2 rounded-lg border p-4">
              <h3 className="font-medium">{d.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {d.text}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="4. 怎么量“像不像”"
        lead="同一个用例，Figma 导出的图和 tldraw 的截图逐像素比。下面是 Gemini 的一页：左边 Figma，中间 tldraw，右边红色的点就是不一样的像素，几乎都在文字上（这页缺 Product Sans 字体，用近似字体代替）。"
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {(
            [
              ['expected.png', 'Figma 导出的 2 倍图（标准答案）'],
              ['actual.png', 'tldraw 的 2 倍截图'],
              ['diff.png', 'pixelmatch 差异图'],
            ] as const
          ).map(([file, label]) => (
            <figure key={file} className="space-y-1.5">
              <img
                src={reportUrl(EXAMPLE_CASE, file)}
                alt={label}
                loading="lazy"
                className="w-full rounded-md border bg-white"
              />
              <figcaption className="text-xs text-muted-foreground">
                {label}
              </figcaption>
            </figure>
          ))}
        </div>
        <ul className="grid gap-3 text-sm md:grid-cols-2">
          <li className="rounded-lg border p-4 leading-relaxed">
            <b className="font-medium">只截渲染范围。</b>
            截图页面隐藏 tldraw 的界面、镜头固定，只截 Figma
            导出图盖住的那一块，包括超出 frame 的阴影和内容。
          </li>
          <li className="rounded-lg border p-4 leading-relaxed">
            <b className="font-medium">用真实的 2 倍屏，不用模拟。</b>
            模拟模式下 Chrome 按整像素排版，165.5px 宽的方块会画成 166px；真实的
            Retina 屏和 Figma 一样按半像素排。
          </li>
          <li className="rounded-lg border p-4 leading-relaxed">
            <b className="font-medium">差异 = 不同的像素 ÷ 总像素。</b>
            pixelmatch 阈值 0.1，开着抗锯齿检测，只是边缘抗锯齿不同的像素不算。
          </li>
          <li className="rounded-lg border p-4 leading-relaxed">
            <b className="font-medium">差异归因。</b>
            每个不一样的像素算给盖在最上面的那个节点，就能说出"差异主要在文字上，是哪几段文字"。
          </li>
        </ul>
      </Section>

      <Section title="5. 怎么一步步变像">
        <ol className="space-y-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex gap-4 rounded-lg border p-4">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full border text-sm tabular-nums">
                {i + 1}
              </span>
              <div className="min-w-0 space-y-1">
                <h3 className="font-medium">{s.title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {s.text}
                </p>
                <p className="text-sm font-medium tabular-nums">{s.result}</p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section
        title="6. 找到的几条规律"
        lead="大部分进展来自这种事：先在差异图里看到现象，再量数据找出 Figma 的规则，最后按规则改，同类用例一起变好。"
      >
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {FINDINGS.map((f) => (
            <div key={f.title} className="space-y-2 rounded-lg border p-4">
              <h3 className="font-medium">{f.title}</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">
                {f.seen}
              </p>
              <p className="text-sm leading-relaxed">{f.rule}</p>
              <p className="font-mono text-xs text-muted-foreground">
                {f.effect}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <Section title="7. 还做不到的">
        <ul className="list-disc space-y-2 pl-5 text-sm leading-relaxed">
          {LIMITS.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </Section>

      <footer className="border-t pt-6 text-sm text-muted-foreground">
        详细的设计和施工记录在 <code>apps/docs/figma-to-tldraw/</code>
        ：tech.md 讲怎么做，verification.md 记每份报告的结果。
      </footer>
    </div>
  );
}
