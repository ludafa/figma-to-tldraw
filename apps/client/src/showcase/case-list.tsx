import { Link } from '@tanstack/react-router';
import { useState } from 'react';

import { cn } from '@/lib/utils';

import { caseUrl } from '../figma/load';
import type { FidelityReport, FidelityResult } from '../figma/report';
import type { CaseIndex, CaseSummary } from '../figma/types';
import { caseName, type CaseGroup, groupKey } from './groups';
import { formatDiff, Score, TONE_LEGEND, ToneDot } from './score';
import { sourceOf } from './sources';

// See apps/docs/figma-to-tldraw/tech.md §10.

type Order = 'group' | 'diff';

function average(results: FidelityResult[]): number {
  return results.reduce((s, r) => s + r.diff, 0) / (results.length || 1);
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border px-4 py-3">
      <div className="text-2xl font-semibold tracking-tight tabular-nums">
        {value}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function CaseCard({
  entry,
  result,
  showGroup,
}: {
  entry: CaseSummary;
  result?: FidelityResult;
  showGroup?: boolean;
}) {
  return (
    <Link
      to="/showcase"
      search={{ case: entry.dir }}
      className="group block overflow-hidden rounded-lg border bg-card transition-colors hover:border-foreground/30"
    >
      <div className="flex h-40 items-center justify-center bg-white p-2">
        <img
          src={caseUrl(entry.dir, 'expected@2x.png')}
          alt=""
          loading="lazy"
          className="max-h-full max-w-full object-contain"
        />
      </div>
      <div className="flex items-center justify-between gap-2 border-t px-3 py-2 text-sm">
        <span className="min-w-0 truncate">
          {caseName(entry.dir)}
          {showGroup && (
            <span className="ml-1.5 text-xs text-muted-foreground">
              {groupKey(entry.dir).replace(/^real\//, '')}
            </span>
          )}
        </span>
        <Score result={result} />
      </div>
    </Link>
  );
}

const gridClass = 'grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3';

export function CaseList({
  index,
  groups,
  results,
  report,
}: {
  index: CaseIndex;
  groups: CaseGroup[];
  results: Map<string, FidelityResult>;
  report: FidelityReport | null | undefined;
}) {
  const [order, setOrder] = useState<Order>('group');
  const all = [...results.values()];
  const byDiff = [...index.cases].sort(
    (a, b) =>
      (results.get(b.dir)?.diff ?? -1) - (results.get(a.dir)?.diff ?? -1),
  );

  return (
    <div className="mx-auto max-w-[1600px] space-y-8 px-6 py-8">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">
          Figma → tldraw 还原展示
        </h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
          每个用例都放了四样东西：Figma 原稿的链接、Figma
          自己导出的截图、用我们的转换画出来的 tldraw
          画布，以及两张图逐像素对比的差异分析。点开任意一张卡片看详情。
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link
            to="/how-it-works"
            className="font-medium underline-offset-4 hover:underline"
          >
            核心思路 →
          </Link>
          <a
            href="/reports/fidelity/latest/index.html"
            target="_blank"
            rel="noreferrer"
            className="underline-offset-4 hover:underline"
          >
            原始对比报告 ↗
          </a>
          <Link to="/canvas" className="underline-offset-4 hover:underline">
            调试页 /canvas
          </Link>
        </div>
      </header>

      {report === null && (
        <p className="rounded-lg border p-4 text-sm">
          还没有对比报告：先运行 <code>pnpm dev:client</code>，再运行{' '}
          <code>pnpm --filter @figma-to-tldraw/client compare</code>。
        </p>
      )}
      {report && (
        <section className="space-y-2">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat value={String(all.length)} label="用例数" />
            <Stat value={formatDiff(average(all))} label="平均差异" />
            <Stat
              value={String(all.filter((r) => r.diff < 1).length)}
              label="差异小于 1%"
            />
            <Stat
              value={String(all.filter((r) => r.diffPixels === 0).length)}
              label="逐像素一致"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            报告时间 {report.startedAt}
          </p>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-4 text-sm">
        <div className="flex gap-1 rounded-md border p-0.5">
          {(
            [
              ['group', '按分组'],
              ['diff', '按差异从大到小'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setOrder(value)}
              className={cn(
                'rounded px-2 py-0.5 hover:bg-muted',
                order === value && 'bg-muted font-medium',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {TONE_LEGEND.map((t) => (
            <li key={t.tone} className="flex items-center gap-1.5">
              <ToneDot tone={t.tone} />
              {t.label}
            </li>
          ))}
        </ul>
      </div>

      {order === 'diff' ? (
        <div className={gridClass}>
          {byDiff.map((c) => (
            <CaseCard
              key={c.dir}
              entry={c}
              result={results.get(c.dir)}
              showGroup
            />
          ))}
        </div>
      ) : (
        groups.map((g) => {
          const scored = g.cases.flatMap((c) => results.get(c.dir) ?? []);
          const community = sourceOf(index, g.cases[0]).community;
          return (
            <section key={g.key} className="space-y-3">
              <div className="space-y-1">
                <h2 className="flex flex-wrap items-baseline gap-x-3 text-lg font-medium">
                  {g.label}
                  <span className="text-sm font-normal text-muted-foreground tabular-nums">
                    {g.cases.length} 个
                    {scored.length > 0 &&
                      ` · 平均差异 ${formatDiff(average(scored))}`}
                  </span>
                  {community && (
                    <a
                      href={community}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-normal underline-offset-4 hover:underline"
                    >
                      社区原稿 ↗
                    </a>
                  )}
                </h2>
                {g.note && (
                  <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
                    {g.note}
                  </p>
                )}
              </div>
              <div className={gridClass}>
                {g.cases.map((c) => (
                  <CaseCard key={c.dir} entry={c} result={results.get(c.dir)} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}
