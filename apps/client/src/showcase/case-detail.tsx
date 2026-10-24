import { Link } from '@tanstack/react-router';
import { type ReactNode, type Ref, useEffect, useMemo, useState } from 'react';

import { buttonVariants } from '@/components/ui/button';

import { caseUrl, loadCase } from '../figma/load';
import { type RenderArea, renderArea } from '../figma/render-area';
import { type FidelityResult, reportUrl } from '../figma/report';
import type { CaseIndex, CaseSummary, Snapshot } from '../figma/types';
import { CaseCanvas } from './case-canvas';
import { DiffAnalysis } from './diff-analysis';
import { caseName, type CaseGroup, notesFor } from './groups';
import { Score } from './score';
import { sourceOf } from './sources';
import { useFitScale } from './use-fit-scale';

// See apps/docs/figma-to-tldraw/tech.md §10.

const PAD = 24;

function Pane({
  title,
  hint,
  action,
  width,
  height,
  measureRef,
  children,
}: {
  title: string;
  hint: string;
  action?: ReactNode;
  width: number;
  height: number;
  measureRef?: Ref<HTMLElement>;
  children: ReactNode;
}) {
  return (
    <figure ref={measureRef} className="min-w-0 space-y-2">
      <figcaption className="flex items-baseline gap-2 text-sm">
        <span className="font-medium">{title}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {hint}
        </span>
        {action}
      </figcaption>
      <div
        className="relative mx-auto overflow-hidden rounded-md border bg-white"
        style={{ width, height }}
      >
        {children}
      </div>
    </figure>
  );
}

function Highlight({ box, scale }: { box: RenderArea | null; scale: number }) {
  if (!box) {
    return null;
  }
  return (
    <div
      className="pointer-events-none absolute rounded-[2px] border-2 border-series-1 bg-series-1/10"
      style={{
        left: PAD + box.x * scale - 2,
        top: PAD + box.y * scale - 2,
        width: box.width * scale + 4,
        height: box.height * scale + 4,
      }}
    />
  );
}

function PaneImage({ src }: { src: string }) {
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      className="absolute max-w-none"
      style={{
        left: PAD,
        top: PAD,
        width: `calc(100% - ${PAD * 2}px)`,
        height: `calc(100% - ${PAD * 2}px)`,
      }}
    />
  );
}

const linkButton = buttonVariants({ variant: 'outline', size: 'sm' });

export function CaseDetail({
  index,
  group,
  entry,
  result,
  prev,
  next,
}: {
  index: CaseIndex;
  group: CaseGroup;
  entry: CaseSummary;
  result?: FidelityResult;
  prev?: CaseSummary;
  next?: CaseSummary;
}) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<RenderArea | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const area = useMemo(() => snapshot && renderArea(snapshot), [snapshot]);
  const { measureRef, scale } = useFitScale(area, PAD);
  const source = sourceOf(index, entry);

  useEffect(() => {
    let cancelled = false;
    loadCase(entry.dir)
      .then((s) => !cancelled && setSnapshot(s))
      .catch((e: unknown) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [entry.dir]);

  const width = area ? area.width * scale + PAD * 2 : 0;
  const height = area ? area.height * scale + PAD * 2 : 0;

  return (
    <div className="mx-auto max-w-[1600px] space-y-6 px-6 py-6">
      <nav className="flex flex-wrap items-center gap-2 text-sm">
        <Link
          to="/showcase"
          className="text-muted-foreground hover:text-foreground"
        >
          ← 全部用例
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="truncate text-muted-foreground">{group.label}</span>
        <div className="ml-auto flex gap-2">
          {prev && (
            <Link
              to="/showcase"
              search={{ case: prev.dir }}
              className={linkButton}
              title="键盘 ←"
            >
              ← 上一个
            </Link>
          )}
          {next && (
            <Link
              to="/showcase"
              search={{ case: next.dir }}
              className={linkButton}
              title="键盘 →"
            >
              下一个 →
            </Link>
          )}
        </div>
      </nav>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="flex items-center gap-3 text-2xl font-semibold tracking-tight">
            <span className="truncate">{caseName(entry.dir)}</span>
            <Score result={result} withLabel />
          </h1>
          <p className="text-sm text-muted-foreground">
            Figma 文件「{source.file}」· 页面「{source.page}」· 节点{' '}
            {entry.nodeId} · {entry.width}×{entry.height}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {source.nodeUrl && (
            <a
              href={source.nodeUrl}
              target="_blank"
              rel="noreferrer"
              className={buttonVariants({ size: 'sm' })}
              title={
                source.community
                  ? '打开你草稿里的副本，定位到这个节点'
                  : '打开 Figma 文件，定位到这个节点'
              }
            >
              在 Figma 里打开 ↗
            </a>
          )}
          {source.community && (
            <a
              href={source.community}
              target="_blank"
              rel="noreferrer"
              className={linkButton}
            >
              社区原稿 ↗
            </a>
          )}
          <Link
            to="/canvas"
            search={{ case: entry.dir }}
            className={linkButton}
          >
            在调试页打开
          </Link>
        </div>
      </header>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {!snapshot && !error && (
        <p className="text-sm text-muted-foreground">读取用例……</p>
      )}

      {snapshot && area && (
        <div className="grid gap-x-6 gap-y-8 lg:grid-cols-2">
          <Pane
            title="Figma 截图"
            hint="Figma 自己导出的 2 倍图"
            width={width}
            height={height}
            measureRef={measureRef}
          >
            <PaneImage src={caseUrl(entry.dir, 'expected@2x.png')} />
            <Highlight box={highlight} scale={scale} />
          </Pane>
          <Pane
            title="tldraw 画布"
            hint="真的 tldraw 编辑器：拖动平移，双指或 ⌘ + 滚轮缩放"
            width={width}
            height={height}
            action={
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setResetKey((k) => k + 1)}
              >
                复位
              </button>
            }
          >
            {scale > 0 && (
              <CaseCanvas
                dir={entry.dir}
                snapshot={snapshot}
                area={area}
                scale={scale}
                pad={PAD}
                resetKey={resetKey}
              />
            )}
          </Pane>
          <Pane
            title="差异图"
            hint="红色：不一样的像素；黄色：抗锯齿的细小差别，不计入"
            width={width}
            height={height}
          >
            {result && !result.error && !result.sizeMismatch ? (
              <PaneImage src={reportUrl(entry.dir, 'diff.png')} />
            ) : (
              <p className="p-4 text-sm text-muted-foreground">没有差异图</p>
            )}
            <Highlight box={highlight} scale={scale} />
          </Pane>
          <DiffAnalysis
            result={result}
            totalPixels={
              Math.round(area.width * 2) * Math.round(area.height * 2)
            }
            notes={notesFor(entry.dir)}
            onHighlight={setHighlight}
          />
        </div>
      )}
    </div>
  );
}
