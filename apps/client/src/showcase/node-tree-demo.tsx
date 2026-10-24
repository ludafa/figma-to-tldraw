import 'tldraw/tldraw.css';
import '../figma/figma.css';

import { useEffect, useMemo, useRef, useState } from 'react';
import { type Editor, Tldraw, useValue } from 'tldraw';

import { cn } from '@/lib/utils';

import { putSnapshot } from '../figma/editor';
import { caseUrl, loadCase } from '../figma/load';
import { renderArea } from '../figma/render-area';
import { figmaShapeUtils } from '../figma/shapes';
import { shapeIdFor } from '../figma/to-shapes';
import type { FigmaNode, Snapshot } from '../figma/types';

// See apps/docs/figma-to-tldraw/tech.md §11.

const DEMO_CASE = 'page/mobile-login';
const PAD = 24;

interface Row {
  node: FigmaNode;
  depth: number;
}

function flatten(node: FigmaNode, depth: number, out: Row[]) {
  if (node.visible === false) {
    return;
  }
  out.push({ node, depth });
  for (const child of node.children ?? []) {
    flatten(child, depth + 1, out);
  }
}

function fitCamera(editor: Editor, snapshot: Snapshot) {
  const area = renderArea(snapshot);
  const view = editor.getViewportScreenBounds();
  const z = Math.min(
    (view.w - PAD * 2) / area.width,
    (view.h - PAD * 2) / area.height,
    1,
  );
  editor.setCamera({
    x: (view.w / z - area.width) / 2 - area.x,
    y: PAD / z - area.y,
    z,
  });
}

export function NodeTreeDemo() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    loadCase(DEMO_CASE)
      .then(setSnapshot)
      .catch((e: unknown) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!editor || !snapshot) {
      return;
    }
    putSnapshot(editor, snapshot, DEMO_CASE, caseUrl(DEMO_CASE));
    editor.setCurrentTool('select');
    fitCamera(editor, snapshot);
  }, [editor, snapshot, resetKey]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    if (snapshot) {
      flatten(snapshot.rest.document, 0, out);
    }
    return out;
  }, [snapshot]);

  const shapeTypes = useValue(
    'shape types',
    () =>
      new Map(
        rows.map((r) => [
          r.node.id,
          editor?.getShape(shapeIdFor(DEMO_CASE, r.node.id))?.type,
        ]),
      ),
    [editor, rows],
  );
  const selected = useValue(
    'selected',
    () => new Set<string>(editor?.getSelectedShapeIds() ?? []),
    [editor],
  );

  useEffect(() => {
    const first = rows.find((r) =>
      selected.has(shapeIdFor(DEMO_CASE, r.node.id)),
    );
    if (first) {
      rowRefs.current.get(first.node.id)?.scrollIntoView({ block: 'nearest' });
    }
  }, [rows, selected]);

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  return (
    <div className="grid gap-4 md:grid-cols-[300px_minmax(0,1fr)]">
      <div className="flex h-[520px] flex-col overflow-hidden rounded-lg border">
        <div className="border-b px-3 py-2 text-xs text-muted-foreground">
          Figma 节点树（{rows.length} 个节点）→ tldraw 图形
        </div>
        <ul className="flex-1 overflow-y-auto py-1 text-sm">
          {rows.map(({ node, depth }) => {
            const id = shapeIdFor(DEMO_CASE, node.id);
            const type = shapeTypes.get(node.id);
            return (
              <li key={node.id}>
                <button
                  ref={(el) => {
                    if (el) {
                      rowRefs.current.set(node.id, el);
                    } else {
                      rowRefs.current.delete(node.id);
                    }
                  }}
                  type="button"
                  disabled={!type}
                  onClick={() => editor?.select(id)}
                  onMouseEnter={() => type && editor?.setHoveredShape(id)}
                  onMouseLeave={() => editor?.setHoveredShape(null)}
                  className={cn(
                    'flex w-full items-baseline gap-2 py-1 pr-3 text-left hover:bg-muted',
                    selected.has(id) && 'bg-muted font-medium',
                  )}
                  style={{ paddingLeft: 12 + depth * 14 }}
                >
                  <span className="min-w-0 flex-1 truncate">{node.name}</span>
                  <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
                    {node.type} → {type ?? '—'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
      <div className="relative h-[520px] overflow-hidden rounded-lg border">
        <div className="absolute inset-0">
          <Tldraw
            shapeUtils={figmaShapeUtils}
            hideUi
            autoFocus={false}
            onMount={setEditor}
          />
        </div>
        <button
          type="button"
          onClick={() => setResetKey((k) => k + 1)}
          className="absolute top-2 right-2 z-[1000] rounded-md border bg-background px-2 py-0.5 text-xs shadow-xs hover:bg-muted"
        >
          复位
        </button>
      </div>
    </div>
  );
}
