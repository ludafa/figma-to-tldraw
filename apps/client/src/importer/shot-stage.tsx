import { useEffect, useRef } from 'react';
import { type Editor, Tldraw } from 'tldraw';

import type { DiffBreakdown } from '../figma/diff-attribution';
import {
  figmaShapeVisibility,
  figmaTextOptions,
  figmaTools,
  startFigmaEditing,
  withoutFigmaEffects,
} from '../figma/editing';
import { putSnapshot } from '../figma/editor';
import { waitForAssets } from '../figma/load';
import { renderArea } from '../figma/render-area';
import { figmaShapeUtils } from '../figma/shapes';
import type { Snapshot } from '../figma/types';
import { captureElement } from './capture';
import { compareInWorker } from './diff';
import { SCALE } from './diff-core';

// See apps/docs/figma-to-tldraw/tech.md §19.2.

const SHOT_OFFSET = 40;
const TLDRAW_LAYER_OFFSET = 0.125;
const MARGIN = { right: 200, bottom: 100 };
const STRIP_HEIGHT = 2000;
const STRIP_PIXELS = 4_000_000;
const MAX_PIXELS = 80_000_000;

const options = {
  createTextOnCanvasDoubleClick: false,
  maxShapesPerPage: 100_000,
};

export interface ShotJob {
  idPrefix: string;
  snapshot: Snapshot;
  expected: Blob;
}

export interface ShotResult {
  diff: number;
  diffPixels: number;
  breakdown: DiffBreakdown;
  warnings: string[];
  actual: Blob;
  diffImage: Blob;
  ms: number;
}

export interface ShotStage {
  analyze: (job: ShotJob) => Promise<ShotResult>;
}

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

async function frames(n: number) {
  for (let i = 0; i < n; i++) {
    await nextFrame();
  }
}

function canvasOf(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('浏览器开不出这么大的画布');
  }
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
}

function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('导出 PNG 失败'))),
      'image/png',
    );
  });
}

async function analyze(
  editor: Editor,
  wrap: HTMLElement,
  job: ShotJob,
): Promise<ShotResult> {
  const started = performance.now();
  const area = renderArea(job.snapshot);
  const bitmap = await createImageBitmap(job.expected, {
    colorSpaceConversion: 'none',
  });
  const { width, height } = bitmap;
  if (width * height > MAX_PIXELS) {
    throw new Error(
      `这张图太大了（${width}×${height}），浏览器里比不动，请用本地对比脚本`,
    );
  }
  const strip = Math.max(
    400,
    Math.min(
      STRIP_HEIGHT,
      Math.floor(STRIP_PIXELS / (area.width + SHOT_OFFSET * 2 + MARGIN.right)),
    ),
  );
  wrap.style.width = `${Math.ceil(area.width) + SHOT_OFFSET * 2 + MARGIN.right}px`;
  wrap.style.height = `${Math.min(Math.ceil(area.height), strip) + SHOT_OFFSET * 2 + MARGIN.bottom}px`;
  await frames(1);
  editor.updateViewportScreenBounds(editor.getContainer());
  const showFrom = (top: number) =>
    editor.setCamera({
      x: SHOT_OFFSET - TLDRAW_LAYER_OFFSET - area.x,
      y: SHOT_OFFSET - TLDRAW_LAYER_OFFSET - area.y - top,
      z: 1,
    });

  const warnings = putSnapshot(editor, job.snapshot, job.idPrefix, '', {
    mains: false,
  });
  showFrom(0);
  await frames(2);
  const missing = await waitForAssets(job.snapshot, '');

  const actual = canvasOf(width, height);
  const root = editor.getContainer();
  for (let top = 0; top < area.height; top += strip) {
    const y = Math.round(top * SCALE);
    const rows = Math.min(Math.round(strip * SCALE), height - y);
    if (rows <= 0) {
      break;
    }
    showFrom(top);
    await frames(3);
    const shot = await captureElement(root, SCALE);
    actual.ctx.drawImage(
      shot,
      SHOT_OFFSET * SCALE,
      SHOT_OFFSET * SCALE,
      width,
      rows,
      0,
      y,
      width,
      rows,
    );
    shot.width = 0;
  }
  withoutFigmaEffects(editor, () =>
    editor.run(
      () => editor.deleteShapes([...editor.getCurrentPageShapeIds()]),
      { history: 'ignore' },
    ),
  );

  const expected = canvasOf(width, height);
  expected.ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const out = await compareInWorker({
    expected: expected.ctx.getImageData(0, 0, width, height).data,
    actual: actual.ctx.getImageData(0, 0, width, height).data,
    width,
    height,
    snapshot: job.snapshot,
  });
  expected.canvas.width = 0;
  const actualPng = await toPng(actual.canvas);
  actual.canvas.width = 0;
  const diff = canvasOf(width, height);
  diff.ctx.putImageData(new ImageData(out.diff, width, height), 0, 0);
  const diffPng = await toPng(diff.canvas);
  diff.canvas.width = 0;

  return {
    diff: (out.diffPixels / (width * height)) * 100,
    diffPixels: out.diffPixels,
    breakdown: out.breakdown,
    warnings: [...warnings, ...missing],
    actual: actualPng,
    diffImage: diffPng,
    ms: Math.round(performance.now() - started),
  };
}

/** A hidden tldraw that renders one case at a time in screenshot mode. */
export function ShotStageHost({
  onReady,
}: {
  onReady: (stage: ShotStage | null) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => () => onReady(null), [onReady]);

  function handleMount(editor: Editor) {
    const stop = startFigmaEditing(editor);
    onReady({
      analyze: (job) => {
        const wrap = wrapRef.current;
        if (!wrap) {
          return Promise.reject(new Error('截图用的画布还没准备好'));
        }
        return analyze(editor, wrap, job);
      },
    });
    return stop;
  }

  return (
    <div
      ref={wrapRef}
      aria-hidden
      className="figma-shot"
      style={{
        position: 'fixed',
        left: -100_000,
        top: 0,
        width: 800,
        height: 600,
        pointerEvents: 'none',
      }}
    >
      <Tldraw
        shapeUtils={figmaShapeUtils}
        tools={figmaTools}
        options={options}
        getShapeVisibility={figmaShapeVisibility}
        textOptions={figmaTextOptions}
        hideUi
        onMount={handleMount}
      />
    </div>
  );
}
