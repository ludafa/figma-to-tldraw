import 'tldraw/tldraw.css';
import '../figma/figma.css';

import { getRouteApi, Link } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { createContext, useContext, useEffect, useState } from 'react';
import { type Editor, type TLComponents, Tldraw } from 'tldraw';

import { cn } from '@/lib/utils';

import {
  figmaShapeVisibility,
  FigmaStylePanel,
  figmaTextOptions,
  FigmaToolbar,
  figmaTools,
  figmaUiOverrides,
  LayerTree,
  relayoutAll,
  startFigmaEditing,
} from '../figma/editing';
import { putSnapshot } from '../figma/editor';
import hello from '../figma/fixtures/hello.json';
import { caseUrl, loadCase, loadCaseIndex, waitForAssets } from '../figma/load';
import { renderArea } from '../figma/render-area';
import { figmaShapeUtils } from '../figma/shapes';
import { shapeIdFor } from '../figma/to-shapes';
import type { CaseIndex, Snapshot } from '../figma/types';

// See apps/docs/figma-to-tldraw/tech.md §7.

declare global {
  interface Window {
    editor?: Editor;
    __figmaRelayoutAll?: () => void;
    __figmaReady?: boolean;
    __figmaWarnings?: string[];
    __figmaShotFrom?: (y: number) => void;
  }
}

const route = getRouteApi('/canvas');

const SHOT_OFFSET = 40;
const TLDRAW_LAYER_OFFSET = 0.125;

type OverlayMode = 'off' | 'half' | 'diff';

const OVERLAY_MODES: { mode: OverlayMode; label: string }[] = [
  { mode: 'off', label: '不叠加' },
  { mode: 'half', label: '半透明' },
  { mode: 'diff', label: '差异' },
];

interface Overlay {
  src: string;
  x: number;
  y: number;
  width: number;
  height: number;
  mode: OverlayMode;
}

const OverlayContext = createContext<Overlay | null>(null);

function ExpectedOverlay() {
  const overlay = useContext(OverlayContext);
  if (!overlay || overlay.mode === 'off') {
    return null;
  }
  return (
    <img
      src={overlay.src}
      alt=""
      draggable={false}
      style={{
        position: 'absolute',
        left: overlay.x,
        top: overlay.y,
        width: overlay.width,
        height: overlay.height,
        maxWidth: 'none',
        opacity: overlay.mode === 'half' ? 0.5 : 1,
        mixBlendMode: overlay.mode === 'diff' ? 'difference' : undefined,
        pointerEvents: 'none',
        zIndex: 1_000_000,
      }}
    />
  );
}

const components: TLComponents = {
  OnTheCanvas: ExpectedOverlay,
  StylePanel: FigmaStylePanel,
  Toolbar: FigmaToolbar,
};

// See apps/docs/figma-to-tldraw/tech.md §14.1 and §16.3.
const options = {
  createTextOnCanvasDoubleClick: false,
  maxShapesPerPage: 100_000,
};

function showSnapshot(
  editor: Editor,
  snapshot: Snapshot,
  id: string,
  assetBase: string,
  shot: boolean,
): string[] {
  // See apps/docs/figma-to-tldraw/tech.md §16.3.
  const warnings = putSnapshot(editor, snapshot, id, assetBase, {
    mains: !shot,
  });
  // See apps/docs/figma-to-tldraw/tech.md §7 and §9.
  const area = renderArea(snapshot);
  const showFrom = (y: number) => {
    editor.setCamera({
      x: SHOT_OFFSET - TLDRAW_LAYER_OFFSET - area.x,
      y: SHOT_OFFSET - TLDRAW_LAYER_OFFSET - area.y - y,
      z: 1,
    });
  };
  showFrom(0);
  // See apps/docs/figma-to-tldraw/tech.md §12.2.
  window.__figmaShotFrom = showFrom;
  return warnings;
}

function groupCases(index: CaseIndex) {
  const groups = new Map<string, CaseIndex['cases']>();
  for (const c of index.cases) {
    const group = c.dir.split('/')[0];
    groups.set(group, [...(groups.get(group) ?? []), c]);
  }
  return [...groups];
}

function CaseList({ index, current }: { index: CaseIndex; current?: string }) {
  const [open, setOpen] = useState(true);
  return (
    <nav
      className={cn('flex shrink-0 flex-col border-b', open && 'max-h-[40%]')}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 pt-3 pb-1 text-xs font-medium text-muted-foreground"
      >
        <ChevronRight
          className={cn('size-3 transition-transform', open && 'rotate-90')}
        />
        用例
      </button>
      {open && (
        <div className="min-h-0 overflow-y-auto pb-2">
          {groupCases(index).map(([group, cases]) => (
            <section key={group} className="px-2 py-1">
              <h2 className="px-2 py-1 text-xs font-medium text-muted-foreground">
                {group}
              </h2>
              {cases.map((c) => (
                <Link
                  key={c.dir}
                  to="/canvas"
                  search={{ case: c.dir }}
                  className={cn(
                    'block truncate rounded-md px-2 py-1 hover:bg-muted',
                    c.dir === current && 'bg-muted font-medium',
                  )}
                >
                  {c.dir.slice(group.length + 1)}
                </Link>
              ))}
            </section>
          ))}
        </div>
      )}
    </nav>
  );
}

function Toolbar({
  title,
  mode,
  onMode,
  warnings,
}: {
  title: string;
  mode: OverlayMode;
  onMode: (mode: OverlayMode) => void;
  warnings: string[];
}) {
  return (
    <div className="pointer-events-auto absolute top-2 left-1/2 z-[1000] flex -translate-x-1/2 items-center gap-3 rounded-lg border bg-background px-3 py-1.5 text-sm shadow-sm">
      <span className="font-medium">{title}</span>
      <div className="flex gap-1">
        {OVERLAY_MODES.map((m) => (
          <button
            key={m.mode}
            type="button"
            onClick={() => onMode(m.mode)}
            className={cn(
              'rounded-md px-2 py-0.5 hover:bg-muted',
              mode === m.mode && 'bg-muted font-medium',
            )}
          >
            {m.label}
          </button>
        ))}
      </div>
      {warnings.length > 0 && (
        <span className="text-amber-600" title={warnings.join('\n')}>
          {warnings.length} 条警告
        </span>
      )}
    </div>
  );
}

export function CanvasPage() {
  const search = route.useSearch();
  const shot = search.shot === 1;
  const [editor, setEditor] = useState<Editor | null>(null);
  const [index, setIndex] = useState<CaseIndex | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [mode, setMode] = useState<OverlayMode>('off');

  useEffect(() => {
    if (shot) {
      return;
    }
    loadCaseIndex()
      .then(setIndex)
      .catch((e: unknown) => console.warn(e));
  }, [shot]);

  useEffect(() => {
    if (!editor) {
      return;
    }
    let cancelled = false;
    window.__figmaReady = false;
    const dir = search.case;
    const load = dir
      ? loadCase(dir)
      : Promise.resolve(hello as unknown as Snapshot);
    const assetBase = dir ? caseUrl(dir) : '';
    load
      .then(async (snap) => {
        if (cancelled) {
          return;
        }
        const list = showSnapshot(
          editor,
          snap,
          dir ?? 'fixture/hello',
          assetBase,
          shot,
        );
        for (const w of list) {
          console.warn(w);
        }
        setSnapshot(snap);
        setWarnings(list);
        const missing = await waitForAssets(snap, assetBase);
        if (!cancelled) {
          for (const w of missing) {
            console.warn(w);
          }
          setWarnings([...list, ...missing]);
          window.__figmaWarnings = [...list, ...missing];
          window.__figmaReady = true;
        }
      })
      .catch((e: unknown) => {
        console.error(e);
        window.__figmaWarnings = [String(e)];
        window.__figmaReady = true;
      });
    return () => {
      cancelled = true;
    };
  }, [editor, search.case, shot]);

  // See apps/docs/figma-to-tldraw/tech.md §17.
  useEffect(() => {
    if (!editor || !snapshot || shot || !search.select) {
      return;
    }
    const id = shapeIdFor(search.case ?? 'fixture/hello', search.select);
    const page = editor.getShape(id) && editor.getAncestorPageId(id);
    if (page) {
      editor.setCurrentPage(page);
      editor.select(id);
      editor.zoomToSelection();
    }
  }, [editor, snapshot, shot, search.case, search.select]);

  function handleMount(e: Editor) {
    if (import.meta.env.DEV) {
      window.editor = e;
      window.__figmaRelayoutAll = () => relayoutAll(e);
    }
    setEditor(e);
    return startFigmaEditing(e);
  }

  const overlay: Overlay | null =
    search.case && snapshot
      ? {
          src: caseUrl(search.case, 'expected@2x.png'),
          ...renderArea(snapshot),
          mode,
        }
      : null;

  return (
    <div className="fixed inset-0 flex">
      {!shot && (
        <aside className="flex w-60 shrink-0 flex-col border-r bg-background text-sm">
          {index && <CaseList index={index} current={search.case} />}
          {editor && <LayerTree editor={editor} />}
        </aside>
      )}
      <div className={cn('relative flex-1', shot && 'figma-shot')}>
        <OverlayContext.Provider value={overlay}>
          <Tldraw
            shapeUtils={figmaShapeUtils}
            components={components}
            tools={figmaTools}
            overrides={figmaUiOverrides}
            options={options}
            getShapeVisibility={figmaShapeVisibility}
            textOptions={figmaTextOptions}
            hideUi={shot}
            onMount={handleMount}
          />
        </OverlayContext.Provider>
        {!shot && (
          <Toolbar
            title={search.case ?? '示例'}
            mode={mode}
            onMode={setMode}
            warnings={warnings}
          />
        )}
      </div>
    </div>
  );
}
