import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';

import { type FidelityReport, loadLatestReport } from '../figma/report';
import { formatDiff } from '../showcase/score';

// See apps/docs/product-direction/tech.md §4.

type PagePath =
  | '/roadmap'
  | '/showcase'
  | '/how-it-works'
  | '/report'
  | '/canvas'
  | '/import'
  | '/compare'
  | '/demo';

const GROUPS: {
  title: string;
  lead: string;
  pages: { to: PagePath; title: string; text: string; date: string }[];
}[] = [
  {
    title: '方向',
    lead: '我们要做成什么、接下来怎么做。',
    pages: [
      {
        to: '/roadmap',
        title: '目标和计划',
        text: '把 Figma 里的设计稿搬进我们自己的产品，写成 agent 能读写的代码，设计师照样能在画布上改。已经定下的事、真实数据、可交互设计稿的调研和 7 步计划。',
        date: '2026-10-31',
      },
    ],
  },
  {
    title: '看成果',
    lead: '画得和 Figma 有多像、是怎么做到的。',
    pages: [
      {
        to: '/showcase',
        title: '还原展示',
        text: '逐个用例看：原稿链接、Figma 截图、能操作的画布和差异分析，差异出在哪个图层一眼能看到。',
        date: '2026-10-24',
      },
      {
        to: '/how-it-works',
        title: '核心思路',
        text: '一页讲清楚链路、关键做法、怎么量还原度、怎么一步步变像，带一个节点树和画布图形互相选中的演示。',
        date: '2026-10-24',
      },
      {
        to: '/report',
        title: '汇报：开源字体用例和组件',
        text: '用例只留开源字体、补 45 个新用例，把 Figma 的主组件和实例搬过来；结果、思路、遇到的问题。',
        date: '2026-10-26',
      },
    ],
  },
  {
    title: '动手试',
    lead: '在画布上编辑，导入自己的稿子对比。',
    pages: [
      {
        to: '/canvas',
        title: '编辑器',
        text: '左边用例列表和图层树，中间画布，右边属性面板。能改样式、文字、自动布局、组件和变量，网址带 case、select 参数能直接打开某个用例、选中某个图层。',
        date: '2026-10-25',
      },
      {
        to: '/import',
        title: '导入和对比',
        text: '导入插件导出的 zip，在浏览器里截图、算和 Figma 的差异；右边看节点数据，能下载渲染图和差异图。',
        date: '2026-10-26',
      },
      {
        to: '/compare',
        title: '导入对比 Demo',
        text: '我们的画布、Figma 截图、差异、差异分析四块镜头一起动，很长的页面放大拖动也流畅。',
        date: '2026-10-28',
      },
      {
        to: '/demo',
        title: '总览 Demo',
        text: '所有用例铺成一面墙画在一块画布上，两万多个图形，看平移、缩放的帧率；地址加 copies 参数能翻倍压性能。',
        date: '2026-10-27',
      },
    ],
  },
];

function Stats({ report }: { report: FidelityReport }) {
  const results = report.results;
  const average = results.reduce((s, r) => s + r.diff, 0) / results.length;
  const stats = [
    [String(results.length), '用例'],
    [formatDiff(average), '和 Figma 的平均差异'],
    [String(results.filter((r) => r.diff < 1).length), '差异小于 1%'],
  ];
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-3 sm:max-w-xl">
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
        来自最新一次对比（{report.startedAt}）
      </p>
    </div>
  );
}

export function HomePage() {
  const [report, setReport] = useState<FidelityReport | null>(null);

  useEffect(() => {
    loadLatestReport()
      .then(setReport)
      .catch(() => setReport(null));
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-14 px-6 py-12">
      <header className="space-y-5">
        <p className="text-sm text-muted-foreground">figma-to-tldraw</p>
        <h1 className="text-3xl font-semibold tracking-tight">
          Figma 设计稿，画在我们自己的画布上
        </h1>
        <p className="max-w-3xl leading-relaxed text-muted-foreground">
          用自研的 Skia 引擎把 Figma 设计稿画得和原稿一样，还能像在 Figma
          里一样编辑。下一步是把设计稿写成代码，让 agent
          读懂、修改设计稿，用户留在我们的产品里。
        </p>
        {report && report.results.length > 0 && <Stats report={report} />}
      </header>

      {GROUPS.map((group) => (
        <section key={group.title} className="space-y-4">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold tracking-tight">
              {group.title}
            </h2>
            <p className="text-sm text-muted-foreground">{group.lead}</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {group.pages.map((page) => (
              <Link
                key={page.to}
                to={page.to}
                className="group flex flex-col gap-2 rounded-lg border p-5 transition-colors hover:border-foreground/40 hover:bg-muted/40"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-medium">
                    {page.title}
                    <span
                      aria-hidden
                      className="ml-1.5 inline-block text-muted-foreground transition-transform group-hover:translate-x-0.5"
                    >
                      →
                    </span>
                  </h3>
                  <code className="text-xs text-muted-foreground">
                    {page.to}
                  </code>
                </div>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {page.text}
                </p>
                <p className="mt-auto pt-1 text-xs text-muted-foreground/70">
                  {page.date}
                </p>
              </Link>
            ))}
          </div>
        </section>
      ))}

      <footer className="space-y-1 border-t pt-6 text-sm text-muted-foreground">
        <p>
          设计和施工记录在 <code>apps/docs/</code>，先看索引{' '}
          <code>apps/docs/README.md</code>。
        </p>
        <p>
          模板自带的 Notes 示例挪到了 <code>/notes</code>
          ，要本地起服务端才能打开。
        </p>
      </footer>
    </div>
  );
}
