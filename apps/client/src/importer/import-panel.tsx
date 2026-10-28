import { Link } from '@tanstack/react-router';
import { ChevronRight, Download, RotateCw, Trash2, Upload } from 'lucide-react';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { DiffNode } from '../figma/diff-attribution';
import type { RenderArea } from '../figma/render-area';
import { DiffAnalysis } from '../showcase/diff-analysis';
import { formatDiff, Score } from '../showcase/score';
import type { ImportedCase, ImportRecord } from './store';

// See apps/docs/figma-to-tldraw/tech.md §19.1.

export type OverlayMode = 'off' | 'half' | 'diff' | 'pixels';

const OVERLAY_MODES: { mode: OverlayMode; label: string }[] = [
  { mode: 'off', label: '不叠加' },
  { mode: 'half', label: '半透明' },
  { mode: 'diff', label: '差异' },
  { mode: 'pixels', label: '差异图' },
];

export type DownloadKind = 'tldraw' | 'diff' | 'figma' | 'tldr';

const DOWNLOADS: { kind: DownloadKind; label: string; needsResult: boolean }[] =
  [
    { kind: 'tldraw', label: 'tldraw 渲染图', needsResult: true },
    { kind: 'diff', label: '差异图', needsResult: true },
    { kind: 'figma', label: 'Figma 渲染图', needsResult: false },
    { kind: 'tldr', label: '.tldr 文件', needsResult: false },
  ];

export interface Progress {
  text: string;
  done: number;
  total: number;
}

export function fontWarning(fonts: string[]): string {
  return `用到了不在开源字体清单里的字体：${fonts.join('、')}。这些多半是商业字体，网页里没有，会用 Inter 等字体代替，文字的还原度会明显变差。`;
}

export function closedFontsOf(record: ImportRecord): string[] {
  return [...new Set(record.cases.flatMap((c) => c.closedFonts))];
}

function average(record: ImportRecord): number | null {
  const done = record.cases.filter((c) => c.result && !c.result.error);
  return done.length
    ? done.reduce((s, c) => s + (c.result?.diff ?? 0), 0) / done.length
    : null;
}

function Warning({ children }: { children: string }) {
  return (
    <p className="flex gap-1.5 rounded-md bg-status-warning/10 px-2 py-1.5 text-xs leading-relaxed">
      <span aria-hidden className="text-status-warning">
        ⚠
      </span>
      <span>{children}</span>
    </p>
  );
}

export function ImportButton({
  busy,
  onFiles,
}: {
  busy: boolean;
  onFiles: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-1.5">
      <input
        ref={input}
        type="file"
        accept=".zip,application/zip"
        multiple
        hidden
        onChange={(e) => {
          onFiles([...(e.target.files ?? [])]);
          e.target.value = '';
        }}
      />
      <Button
        className="w-full"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        <Upload />
        导入 Figma 插件导出的 zip
      </Button>
      <p className="text-xs text-muted-foreground">
        也可以把 zip
        拖到页面上。导入后在浏览器里逐个截图对比，数据只存在这台电脑的浏览器里。
      </p>
    </div>
  );
}

export function ProgressBar({ progress }: { progress: Progress }) {
  return (
    <div className="space-y-1" role="status">
      <div className="flex justify-between gap-2 text-xs">
        <span className="truncate">{progress.text}</span>
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {progress.done} / {progress.total}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width]"
          style={{
            width: `${(progress.done / Math.max(1, progress.total)) * 100}%`,
          }}
        />
      </div>
    </div>
  );
}

export function ImportList({
  records,
  selectedId,
  selectedDir,
  busy,
  onSelect,
  onDelete,
  onAnalyze,
}: {
  records: ImportRecord[];
  selectedId?: string;
  selectedDir?: string;
  busy: boolean;
  onSelect: (id: string, dir: string) => void;
  onDelete: (record: ImportRecord) => void;
  onAnalyze: (record: ImportRecord) => void;
}) {
  const [closed, setClosed] = useState<Set<string>>(() => new Set());
  if (!records.length) {
    return (
      <p className="text-xs text-muted-foreground">
        还没有导入过。在 Figma 里运行插件「Fidelity Test
        Cases」，点「导出测试数据」得到 zip。
      </p>
    );
  }
  return (
    <ul className="space-y-2">
      {records.map((r) => {
        const open = !closed.has(r.id);
        const avg = average(r);
        const pending = r.cases.filter((c) => !c.result).length;
        const fonts = closedFontsOf(r);
        return (
          <li key={r.id} className="rounded-md border">
            <div className="flex items-start gap-1 px-2 py-1.5">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-start gap-1 text-left"
                aria-expanded={open}
                onClick={() => {
                  const next = new Set(closed);
                  if (open) {
                    next.add(r.id);
                  } else {
                    next.delete(r.id);
                  }
                  setClosed(next);
                }}
              >
                <ChevronRight
                  className={cn(
                    'mt-0.5 size-3.5 shrink-0 transition-transform',
                    open && 'rotate-90',
                  )}
                />
                <span className="min-w-0">
                  <span className="block truncate font-medium">
                    {r.figmaFile || r.fileName}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {r.page ? `${r.page} · ` : ''}
                    {r.cases.length} 个 ·{' '}
                    {new Date(r.importedAt).toLocaleString()}
                  </span>
                  <span className="block text-xs tabular-nums">
                    {avg === null ? '还没有分数' : `平均 ${formatDiff(avg)}`}
                    {pending > 0 && (
                      <span className="text-muted-foreground">
                        {' '}
                        · {pending} 个没比
                      </span>
                    )}
                  </span>
                </span>
              </button>
              <Button
                variant="ghost"
                size="icon-xs"
                title="删除这次导入"
                aria-label="删除这次导入"
                disabled={busy}
                onClick={() => onDelete(r)}
              >
                <Trash2 />
              </Button>
            </div>
            {open && (
              <div className="space-y-1.5 border-t px-1 py-1.5">
                {fonts.length > 0 && (
                  <div className="px-1">
                    <Warning>{fontWarning(fonts)}</Warning>
                  </div>
                )}
                {r.errors.length > 0 && (
                  <p className="px-2 text-xs text-destructive">
                    插件导出时失败 {r.errors.length} 个：
                    {r.errors.map((e) => e.name).join('、')}
                  </p>
                )}
                {pending > 0 && !busy && (
                  <Button
                    variant="outline"
                    size="xs"
                    className="mx-1"
                    onClick={() => onAnalyze(r)}
                  >
                    <RotateCw />
                    对比剩下的 {pending} 个
                  </Button>
                )}
                <ul>
                  {r.cases.map((c) => (
                    <li key={c.dir}>
                      <button
                        type="button"
                        onClick={() => onSelect(r.id, c.dir)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-muted',
                          r.id === selectedId &&
                            c.dir === selectedDir &&
                            'bg-muted font-medium',
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          {c.name}
                        </span>
                        {c.closedFonts.length > 0 && (
                          <span
                            className="text-status-warning"
                            title={fontWarning(c.closedFonts)}
                          >
                            ⚠
                          </span>
                        )}
                        {c.result ? (
                          <Score result={c.result} />
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            没比
                          </span>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const NOTE =
  '分数是在浏览器里算的：把画布按 2 倍直接导出像素，和 Figma 导出的 2 倍图逐像素比。用的是和画布同一套 Skia 画法，和本地对比脚本（Playwright 截图）的分数基本一致。';

export function CaseReport({
  c,
  analyzing,
  hasOutputs,
  mode,
  onMode,
  onHighlight,
  onPick,
  onDownload,
  onAnalyze,
}: {
  c: ImportedCase;
  analyzing: boolean;
  hasOutputs: boolean;
  mode: OverlayMode;
  onMode: (mode: OverlayMode) => void;
  onHighlight: (box: RenderArea | null) => void;
  onPick: (node: DiffNode) => void;
  onDownload: (kind: DownloadKind) => void;
  onAnalyze: () => void;
}) {
  const notes = [
    ...(c.closedFonts.length ? [fontWarning(c.closedFonts)] : []),
    NOTE,
  ];
  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="min-w-0 truncate font-medium" title={c.dir}>
          {c.name}
        </h2>
        <Button
          variant="ghost"
          size="xs"
          disabled={analyzing}
          onClick={onAnalyze}
        >
          <RotateCw />
          重新对比
        </Button>
      </div>
      <div className="flex flex-wrap gap-1" role="group" aria-label="叠加方式">
        {OVERLAY_MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            disabled={m.mode === 'pixels' && !hasOutputs}
            onClick={() => onMode(m.mode)}
            aria-pressed={mode === m.mode}
            className={cn(
              'rounded-md border px-2 py-0.5 text-xs hover:bg-muted disabled:opacity-50',
              mode === m.mode && 'bg-muted font-medium',
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {DOWNLOADS.map((d) => (
          <Button
            key={d.kind}
            variant="outline"
            size="xs"
            disabled={d.needsResult && !hasOutputs}
            onClick={() => onDownload(d.kind)}
          >
            <Download />
            {d.label}
          </Button>
        ))}
      </div>
      {analyzing && !c.result && (
        <p className="text-xs text-muted-foreground">正在截图对比…</p>
      )}
      {!analyzing && !c.result && (
        <p className="text-xs text-muted-foreground">
          还没对比。点「重新对比」开始。
        </p>
      )}
      {c.result && (
        <DiffAnalysis
          result={c.result}
          totalPixels={Math.round(c.width * 2) * Math.round(c.height * 2)}
          notes={notes}
          hint="差异最多的节点（鼠标移上去，画布上会框出它；点一下选中它）"
          method={`Figma 导出的 2 倍图和画布导出的 2 倍图逐像素比，pixelmatch 阈值 0.1，用时 ${(c.result.ms / 1000).toFixed(1)} 秒`}
          onHighlight={onHighlight}
          onPick={onPick}
        />
      )}
    </section>
  );
}

export function PanelHeader() {
  return (
    <header className="space-y-1">
      <nav className="flex gap-3 text-xs text-muted-foreground">
        <Link to="/showcase" className="hover:text-foreground">
          展示页
        </Link>
        <Link to="/report" className="hover:text-foreground">
          汇报
        </Link>
        <Link to="/how-it-works" className="hover:text-foreground">
          核心思路
        </Link>
        <Link to="/canvas" className="hover:text-foreground">
          画布
        </Link>
      </nav>
      <h1 className="text-base font-semibold">导入和对比</h1>
    </header>
  );
}
