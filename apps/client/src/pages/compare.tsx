import { getRouteApi, Link, useNavigate } from '@tanstack/react-router';
import { Maximize, RotateCw, Trash2, Upload } from 'lucide-react';
import {
  type DragEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import type { Editor } from '../engine';
import type { DiffNode } from '../figma/diff-attribution';
import { type RenderArea, renderArea } from '../figma/render-area';
import type { Snapshot } from '../figma/types';
import {
  CompareCanvas,
  MirrorPane,
  usePyramid,
  zoomToBox,
} from '../importer/compare-view';
import {
  BROWSER_NOTE,
  diffMethod,
  fontWarning,
  ImportButton,
  ProgressBar,
} from '../importer/import-panel';
import { ShotStageHost } from '../importer/shot-stage';
import { getOutputs, getZip } from '../importer/store';
import { jobKey, message, useImports } from '../importer/use-imports';
import { readZipCase, withBlobUrls } from '../importer/zip';
import { DiffAnalysis } from '../showcase/diff-analysis';
import { formatDiff, Score } from '../showcase/score';

// See apps/docs/figma-to-tldraw/tech.md §20.

const route = getRouteApi('/compare');

type DiffMode = 'pixels' | 'subtract';

const DIFF_MODES: { mode: DiffMode; label: string; hint: string }[] = [
  {
    mode: 'pixels',
    label: '差异图',
    hint: '红色：不一样的像素；黄色：抗锯齿的细小差别，不计入',
  },
  {
    mode: 'subtract',
    label: '相减',
    hint: '两张图相减再提亮 4 倍：一样的地方是黑的，越亮差得越多',
  },
];

interface View {
  key: string;
  dir: string;
  snapshot: Snapshot;
  expected: Blob;
  area: RenderArea;
}

interface Outputs {
  key: string;
  diff: Blob;
  actual: Blob;
}

const selectClass =
  'h-8 min-w-0 max-w-64 truncate rounded-md border bg-background px-2 text-sm';

function Pane({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-card">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b px-3 text-sm">
        <h2 className="shrink-0 font-medium">{title}</h2>
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {hint}
        </span>
        {action}
      </header>
      <div className="relative min-h-0 flex-1">{children}</div>
    </section>
  );
}

function Placeholder({ children }: { children: ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function PickZip({ onFiles }: { onFiles: (files: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
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
      <Button size="sm" onClick={() => input.current?.click()}>
        <Upload />
        导入 zip
      </Button>
    </>
  );
}

function EmptyState({ onFiles }: { onFiles: (files: File[]) => void }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4 rounded-xl border border-dashed p-6">
        <h2 className="text-lg font-semibold">导入一个 Figma section</h2>
        <ol className="list-decimal space-y-1 pl-5 text-sm leading-relaxed text-muted-foreground">
          <li>在 Figma 里选中一个 section（frame 也行，可以多选）。</li>
          <li>
            运行插件「Fidelity Test Cases」，点「导出测试数据」，得到一个 zip。
          </li>
          <li>把 zip 拖到这个页面上，或者点下面的按钮。</li>
        </ol>
        <ImportButton busy={false} onFiles={onFiles} />
      </div>
    </div>
  );
}

export function ComparePage() {
  const search = route.useSearch();
  const navigate = useNavigate({ from: '/compare' });
  const imports = useImports();
  const { records, progress, analyzing, notices, enqueue, isQueued } = imports;
  const [editor, setEditor] = useState<Editor | null>(null);
  const [view, setView] = useState<View | null>(null);
  const [loadError, setLoadError] = useState<{
    key: string;
    text: string;
  } | null>(null);
  const [outputs, setOutputs] = useState<Outputs | null>(null);
  const [highlight, setHighlight] = useState<RenderArea | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [diffMode, setDiffMode] = useState<DiffMode>('pixels');
  const [dragging, setDragging] = useState(false);

  const record = records?.find((r) => r.id === search.id);
  const selected = record?.cases.find((c) => c.dir === search.case);
  const job =
    search.id && search.case ? { id: search.id, dir: search.case } : null;
  const selectedKey = job ? jobKey(job) : '';
  const result = selected?.result;

  // See apps/docs/figma-to-tldraw/tech.md §19.1.
  useEffect(() => {
    if (!records?.length || (search.id && record)) {
      return;
    }
    const first = records[0];
    void navigate({
      search: { id: first.id, case: first.cases[0]?.dir },
      replace: true,
    });
  }, [records, record, search.id, navigate]);

  useEffect(() => {
    const { id, case: dir } = search;
    if (!id || !dir) {
      return;
    }
    let cancelled = false;
    let revoke: (() => void) | undefined;
    (async () => {
      const zip = await getZip(id);
      if (!zip) {
        throw new Error('浏览器里找不到这次导入的 zip');
      }
      const files = await readZipCase(zip, dir);
      if (cancelled) {
        return;
      }
      const assets = withBlobUrls(files);
      revoke = assets.revoke;
      setView({
        key: jobKey({ id, dir }),
        dir,
        snapshot: assets.snapshot,
        expected: files.expected,
        area: renderArea(assets.snapshot),
      });
    })().catch((e: unknown) => {
      if (!cancelled) {
        setLoadError({ key: jobKey({ id, dir }), text: message(e) });
      }
    });
    return () => {
      cancelled = true;
      setHighlight(null);
      revoke?.();
    };
  }, [search]);

  const analyzedAt = result?.analyzedAt;
  useEffect(() => {
    const { id, case: dir } = search;
    if (!id || !dir || !analyzedAt) {
      return;
    }
    let cancelled = false;
    getOutputs(id, dir)
      .then((o) => {
        if (!cancelled && o) {
          setOutputs({ key: jobKey({ id, dir }), ...o });
        }
      })
      .catch((e: unknown) => console.warn(e));
    return () => {
      cancelled = true;
      setOutputs(null);
    };
  }, [search, analyzedAt]);

  // See apps/docs/figma-to-tldraw/tech.md §20.1.
  useEffect(() => {
    if (job && selected && !selected.result && !isQueued(job)) {
      enqueue([job]);
    }
  });

  async function importFiles(files: File[]) {
    const first = await imports.importFiles(files);
    if (first) {
      void navigate({ search: { id: first.id, case: first.cases[0].dir } });
    }
  }

  async function onDelete() {
    if (record && (await imports.remove(record))) {
      setView(null);
      void navigate({ search: {}, replace: true });
    }
  }

  function onPick(node: DiffNode) {
    if (editor && view) {
      zoomToBox(editor, view.area, node.box);
    }
  }

  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');
  const current = view?.key === selectedKey ? view : null;
  const shown = outputs?.key === selectedKey ? outputs : null;
  const busy = job !== null && analyzing === selectedKey;
  const mode = DIFF_MODES.find((m) => m.mode === diffMode) ?? DIFF_MODES[0];
  const expected = usePyramid(current?.expected ?? null);
  const diffImage = usePyramid(shown?.diff ?? null);
  const actual = usePyramid(
    diffMode === 'subtract' ? (shown?.actual ?? null) : null,
  );
  const shotLayers = useMemo(() => (expected ? [expected] : []), [expected]);
  const diffLayers = useMemo(() => {
    const layers = diffMode === 'pixels' ? [diffImage] : [actual, expected];
    return layers.every((p) => p !== null) ? layers : [];
  }, [diffMode, diffImage, actual, expected]);

  return (
    <div
      className="flex h-dvh flex-col bg-background"
      onDragOverCapture={(e) => {
        if (hasFiles(e)) {
          e.preventDefault();
          e.stopPropagation();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setDragging(false);
        }
      }}
      onDropCapture={(e) => {
        if (hasFiles(e)) {
          e.preventDefault();
          e.stopPropagation();
          setDragging(false);
          void importFiles([...e.dataTransfer.files]);
        }
      }}
    >
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b px-4 py-2">
        <Link
          to="/showcase"
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          ← 展示页
        </Link>
        <h1 className="text-base font-semibold">导入对比</h1>
        {records && records.length > 0 && (
          <select
            aria-label="导入记录"
            className={selectClass}
            value={search.id ?? ''}
            onChange={(e) => {
              const r = records.find((x) => x.id === e.target.value);
              if (r) {
                void navigate({ search: { id: r.id, case: r.cases[0]?.dir } });
              }
            }}
          >
            {records.map((r) => (
              <option key={r.id} value={r.id}>
                {r.figmaFile || r.fileName}
                {r.page ? ` · ${r.page}` : ''} ·{' '}
                {new Date(r.importedAt).toLocaleString()}
              </option>
            ))}
          </select>
        )}
        {record && record.cases.length > 1 && (
          <select
            aria-label="画板"
            className={selectClass}
            value={search.case ?? ''}
            onChange={(e) =>
              void navigate({
                search: { id: record.id, case: e.target.value },
              })
            }
          >
            {record.cases.map((c) => (
              <option key={c.dir} value={c.dir}>
                {c.name}
                {c.result
                  ? ` · ${c.result.error ? '出错' : formatDiff(c.result.diff)}`
                  : ''}
              </option>
            ))}
          </select>
        )}
        {selected && (
          <span className="text-sm text-muted-foreground tabular-nums">
            {selected.width}×{selected.height}
          </span>
        )}
        {result && <Score result={result} withLabel />}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {job && selected && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => enqueue([job])}
            >
              <RotateCw />
              重新对比
            </Button>
          )}
          {job && (
            <Link
              to="/import"
              search={{ id: job.id, case: job.dir }}
              className={buttonVariants({ variant: 'outline', size: 'sm' })}
            >
              在编辑页打开
            </Link>
          )}
          {record && (
            <Button
              variant="ghost"
              size="icon-sm"
              title="删除这次导入"
              aria-label="删除这次导入"
              disabled={progress !== null}
              onClick={() => void onDelete()}
            >
              <Trash2 />
            </Button>
          )}
          <PickZip onFiles={(files) => void importFiles(files)} />
        </div>
      </header>
      {(progress || notices.length > 0 || !imports.persistent) && (
        <div className="shrink-0 space-y-1 border-b px-4 py-2 text-xs">
          {progress && (
            <div className="max-w-md">
              <ProgressBar progress={progress} />
            </div>
          )}
          {notices.map((n) => (
            <p
              key={n.text}
              className={n.error ? 'text-status-critical' : undefined}
            >
              {n.text}
            </p>
          ))}
          {!imports.persistent && (
            <p className="text-status-warning">
              这个浏览器窗口存不了数据（比如无痕模式），刷新页面后导入的内容会丢。
            </p>
          )}
        </div>
      )}

      {records && !records.length ? (
        <EmptyState onFiles={(files) => void importFiles(files)} />
      ) : (
        <main className="grid min-h-0 flex-1 auto-rows-[70vh] gap-3 overflow-y-auto p-3 lg:grid-cols-2 lg:grid-rows-2 lg:overflow-hidden">
          <Pane
            title="我们的画布"
            hint="Skia 画布：拖动平移，滚轮上下移，⌘ + 滚轮或双指缩放；四块一起动"
            action={
              <Button
                variant="ghost"
                size="xs"
                disabled={!current}
                onClick={() => setResetKey((k) => k + 1)}
              >
                <Maximize />
                复位
              </Button>
            }
          >
            {view && (
              <CompareCanvas
                dir={view.dir}
                snapshot={view.snapshot}
                area={view.area}
                highlight={highlight}
                resetKey={resetKey}
                onEditor={setEditor}
              />
            )}
            {!current && (
              <Placeholder>
                {loadError?.key === selectedKey
                  ? `打不开这个画板：${loadError.text}`
                  : '读取画板……'}
              </Placeholder>
            )}
          </Pane>
          <Pane title="Figma 截图" hint="zip 里 Figma 自己导出的 2 倍图">
            {current && (
              <MirrorPane
                editor={editor}
                area={current.area}
                highlight={highlight}
                layers={shotLayers}
              />
            )}
          </Pane>
          <Pane
            title="差异"
            hint={mode.hint}
            action={
              <div
                className="flex shrink-0 gap-0.5 rounded-md border p-0.5"
                role="group"
                aria-label="差异的显示方式"
              >
                {DIFF_MODES.map((m) => (
                  <button
                    key={m.mode}
                    type="button"
                    aria-pressed={diffMode === m.mode}
                    onClick={() => setDiffMode(m.mode)}
                    className={cn(
                      'rounded px-1.5 py-0.5 text-xs hover:bg-muted',
                      diffMode === m.mode && 'bg-muted font-medium',
                    )}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            }
          >
            {current && shown && (
              <MirrorPane
                editor={editor}
                area={current.area}
                highlight={highlight}
                layers={diffLayers}
                brighten={diffMode === 'subtract' ? 4 : undefined}
              />
            )}
            {current && !shown && (
              <Placeholder>
                {result?.error
                  ? '对比出错，没有差异图'
                  : busy || (job && isQueued(job))
                    ? '正在截图对比……'
                    : '还没对比'}
              </Placeholder>
            )}
          </Pane>
          <div className="min-h-0 min-w-0 overflow-y-auto">
            {selected && result ? (
              <DiffAnalysis
                result={result}
                totalPixels={
                  Math.round(selected.width * 2) *
                  Math.round(selected.height * 2)
                }
                notes={[
                  ...(selected.closedFonts.length
                    ? [fontWarning(selected.closedFonts)]
                    : []),
                  BROWSER_NOTE,
                ]}
                hint="差异最多的节点（鼠标移上去，三块图上都会框出它；点一下，四块一起放大到它）"
                method={diffMethod(result.ms)}
                onHighlight={setHighlight}
                onPick={onPick}
              />
            ) : (
              <section className="space-y-2 rounded-lg border p-4 text-sm">
                <h2 className="font-medium">差异分析</h2>
                <p className="text-muted-foreground">
                  {selected
                    ? '正在截图对比，比完这里显示差异百分比和差异出在哪些节点。'
                    : '选一个画板。'}
                </p>
              </section>
            )}
          </div>
        </main>
      )}

      {dragging && (
        <div className="pointer-events-none fixed inset-2 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/80 text-base font-medium">
          松开鼠标导入 zip
        </div>
      )}
      <ShotStageHost onReady={imports.onStageReady} />
    </div>
  );
}
