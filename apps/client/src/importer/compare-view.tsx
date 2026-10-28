import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { cn } from '@/lib/utils';

import { type Editor, getCanvasController, Tldraw, useValue } from '../engine';
import {
  figmaShapeVisibility,
  figmaTextOptions,
  figmaTools,
  startFigmaEditing,
} from '../figma/editing';
import { putSnapshot } from '../figma/editor';
import type { RenderArea } from '../figma/render-area';
import { figmaShapeUtils } from '../figma/shapes';
import type { Snapshot } from '../figma/types';
import { SCALE } from './diff-core';
import { ImagePyramid, levelFor } from './tiled-image';

// See apps/docs/figma-to-tldraw/tech.md §20.2.

const FIT_INSET = 24;
const FIT_MAX_ZOOM = 2;
const PICK_MAX_ZOOM = 4;

export function fitArea(editor: Editor, area: RenderArea) {
  editor.zoomToBounds(
    { x: area.x, y: area.y, w: area.width, h: area.height },
    { inset: FIT_INSET, targetZoom: FIT_MAX_ZOOM },
  );
}

/** Zooms to `box` (relative to the render area), keeping the zoom if it already fits. */
export function zoomToBox(editor: Editor, area: RenderArea, box: RenderArea) {
  editor.zoomToBounds(
    { x: area.x + box.x, y: area.y + box.y, w: box.width, h: box.height },
    { inset: 48, targetZoom: PICK_MAX_ZOOM },
  );
}

/** Children in page coordinates, moved by the editor's camera. */
function PageLayer({
  editor,
  children,
}: {
  editor: Editor;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    const update = () => {
      const c = editor.getCamera();
      el.style.transform = `scale(${c.z}) translate(${c.x}px, ${c.y}px)`;
      el.style.setProperty('--zoom', String(c.z));
    };
    update();
    editor.on('camera', update);
    return () => {
      editor.off('camera', update);
    };
  }, [editor]);
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute top-0 left-0 size-px origin-top-left"
    >
      {children}
    </div>
  );
}

const boxStyle = (area: RenderArea, box: RenderArea): CSSProperties => ({
  position: 'absolute',
  left: area.x + box.x,
  top: area.y + box.y,
  width: box.width,
  height: box.height,
});

/** The render area's outline plus the hovered node's box. */
function Marks({
  area,
  highlight,
}: {
  area: RenderArea;
  highlight: RenderArea | null;
}) {
  const whole = { x: 0, y: 0, width: area.width, height: area.height };
  return (
    <>
      <div
        style={{
          ...boxStyle(area, whole),
          outline: 'calc(1px / var(--zoom)) solid rgb(0 0 0 / 15%)',
        }}
      />
      {highlight && (
        <div
          style={{
            ...boxStyle(area, highlight),
            outline: 'calc(2px / var(--zoom)) solid #f43f5e',
            background: 'rgb(244 63 94 / 12%)',
          }}
        />
      )}
    </>
  );
}

/** A pyramid for `blob`, once its overview level is decoded; null meanwhile. */
export function usePyramid(blob: Blob | null): ImagePyramid | null {
  const [ready, setReady] = useState<ImagePyramid | null>(null);
  useEffect(() => {
    if (!blob) {
      return;
    }
    const pyramid = new ImagePyramid(blob);
    let cancelled = false;
    pyramid.ready
      .then(() => !cancelled && setReady(pyramid))
      .catch((e: unknown) => console.warn('image decode failed', e));
    return () => {
      cancelled = true;
      setReady(null);
      pyramid.close();
    };
  }, [blob]);
  return ready;
}

/**
 * Draws the pyramids over the render area under the editor's camera; each
 * layer after the first is subtracted from what is below it.
 */
function drawLayers(
  canvas: HTMLCanvasElement,
  editor: Editor,
  area: RenderArea,
  layers: readonly ImagePyramid[],
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const [base] = layers;
  if (!base) {
    return;
  }
  const dpr = canvas.width / Math.max(1, canvas.clientWidth);
  const cam = editor.getCamera();
  const s = cam.z * dpr;
  const toDevice = (ix: number, iy: number) => ({
    x: Math.round((area.x + ix / SCALE + cam.x) * s),
    y: Math.round((area.y + iy / SCALE + cam.y) * s),
  });
  const view = {
    x: (-cam.x - area.x) * SCALE,
    y: (-cam.y - area.y) * SCALE,
    w: (canvas.width / s) * SCALE,
    h: (canvas.height / s) * SCALE,
  };
  // See apps/docs/figma-to-tldraw/tech.md §20.2.
  ctx.imageSmoothingEnabled = cam.z / SCALE < 1;
  const level = levelFor(base, SCALE / s);
  for (const k of level < base.top ? [base.top, level] : [base.top]) {
    for (const [c, r] of base.covering(k, view)) {
      const tiles = layers.map((p) => p.tile(k, c, r));
      if (tiles.some((t) => !t)) {
        continue;
      }
      const rect = base.rect(k, c, r);
      const a = toDevice(rect.x, rect.y);
      const b = toDevice(rect.x + rect.w, rect.y + rect.h);
      tiles.forEach((t, i) => {
        ctx.globalCompositeOperation = i ? 'difference' : 'source-over';
        ctx.drawImage(t!, a.x, a.y, b.x - a.x, b.y - a.y);
      });
    }
  }
}

/**
 * Images under the canvas camera, drawn from tiles at the zoom's level; wheel
 * and drag move the canvas.
 */
export function MirrorPane({
  editor,
  area,
  highlight,
  layers,
  brighten,
}: {
  editor: Editor | null;
  area: RenderArea;
  highlight: RenderArea | null;
  layers: readonly ImagePyramid[];
  brighten?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const [grabbing, setGrabbing] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!editor || !canvas) {
      return;
    }
    let frame = 0;
    const schedule = () => {
      frame ||= requestAnimationFrame(() => {
        frame = 0;
        drawLayers(canvas, editor, area, layers);
      });
    };
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const width = Math.round(canvas.clientWidth * dpr);
      const height = Math.round(canvas.clientHeight * dpr);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      schedule();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    editor.on('camera', schedule);
    const stops = layers.map((p) => p.onLoad(schedule));
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      editor.off('camera', schedule);
      for (const stop of stops) {
        stop();
      }
    };
  }, [editor, area, layers]);

  useEffect(() => {
    const el = ref.current;
    if (!editor || !el) {
      return;
    }
    const onWheel = (e: WheelEvent) => {
      const canvas = getCanvasController(editor)?.canvas;
      if (!canvas) {
        return;
      }
      e.preventDefault();
      const from = el.getBoundingClientRect();
      const to = editor.getViewportScreenBounds();
      canvas.dispatchEvent(
        new WheelEvent('wheel', {
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          deltaMode: e.deltaMode,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          clientX: e.clientX - from.left + to.x,
          clientY: e.clientY - from.top + to.y,
          bubbles: true,
          cancelable: true,
        }),
      );
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [editor]);

  return (
    <div
      ref={ref}
      className={cn(
        'absolute inset-0 touch-none overflow-clip bg-white select-none',
        grabbing ? 'cursor-grabbing' : 'cursor-grab',
      )}
      onPointerDown={(e) => {
        if (e.button !== 0) {
          return;
        }
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
        setGrabbing(true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!editor || d?.id !== e.pointerId) {
          return;
        }
        editor.pan({ x: e.clientX - d.x, y: e.clientY - d.y });
        drag.current = { ...d, x: e.clientX, y: e.clientY };
      }}
      onPointerUp={() => {
        drag.current = null;
        setGrabbing(false);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setGrabbing(false);
      }}
    >
      <canvas
        ref={canvasRef}
        className="absolute inset-0 size-full"
        style={brighten ? { filter: `brightness(${brighten})` } : undefined}
      />
      {editor && (
        <PageLayer editor={editor}>
          <Marks area={area} highlight={highlight} />
        </PageLayer>
      )}
    </div>
  );
}

/**
 * Our canvas with the snapshot on it, view only (drag pans). Fits the render
 * area on load, on `resetKey` and on resize until the camera is moved.
 */
export function CompareCanvas({
  dir,
  snapshot,
  area,
  highlight,
  resetKey,
  onEditor,
}: {
  dir: string;
  snapshot: Snapshot;
  area: RenderArea;
  highlight: RenderArea | null;
  resetKey: number;
  onEditor: (editor: Editor | null) => void;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const fitted = useRef<string | null>(null);
  const viewport = useValue(
    'compare viewport',
    () => editor?.getViewportScreenBounds(),
    [editor],
  );

  useEffect(() => {
    if (!editor) {
      return;
    }
    putSnapshot(editor, snapshot, dir, '', { mains: false });
    editor.setCurrentTool('hand');
    fitted.current = null;
  }, [editor, snapshot, dir]);

  useEffect(() => {
    if (!editor || !viewport?.w || !viewport.h) {
      return;
    }
    const camera = JSON.stringify(editor.getCamera());
    if (fitted.current === null || fitted.current === camera) {
      fitArea(editor, area);
      fitted.current = JSON.stringify(editor.getCamera());
    }
  }, [editor, area, viewport?.w, viewport?.h]);

  useEffect(() => {
    if (editor && resetKey > 0) {
      fitArea(editor, area);
      fitted.current = JSON.stringify(editor.getCamera());
    }
  }, [editor, area, resetKey]);

  function handleMount(e: Editor) {
    if (import.meta.env.DEV) {
      window.editor = e;
    }
    setEditor(e);
    onEditor(e);
    const stop = startFigmaEditing(e);
    return () => {
      stop();
      onEditor(null);
    };
  }

  return (
    <div className="absolute inset-0">
      <Tldraw
        shapeUtils={figmaShapeUtils}
        tools={figmaTools}
        getShapeVisibility={figmaShapeVisibility}
        textOptions={figmaTextOptions}
        hideUi
        autoFocus={false}
        background="#ffffff"
        onMount={handleMount}
      />
      {editor && (
        <div className="pointer-events-none absolute inset-0 overflow-clip">
          <PageLayer editor={editor}>
            <Marks area={area} highlight={highlight} />
          </PageLayer>
        </div>
      )}
    </div>
  );
}
