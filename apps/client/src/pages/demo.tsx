import '../figma/figma.css';
import '../demo/demo.css';

import { getRouteApi, Link } from '@tanstack/react-router';
import { createContext, useContext, useEffect, useRef, useState } from 'react';

import { cn } from '@/lib/utils';

import { layoutWall, type Wall, type WallBox } from '../demo/layout';
import { loadWall, type WallProgress } from '../demo/load';
import {
  type Editor,
  getCanvasController,
  SkiaCanvas,
  type TLComponents,
  useEditor,
} from '../engine';
import {
  figmaShapeVisibility,
  FigmaStylePanel,
  figmaTextOptions,
  FigmaToolbar,
  figmaTools,
  figmaUiOverrides,
  relayoutAll,
  startFigmaEditing,
} from '../figma/editing';
import { loadCaseIndex } from '../figma/load';
import { figmaShapeUtils } from '../figma/shapes';
import { caseName, groupCases } from '../showcase/groups';

// See apps/docs/skia-engine/tech.md §10.

const route = getRouteApi('/demo');

const options = {
  createTextOnCanvasDoubleClick: false,
  maxShapesPerPage: 200_000,
  minZoom: 0.005,
};

/** Case names show once their board is this wide on screen. */
const LABEL_MIN_PX = 72;
/** Section titles show once their section is this wide on screen. */
const SECTION_MIN_PX = 40;
/** Screen space kept free around a zoomed-to box: the panel, titles, toolbar. */
const FIT_PAD = { left: 292, top: 64, right: 32, bottom: 88 };
const FIT_PAD_NARROW = { left: 16, top: 64, right: 16, bottom: 88 };

const WallContext = createContext<Wall | null>(null);

function shortTitle(label: string) {
  return label.startsWith('真实稿子：')
    ? label.slice('真实稿子：'.length)
    : label.split('：')[0];
}

// See apps/docs/skia-engine/tech.md §10.5.
function zoomTo(editor: Editor, box: WallBox) {
  const view = editor.getViewportScreenBounds();
  const pad = view.w < 720 ? FIT_PAD_NARROW : FIT_PAD;
  const w = Math.max(view.w - pad.left - pad.right, 1);
  const h = Math.max(view.h - pad.top - pad.bottom, 1);
  const z = Math.min(
    editor.options.maxZoom,
    Math.max(editor.options.minZoom, Math.min(w / box.w, h / box.h)),
  );
  editor.setCamera({
    x: (pad.left + w / 2) / z - (box.x + box.w / 2),
    y: (pad.top + h / 2) / z - (box.y + box.h / 2),
    z,
  });
}

// See apps/docs/skia-engine/tech.md §10.5.
function WallLabels() {
  const wall = useContext(WallContext);
  const editor = useEditor();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root || !wall) {
      return;
    }
    const labels = [
      ...root.querySelectorAll<HTMLElement>('[data-min-zoom]'),
    ].map((el) => ({ el, min: Number(el.dataset.minZoom), shown: true }));
    const update = () => {
      const z = editor.getZoomLevel();
      for (const l of labels) {
        const show = z >= l.min;
        if (show !== l.shown) {
          l.shown = show;
          l.el.style.display = show ? '' : 'none';
        }
      }
    };
    update();
    editor.on('camera', update);
    const canvas = getCanvasController(editor)?.canvas;
    const forwardWheel = (e: WheelEvent) => {
      e.preventDefault();
      canvas?.dispatchEvent(new WheelEvent('wheel', e));
    };
    root.addEventListener('wheel', forwardWheel, { passive: false });
    return () => {
      editor.off('camera', update);
      root.removeEventListener('wheel', forwardWheel);
    };
  }, [editor, wall]);

  if (!wall) {
    return null;
  }
  return (
    <div ref={ref} className="demo-labels">
      {wall.sections.map((s) => (
        <button
          key={`${s.copy}:${s.key}`}
          type="button"
          className="demo-label demo-section-label"
          title={s.title}
          data-min-zoom={SECTION_MIN_PX / s.w}
          style={{
            left: s.x,
            top: s.y,
            ['--label-w' as string]: s.w,
            ['--label-gap' as string]: wall.titleBand * 0.2,
          }}
          onClick={() => zoomTo(editor, s)}
        >
          {s.title}
          {s.copy > 0 && (
            <span className="opacity-50"> · 第 {s.copy + 1} 份</span>
          )}
        </button>
      ))}
      {wall.boards.map((b) => (
        <button
          key={b.idPrefix}
          type="button"
          className="demo-label demo-board-label"
          title={caseName(b.dir)}
          data-min-zoom={LABEL_MIN_PX / b.w}
          style={{
            left: b.x,
            top: b.y,
            ['--label-w' as string]: b.w,
          }}
          onClick={() => zoomTo(editor, b)}
        >
          {caseName(b.dir)}
        </button>
      ))}
    </div>
  );
}

const components: TLComponents = {
  OnTheCanvas: WallLabels,
  StylePanel: FigmaStylePanel,
  Toolbar: FigmaToolbar,
};

function useFps(): number {
  const [fps, setFps] = useState(0);
  useEffect(() => {
    let raf = 0;
    let frames = 0;
    let since = performance.now();
    const tick = (t: number) => {
      frames++;
      if (t - since >= 500) {
        setFps(Math.round((frames * 1000) / (t - since)));
        frames = 0;
        since = t;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return fps;
}

function Panel({
  editor,
  wall,
  progress,
  copies,
}: {
  editor: Editor | null;
  wall: Wall | null;
  progress: WallProgress | null;
  copies: number;
}) {
  const fps = useFps();
  const loading = progress && progress.loaded < progress.total;
  const frameMs = editor
    ? (getCanvasController(editor)?.stats.lastFrameMs ?? 0)
    : 0;
  return (
    <div className="pointer-events-auto absolute top-3 left-3 z-10 w-64 space-y-3 rounded-lg border bg-background/95 p-3 text-sm shadow-sm backdrop-blur">
      <div className="flex items-baseline justify-between">
        <h1 className="font-semibold">总览 Demo</h1>
        <Link
          to="/showcase"
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          ← 还原展示
        </Link>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 tabular-nums">
        <dt className="text-muted-foreground">用例</dt>
        <dd className="text-right">
          {progress ? `${progress.loaded} / ${progress.total}` : '…'}
          {copies > 1 && ` × ${copies}`}
        </dd>
        <dt className="text-muted-foreground">图形</dt>
        <dd className="text-right" data-testid="demo-shapes">
          {progress ? progress.shapes.toLocaleString('en-US') : '…'}
        </dd>
        <dt className="text-muted-foreground">帧率</dt>
        <dd className="text-right">{fps} fps</dd>
        <dt className="text-muted-foreground">引擎每帧</dt>
        <dd className="text-right">{frameMs.toFixed(1)} ms</dd>
      </dl>
      {loading && (
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-[width]"
            style={{ width: `${(progress.loaded / progress.total) * 100}%` }}
          />
        </div>
      )}
      {progress && progress.failed.length > 0 && (
        <p className="text-xs text-destructive">
          {progress.failed.length} 个用例没加载出来：
          {progress.failed.join('、')}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
          disabled={!editor || !wall}
          onClick={() => editor && wall && zoomTo(editor, wall.bounds)}
        >
          看全部
        </button>
        {[1, 2, 3, 4].map((n) => (
          <Link
            key={n}
            to="/demo"
            search={{ copies: n > 1 ? n : undefined }}
            className={cn(
              'rounded-md border px-2 py-1 text-xs hover:bg-muted',
              n === copies && 'bg-muted font-medium',
            )}
          >
            ×{n}
          </Link>
        ))}
      </div>
      {wall && (
        <ul className="max-h-[40vh] space-y-0.5 overflow-y-auto text-xs">
          {wall.sections
            .filter((s) => s.copy === 0)
            .map((s) => (
              <li key={s.key}>
                <button
                  type="button"
                  className="flex w-full justify-between rounded px-1.5 py-0.5 text-left hover:bg-muted"
                  onClick={() => editor && zoomTo(editor, s)}
                >
                  <span>{s.title}</span>
                  <span className="text-muted-foreground tabular-nums">
                    {
                      wall.boards.filter(
                        (b) => b.copy === 0 && b.dir.startsWith(`${s.key}/`),
                      ).length
                    }
                  </span>
                </button>
              </li>
            ))}
        </ul>
      )}
    </div>
  );
}

export function DemoPage() {
  const copies = route.useSearch().copies ?? 1;
  const [editor, setEditor] = useState<Editor | null>(null);
  const [wall, setWall] = useState<Wall | null>(null);
  const [progress, setProgress] = useState<WallProgress | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadCaseIndex()
      .then((index) => {
        if (cancelled) {
          return;
        }
        const groups = groupCases(index)
          .sort(
            (a, b) =>
              Number(a.key.startsWith('real/')) -
              Number(b.key.startsWith('real/')),
          )
          .map((g) => ({
            key: g.key,
            title: shortTitle(g.label),
            cases: g.cases,
          }));
        setWall(layoutWall(groups, copies));
      })
      .catch((e: unknown) => console.error(e));
    return () => {
      cancelled = true;
    };
  }, [copies]);

  useEffect(() => {
    if (!editor || !wall) {
      return;
    }
    let cancelled = false;
    window.__figmaReady = false;
    editor.run(
      () => editor.deleteShapes([...editor.getCurrentPageShapeIds()]),
      { history: 'ignore' },
    );
    zoomTo(editor, wall.bounds);
    void loadWall(editor, wall, {
      isCancelled: () => cancelled,
      onProgress: setProgress,
    })
      .then(() => getCanvasController(editor)?.whenIdle())
      .then(() => {
        if (!cancelled) {
          window.__figmaReady = true;
        }
      });
    return () => {
      cancelled = true;
    };
  }, [editor, wall]);

  function handleMount(e: Editor) {
    if (import.meta.env.DEV) {
      window.editor = e;
      window.__figmaRelayoutAll = () => relayoutAll(e);
    }
    setEditor(e);
    return startFigmaEditing(e);
  }

  return (
    <div className="fixed inset-0">
      <WallContext.Provider value={wall}>
        <SkiaCanvas
          shapeUtils={figmaShapeUtils}
          components={components}
          tools={figmaTools}
          overrides={figmaUiOverrides}
          options={options}
          getShapeVisibility={figmaShapeVisibility}
          textOptions={figmaTextOptions}
          renderMode="tiles"
          background="#f5f5f5"
          onMount={handleMount}
        />
      </WallContext.Provider>
      <Panel editor={editor} wall={wall} progress={progress} copies={copies} />
    </div>
  );
}
