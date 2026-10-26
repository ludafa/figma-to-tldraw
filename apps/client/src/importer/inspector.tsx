import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, useValue } from 'tldraw';

import { cn } from '@/lib/utils';

import { isFigmaShape } from '../figma/clip';
import type { DiffNode } from '../figma/diff-attribution';
import { FigmaInspector } from '../figma/editing';
import type { FigmaShape } from '../figma/shape-types';

// See apps/docs/figma-to-tldraw/tech.md §19.1.

function percent(part: number, whole: number): string {
  const value = whole > 0 ? (part / whole) * 100 : 0;
  return value < 1 ? '<1%' : `${Math.round(value)}%`;
}

function RawNode({ shape }: { shape: FigmaShape }) {
  const [open, setOpen] = useState(false);
  const { children, ...node } = shape.props.node;
  return (
    <div className="border-t border-black/10 px-3 py-2 text-[11px]">
      <button
        type="button"
        className="flex items-center gap-1 font-semibold"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <ChevronRight
          className={cn('size-3 transition-transform', open && 'rotate-90')}
        />
        原始节点数据
      </button>
      {open && (
        <pre className="mt-1.5 max-h-96 overflow-auto rounded-sm bg-black/[0.04] p-2 text-[10px] leading-snug break-all whitespace-pre-wrap">
          {JSON.stringify(
            children
              ? { ...node, children: `${children.length} 个子节点` }
              : node,
            null,
            2,
          )}
        </pre>
      )}
    </div>
  );
}

function Inspector({
  diffNodes,
  diffPixels,
}: {
  diffNodes: DiffNode[];
  diffPixels: number;
}) {
  const editor = useEditor();
  const shape = useValue(
    'inspected shape',
    () => {
      const only = editor.getOnlySelectedShape();
      return only && isFigmaShape(only) ? (only as FigmaShape) : null;
    },
    [editor],
  );
  const hit = shape && diffNodes.find((n) => n.id === shape.props.node.id);
  return (
    <div className="pb-6">
      <FigmaInspector
        empty={
          <p className="px-3 py-4 text-xs text-muted-foreground">
            在画布上或左边的图层树里选一个节点，这里显示它的属性。
          </p>
        }
      />
      {shape && (
        <div className="border-t border-black/10 px-3 py-2 text-[11px]">
          <div className="mb-1 font-semibold">差异</div>
          <p className="text-black/60">
            {hit
              ? `差异最多的节点之一，占全部差异像素的 ${percent(hit.pixels, diffPixels)}。`
              : '不在差异最多的节点里。'}
          </p>
          <p className="mt-1 text-black/45">
            Figma 节点 id：{shape.props.node.id}
          </p>
        </div>
      )}
      {shape && <RawNode shape={shape} />}
    </div>
  );
}

/** Renders the inspector into `target` (outside the canvas) with the editor's context. */
export function InspectorPortal({
  target,
  diffNodes,
  diffPixels,
}: {
  target: HTMLElement | null;
  diffNodes: DiffNode[];
  diffPixels: number;
}) {
  return target
    ? createPortal(
        <Inspector diffNodes={diffNodes} diffPixels={diffPixels} />,
        target,
      )
    : null;
}
