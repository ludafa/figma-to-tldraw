import 'tldraw/tldraw.css';
import '../figma/figma.css';

import { getRouteApi, useNavigate } from '@tanstack/react-router';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type DragEvent,
} from 'react';
import {
  type Editor,
  serializeTldrawJson,
  type TLComponents,
  Tldraw,
} from 'tldraw';

import type { DiffNode } from '../figma/diff-attribution';
import {
  figmaShapeVisibility,
  figmaTextOptions,
  FigmaToolbar,
  figmaTools,
  figmaUiOverrides,
  LayerTree,
  startFigmaEditing,
  withoutFigmaEffects,
} from '../figma/editing';
import { putSnapshot } from '../figma/editor';
import { closedFonts } from '../figma/fonts';
import { type RenderArea, renderArea } from '../figma/render-area';
import { figmaShapeUtils } from '../figma/shapes';
import { shapeIdFor } from '../figma/to-shapes';
import {
  CaseReport,
  closedFontsOf,
  type DownloadKind,
  fontWarning,
  ImportButton,
  ImportList,
  type OverlayMode,
  PanelHeader,
  type Progress,
  ProgressBar,
} from '../importer/import-panel';
import { InspectorPortal } from '../importer/inspector';
import { type ShotStage, ShotStageHost } from '../importer/shot-stage';
import {
  addImport,
  type CaseOutputs,
  deleteImport,
  getOutputs,
  getZip,
  type ImportedCase,
  type ImportRecord,
  isPersistent,
  listImports,
  saveImport,
  saveOutputs,
} from '../importer/store';
import { readZipCase, readZipIndex, withBlobUrls } from '../importer/zip';

// See apps/docs/figma-to-tldraw/tech.md §19.

const route = getRouteApi('/import');

interface Overlay {
  expectedUrl: string;
  diffUrl?: string;
  area: RenderArea;
  mode: OverlayMode;
  highlight: RenderArea | null;
}

const OverlayContext = createContext<Overlay | null>(null);

function CanvasOverlay() {
  const overlay = useContext(OverlayContext);
  if (!overlay) {
    return null;
  }
  const { area, mode, highlight } = overlay;
  const src = mode === 'pixels' ? overlay.diffUrl : overlay.expectedUrl;
  return (
    <>
      {mode !== 'off' && src && (
        <img
          src={src}
          alt=""
          draggable={false}
          style={{
            position: 'absolute',
            left: area.x,
            top: area.y,
            width: area.width,
            height: area.height,
            maxWidth: 'none',
            opacity: mode === 'half' ? 0.5 : 1,
            mixBlendMode: mode === 'diff' ? 'difference' : undefined,
            pointerEvents: 'none',
            zIndex: 1_000_000,
          }}
        />
      )}
      {highlight && (
        <div
          style={{
            position: 'absolute',
            left: area.x + highlight.x,
            top: area.y + highlight.y,
            width: highlight.width,
            height: highlight.height,
            outline: 'calc(2px / var(--tl-zoom)) solid #f43f5e',
            background: 'rgb(244 63 94 / 12%)',
            pointerEvents: 'none',
            zIndex: 1_000_001,
          }}
        />
      )}
    </>
  );
}

const components: TLComponents = {
  OnTheCanvas: CanvasOverlay,
  StylePanel: null,
  Toolbar: FigmaToolbar,
};

// See apps/docs/figma-to-tldraw/tech.md §14.1 and §16.3.
const options = {
  createTextOnCanvasDoubleClick: false,
  maxShapesPerPage: 100_000,
};

interface Loaded {
  id: string;
  dir: string;
  expectedUrl: string;
  area: RenderArea;
}

interface Notice {
  text: string;
  error?: boolean;
}

interface Job {
  id: string;
  dir: string;
}

const keyOf = (job: Job) => `${job.id}\n${job.dir}`;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function safeName(name: string): string {
  return (
    name.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'case'
  );
}

function saveBlob(blob: Blob, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 2000);
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// See apps/docs/figma-to-tldraw/tech.md §19.5.
async function tldrFile(editor: Editor): Promise<Blob> {
  let json = await serializeTldrawJson(editor);
  for (const url of new Set(json.match(/blob:[^"\\]+/g) ?? [])) {
    const data = await fetch(url)
      .then((res) => res.blob())
      .then(blobToDataUrl)
      .catch(() => url);
    json = json.split(url).join(data);
  }
  return new Blob([json], { type: 'application/json' });
}

function clearEditor(editor: Editor) {
  withoutFigmaEffects(editor, () =>
    editor.run(
      () => {
        const [first, ...others] = editor.getPages();
        editor.setCurrentPage(first.id);
        for (const page of others) {
          editor.deletePage(page.id);
        }
        editor.deleteShapes([...editor.getCurrentPageShapeIds()]);
      },
      { history: 'ignore' },
    ),
  );
  editor.clearHistory();
}

export function ImportPage() {
  const search = route.useSearch();
  const navigate = useNavigate({ from: '/import' });
  const [editor, setEditor] = useState<Editor | null>(null);
  const [records, setRecords] = useState<ImportRecord[] | null>(null);
  const recordsRef = useRef<ImportRecord[]>([]);
  const [persistent, setPersistent] = useState(true);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<{
    key: string;
    text: string;
  } | null>(null);
  const [outputs, setOutputs] = useState<
    (CaseOutputs & { diffUrl: string; key: string }) | null
  >(null);
  const [mode, setMode] = useState<OverlayMode>('off');
  const [highlight, setHighlight] = useState<RenderArea | null>(null);
  const [inspector, setInspector] = useState<HTMLElement | null>(null);
  const [dragging, setDragging] = useState(false);

  const stage = useRef<ShotStage | null>(null);
  const stageWaiters = useRef<((stage: ShotStage) => void)[]>([]);
  const queue = useRef(Promise.resolve());
  const counts = useRef({ done: 0, total: 0 });

  const record = records?.find((r) => r.id === search.id);
  const selected = record?.cases.find((c) => c.dir === search.case);

  const setAll = useCallback((next: ImportRecord[]) => {
    recordsRef.current = next;
    setRecords(next);
  }, []);

  useEffect(() => {
    listImports()
      .then(setAll)
      .catch((e: unknown) => {
        setAll([]);
        setNotices([
          { text: `读不出浏览器里存的导入记录：${message(e)}`, error: true },
        ]);
      });
    void isPersistent().then(setPersistent);
  }, [setAll]);

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

  const onStageReady = useCallback((s: ShotStage | null) => {
    stage.current = s;
    if (s) {
      for (const resolve of stageWaiters.current) {
        resolve(s);
      }
      stageWaiters.current = [];
    }
  }, []);

  const getStage = () =>
    stage.current
      ? Promise.resolve(stage.current)
      : new Promise<ShotStage>((resolve) => stageWaiters.current.push(resolve));

  function updateCase(id: string, dir: string, patch: Partial<ImportedCase>) {
    const next = recordsRef.current.map((r) =>
      r.id === id
        ? {
            ...r,
            cases: r.cases.map((c) => (c.dir === dir ? { ...c, ...patch } : c)),
          }
        : r,
    );
    setAll(next);
    const changed = next.find((r) => r.id === id);
    if (changed) {
      saveImport(changed).catch((e: unknown) => console.warn(e));
    }
  }

  async function analyzeOne(job: Job) {
    const rec = recordsRef.current.find((r) => r.id === job.id);
    const c = rec?.cases.find((x) => x.dir === job.dir);
    if (!rec || !c) {
      return;
    }
    setProgress({
      text: `截图对比：${c.name}`,
      done: counts.current.done,
      total: counts.current.total,
    });
    setAnalyzing(keyOf(job));
    const analyzedAt = new Date().toISOString();
    const base = {
      dir: c.dir,
      width: c.width,
      height: c.height,
      sizeMismatch: false,
      analyzedAt,
    };
    try {
      const zip = await getZip(job.id);
      if (!zip) {
        throw new Error('浏览器里找不到这次导入的 zip');
      }
      const files = await readZipCase(zip, job.dir);
      const assets = withBlobUrls(files);
      try {
        const shot = await (
          await getStage()
        ).analyze({
          idPrefix: job.dir,
          snapshot: assets.snapshot,
          expected: files.expected,
        });
        await saveOutputs(job.id, job.dir, {
          actual: shot.actual,
          diff: shot.diffImage,
        });
        updateCase(job.id, job.dir, {
          result: {
            ...base,
            diff: shot.diff,
            diffPixels: shot.diffPixels,
            warnings: shot.warnings,
            breakdown: shot.breakdown,
            ms: shot.ms,
          },
        });
      } finally {
        assets.revoke();
      }
    } catch (e) {
      console.error(e);
      updateCase(job.id, job.dir, {
        result: {
          ...base,
          diff: 100,
          diffPixels: 0,
          warnings: [],
          error: message(e),
          ms: 0,
        },
      });
    }
  }

  function enqueue(jobs: Job[]) {
    counts.current.total += jobs.length;
    for (const job of jobs) {
      queue.current = queue.current
        .then(() => analyzeOne(job))
        .catch((e: unknown) => console.error(e))
        .finally(() => {
          counts.current.done++;
          if (counts.current.done >= counts.current.total) {
            counts.current = { done: 0, total: 0 };
            setProgress(null);
            setAnalyzing(null);
          }
        });
    }
  }

  async function importFiles(files: File[]) {
    const fresh: Notice[] = [];
    let first: ImportRecord | null = null;
    for (const file of files) {
      if (!/\.zip$/i.test(file.name)) {
        fresh.push({ text: `${file.name} 不是 zip，跳过了`, error: true });
        continue;
      }
      try {
        const index = await readZipIndex(file);
        const rec: ImportRecord = {
          id: newId(),
          fileName: file.name,
          size: file.size,
          importedAt: new Date().toISOString(),
          figmaFile: index.figmaFile ?? '',
          page: (index.page ?? '').trim(),
          exportedAt: index.exportedAt ?? '',
          cases: (index.cases ?? []).map((c) => ({
            dir: c.dir,
            name: c.name,
            width: c.width,
            height: c.height,
            fonts: c.fonts ?? [],
            closedFonts: closedFonts(c.fonts ?? []),
          })),
          errors: index.errors ?? [],
        };
        if (!rec.cases.length) {
          throw new Error('zip 里一个画板都没有');
        }
        await addImport(rec, file);
        setAll([rec, ...recordsRef.current]);
        first ??= rec;
        fresh.push({
          text: `导入了 ${file.name}：${rec.cases.length} 个画板`,
        });
        const fonts = closedFontsOf(rec);
        if (fonts.length) {
          fresh.push({ text: fontWarning(fonts), error: true });
        }
        enqueue(rec.cases.map((c) => ({ id: rec.id, dir: c.dir })));
      } catch (e) {
        fresh.push({ text: `${file.name}：${message(e)}`, error: true });
      }
    }
    setNotices(fresh);
    if (first) {
      void navigate({ search: { id: first.id, case: first.cases[0].dir } });
    }
  }

  // See apps/docs/figma-to-tldraw/tech.md §19.1.
  useEffect(() => {
    const { id, case: dir } = search;
    if (!editor || !id || !dir) {
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
      putSnapshot(editor, assets.snapshot, dir, '', { mains: true });
      const area = renderArea(assets.snapshot);
      const { width, height } = assets.snapshot.meta;
      const x = Math.min(0, area.x);
      const y = Math.min(0, area.y);
      editor.zoomToBounds(
        {
          x,
          y,
          w: Math.max(width, area.x + area.width) - x,
          h: Math.max(height, area.y + area.height) - y,
        },
        { inset: 160 },
      );
      setLoaded({ id, dir, expectedUrl: assets.expectedUrl, area });
    })().catch((e: unknown) => {
      if (!cancelled) {
        setLoadError({ key: keyOf({ id, dir }), text: message(e) });
      }
    });
    return () => {
      cancelled = true;
      setHighlight(null);
      revoke?.();
    };
  }, [editor, search]);

  const analyzedAt = selected?.result?.analyzedAt;
  useEffect(() => {
    const { id, case: dir } = search;
    if (!id || !dir || !analyzedAt) {
      return;
    }
    let cancelled = false;
    let url: string | undefined;
    getOutputs(id, dir)
      .then((o) => {
        if (cancelled || !o) {
          return;
        }
        url = URL.createObjectURL(o.diff);
        setOutputs({ ...o, diffUrl: url, key: keyOf({ id, dir }) });
      })
      .catch((e: unknown) => console.warn(e));
    return () => {
      cancelled = true;
      setOutputs(null);
      if (url) {
        URL.revokeObjectURL(url);
      }
    };
  }, [search, analyzedAt]);

  async function onDelete(rec: ImportRecord) {
    if (
      !window.confirm(
        `删除「${rec.figmaFile || rec.fileName}」这次导入？浏览器里存的 zip 和对比结果都会删掉。`,
      )
    ) {
      return;
    }
    await deleteImport(rec).catch((e: unknown) => console.warn(e));
    setAll(recordsRef.current.filter((r) => r.id !== rec.id));
    if (rec.id === search.id) {
      setLoaded(null);
      if (editor) {
        clearEditor(editor);
      }
      void navigate({ search: {}, replace: true });
    }
  }

  async function onDownload(kind: DownloadKind) {
    if (!selected || !search.id || !search.case) {
      return;
    }
    const name = safeName(selected.name);
    try {
      if (kind === 'tldraw' && outputs) {
        saveBlob(outputs.actual, `${name}-tldraw@2x.png`);
      } else if (kind === 'diff' && outputs) {
        saveBlob(outputs.diff, `${name}-diff.png`);
      } else if (kind === 'figma') {
        const zip = await getZip(search.id);
        if (zip) {
          saveBlob(
            (await readZipCase(zip, search.case)).expected,
            `${name}-figma@2x.png`,
          );
        }
      } else if (kind === 'tldr' && editor) {
        saveBlob(await tldrFile(editor), `${name}.tldr`);
      }
    } catch (e) {
      setNotices([{ text: `下载失败：${message(e)}`, error: true }]);
    }
  }

  function onPick(node: DiffNode) {
    if (!editor || !search.case) {
      return;
    }
    const id = shapeIdFor(search.case, node.id);
    const page = editor.getShape(id) && editor.getAncestorPageId(id);
    if (page) {
      editor.setCurrentPage(page);
      editor.select(id);
      editor.zoomToSelection({ animation: { duration: 200 } });
    }
  }

  function handleMount(e: Editor) {
    if (import.meta.env.DEV) {
      window.editor = e;
    }
    setEditor(e);
    return startFigmaEditing(e);
  }

  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');

  const overlay: Overlay | null =
    loaded && loaded.id === search.id && loaded.dir === search.case
      ? {
          expectedUrl: loaded.expectedUrl,
          diffUrl: outputs?.diffUrl,
          area: loaded.area,
          mode,
          highlight,
        }
      : null;

  const selectedKey =
    search.id && search.case ? keyOf({ id: search.id, dir: search.case }) : '';

  return (
    <div
      className="fixed inset-0 flex"
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
      <aside className="flex w-80 shrink-0 flex-col border-r bg-background text-sm">
        <div className="min-h-0 flex-[3] space-y-4 overflow-y-auto p-3">
          <PanelHeader />
          <ImportButton
            busy={false}
            onFiles={(files) => void importFiles(files)}
          />
          {!persistent && (
            <p className="text-xs text-status-warning">
              这个浏览器窗口存不了数据（比如无痕模式），刷新页面后导入的内容会丢。
            </p>
          )}
          {progress && <ProgressBar progress={progress} />}
          {notices.length > 0 && (
            <ul className="space-y-1 text-xs leading-relaxed">
              {notices.map((n) => (
                <li
                  key={n.text}
                  className={n.error ? 'text-status-critical' : undefined}
                >
                  {n.text}
                </li>
              ))}
            </ul>
          )}
          {records && (
            <ImportList
              records={records}
              selectedId={search.id}
              selectedDir={search.case}
              busy={progress !== null}
              onSelect={(id, dir) =>
                void navigate({ search: { id, case: dir } })
              }
              onDelete={(r) => void onDelete(r)}
              onAnalyze={(r) =>
                enqueue(
                  r.cases
                    .filter((c) => !c.result)
                    .map((c) => ({ id: r.id, dir: c.dir })),
                )
              }
            />
          )}
          {loadError?.key === selectedKey && (
            <p className="text-xs text-destructive">
              打不开这个画板：{loadError.text}
            </p>
          )}
          {selected && search.id && (
            <CaseReport
              c={selected}
              analyzing={analyzing === selectedKey}
              hasOutputs={outputs?.key === selectedKey}
              mode={mode}
              onMode={setMode}
              onHighlight={setHighlight}
              onPick={onPick}
              onDownload={(kind) => void onDownload(kind)}
              onAnalyze={() =>
                enqueue([{ id: search.id ?? '', dir: selected.dir }])
              }
            />
          )}
        </div>
        <div className="flex min-h-0 flex-[2] flex-col border-t">
          {editor && <LayerTree editor={editor} />}
        </div>
      </aside>
      <div className="relative min-w-0 flex-1">
        <OverlayContext.Provider value={overlay}>
          <Tldraw
            shapeUtils={figmaShapeUtils}
            components={components}
            tools={figmaTools}
            overrides={figmaUiOverrides}
            options={options}
            getShapeVisibility={figmaShapeVisibility}
            textOptions={figmaTextOptions}
            onMount={handleMount}
          >
            <InspectorPortal
              target={inspector}
              diffNodes={selected?.result?.breakdown?.nodes ?? []}
              diffPixels={selected?.result?.diffPixels ?? 0}
            />
          </Tldraw>
        </OverlayContext.Provider>
        {records && !records.length && (
          <div className="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center">
            <p className="rounded-lg border bg-background px-4 py-3 text-sm text-muted-foreground shadow-sm">
              导入 Figma 插件导出的 zip 后，这里显示 tldraw 还原出来的画布
            </p>
          </div>
        )}
        {dragging && (
          <div className="pointer-events-none absolute inset-2 z-[1001] flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-background/80 text-base font-medium">
            松开鼠标导入 zip
          </div>
        )}
      </div>
      <aside
        ref={setInspector}
        aria-label="节点属性"
        className="w-72 shrink-0 overflow-y-auto border-l bg-background"
      />
      <ShotStageHost onReady={onStageReady} />
    </div>
  );
}
