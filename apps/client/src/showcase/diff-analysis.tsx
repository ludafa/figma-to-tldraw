import { cn } from '@/lib/utils';

import type { DiffKind, DiffNode } from '../figma/diff-attribution';
import type { RenderArea } from '../figma/render-area';
import type { FidelityResult } from '../figma/report';
import { formatDiff, ToneDot, verdictOf } from './score';

// See apps/docs/figma-to-tldraw/tech.md §10.2.

const KINDS: { kind: DiffKind; label: string; swatch: string }[] = [
  { kind: 'text', label: '文字', swatch: 'bg-series-1' },
  { kind: 'image', label: '图片', swatch: 'bg-series-2' },
  { kind: 'vector', label: '图标和矢量', swatch: 'bg-series-3' },
  { kind: 'shape', label: '背景和形状', swatch: 'bg-series-4' },
];

const KIND_OF = Object.fromEntries(KINDS.map((k) => [k.kind, k])) as Record<
  DiffKind,
  (typeof KINDS)[number]
>;

function percent(part: number, whole: number): string {
  const value = whole > 0 ? Math.round((part / whole) * 100) : 0;
  return value === 0 && part > 0 ? '<1%' : `${value}%`;
}

function Breakdown({
  byKind,
  nodes,
  hint,
  onHighlight,
  onPick,
}: {
  byKind: Record<DiffKind, number>;
  nodes: DiffNode[];
  hint: string;
  onHighlight: (box: RenderArea | null) => void;
  onPick?: (node: DiffNode) => void;
}) {
  const total = KINDS.reduce((s, k) => s + byKind[k.kind], 0);
  const kinds = KINDS.filter((k) => byKind[k.kind] > 0);
  const top = [...kinds].sort((a, b) => byKind[b.kind] - byKind[a.kind])[0];
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium">差异出在哪</h3>
      {top && (
        <p className="text-sm">
          最多的是{top.label}，占 {percent(byKind[top.kind], total)}。
        </p>
      )}
      <div
        className="flex h-3 gap-[2px]"
        role="img"
        aria-label="差异按节点种类"
      >
        {kinds.map((k) => (
          <div
            key={k.kind}
            title={`${k.label} ${percent(byKind[k.kind], total)}`}
            className={cn('rounded-[3px]', k.swatch)}
            style={{ flexGrow: byKind[k.kind], flexBasis: 0, minWidth: 3 }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {kinds.map((k) => (
          <li key={k.kind} className="flex items-center gap-1.5">
            <span className={cn('size-2.5 rounded-[2px]', k.swatch)} />
            {k.label}
            <span className="text-muted-foreground tabular-nums">
              {percent(byKind[k.kind], total)}
            </span>
          </li>
        ))}
      </ul>
      <div className="space-y-1">
        <p className="text-xs text-muted-foreground">{hint}</p>
        <ul className="divide-y rounded-md border text-sm">
          {nodes.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                onClick={() => onPick?.(n)}
                onMouseEnter={() => onHighlight(n.box)}
                onMouseLeave={() => onHighlight(null)}
                onFocus={() => onHighlight(n.box)}
                onBlur={() => onHighlight(null)}
              >
                <span
                  className={cn(
                    'size-2.5 shrink-0 rounded-[2px]',
                    KIND_OF[n.kind].swatch,
                  )}
                />
                <span className="min-w-0 flex-1 truncate">
                  {n.text ? `「${n.text}」` : n.name}
                  <span className="ml-2 text-xs text-muted-foreground">
                    {n.font ?? n.type}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {percent(n.pixels, total)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function DiffAnalysis({
  result,
  totalPixels,
  notes,
  hint = '差异最多的节点（鼠标移上去，左边的图上会框出它的位置）',
  method = 'Figma 导出的 2 倍图和 tldraw 的 2 倍截图逐像素比，pixelmatch 阈值 0.1',
  onHighlight,
  onPick,
}: {
  result?: FidelityResult;
  totalPixels: number;
  notes: string[];
  hint?: string;
  method?: string;
  onHighlight: (box: RenderArea | null) => void;
  onPick?: (node: DiffNode) => void;
}) {
  if (!result) {
    return (
      <section className="space-y-2 rounded-lg border p-4 text-sm">
        <h2 className="font-medium">差异分析</h2>
        <p className="text-muted-foreground">
          最新的对比报告里没有这个用例。先运行{' '}
          <code>pnpm --filter @figma-to-tldraw/client compare</code>。
        </p>
      </section>
    );
  }
  const verdict = verdictOf(result);
  const total =
    result.diff > 0
      ? Math.round((result.diffPixels * 100) / result.diff)
      : totalPixels;
  return (
    <section className="space-y-5 rounded-lg border p-4">
      <div className="space-y-1">
        <h2 className="text-sm font-medium">差异分析</h2>
        <div className="flex items-baseline gap-3">
          <span className="text-4xl font-semibold tracking-tight tabular-nums">
            {formatDiff(result.diff)}
          </span>
          <span className="inline-flex items-center gap-1.5 text-sm">
            <ToneDot tone={verdict.tone} />
            {verdict.label}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          不同的像素 {result.diffPixels.toLocaleString()} /{' '}
          {total.toLocaleString()}：{method}
        </p>
      </div>
      {result.error && (
        <p className="text-sm break-words text-destructive">{result.error}</p>
      )}
      {result.breakdown && result.diffPixels > 0 && (
        <Breakdown
          byKind={result.breakdown.byKind}
          nodes={result.breakdown.nodes}
          hint={hint}
          onHighlight={onHighlight}
          onPick={onPick}
        />
      )}
      {result.warnings.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-sm font-medium">警告</h3>
          <ul className="space-y-1 text-sm">
            {result.warnings.map((w) => (
              <li key={w} className="flex items-start gap-2">
                <span aria-hidden className="text-status-warning">
                  ⚠
                </span>
                {w}
              </li>
            ))}
          </ul>
        </div>
      )}
      {notes.length > 0 && (
        <div className="space-y-1">
          <h3 className="text-sm font-medium">说明</h3>
          {notes.map((n) => (
            <p
              key={n}
              className="text-sm leading-relaxed text-muted-foreground"
            >
              {n}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
