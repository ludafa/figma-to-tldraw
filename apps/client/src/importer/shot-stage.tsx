import { useEffect } from 'react';

import { type Editor, getCanvasController, Tldraw } from '../engine';
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
import { startCompare } from './diff';
import { SCALE, STRIP_OVERLAP } from './diff-core';

// See apps/docs/figma-to-tldraw/tech.md §19.2.

const STRIP_PIXELS = 16_000_000;
const MAX_STRIP_ROWS = 8_192;
const MAX_WIDTH = 16_384;
const MAX_SIDE = 32_767;
const MAX_PIXELS = 160_000_000;

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

function clearShapes(editor: Editor) {
  withoutFigmaEffects(editor, () =>
    editor.run(
      () => editor.deleteShapes([...editor.getCurrentPageShapeIds()]),
      { history: 'ignore' },
    ),
  );
}

// See apps/docs/skia-engine/tech.md §5.7.
async function renderActual(
  editor: Editor,
  job: ShotJob,
  width: number,
  height: number,
  strip: number,
) {
  const area = renderArea(job.snapshot);
  const warnings = putSnapshot(editor, job.snapshot, job.idPrefix, '', {
    mains: false,
  });
  try {
    const missing = await waitForAssets(job.snapshot, '');
    const controller = getCanvasController(editor);
    if (!controller) {
      throw new Error('截图用的画布还没准备好');
    }
    await controller.whenIdle();
    const actual = canvasOf(width, height);
    for (let y = 0; y < height; y += strip) {
      const rows = Math.min(strip, height - y);
      const pixels = await controller.exportArea(
        {
          x: area.x,
          y: area.y + y / SCALE,
          w: width / SCALE,
          h: rows / SCALE,
        },
        SCALE,
      );
      if (!pixels) {
        actual.canvas.width = 0;
        throw new Error('读不出画面的像素');
      }
      actual.ctx.putImageData(
        new ImageData(new Uint8ClampedArray(pixels), width, rows),
        0,
        y,
      );
    }
    return { actual, warnings: [...warnings, ...missing] };
  } finally {
    clearShapes(editor);
  }
}

async function analyze(editor: Editor, job: ShotJob): Promise<ShotResult> {
  const started = performance.now();
  const bitmap = await createImageBitmap(job.expected, {
    colorSpaceConversion: 'none',
  });
  try {
    const { width, height } = bitmap;
    // See apps/docs/figma-to-tldraw/tech.md §20.3.
    if (width > MAX_WIDTH || height > MAX_SIDE || width * height > MAX_PIXELS) {
      throw new Error(
        `这张图太大了（${width}×${height}），浏览器里比不动，请用本地对比脚本`,
      );
    }
    const strip = Math.max(
      1,
      Math.min(MAX_STRIP_ROWS, Math.floor(STRIP_PIXELS / width)),
    );
    const { actual, warnings } = await renderActual(
      editor,
      job,
      width,
      height,
      strip,
    );

    // See apps/docs/figma-to-tldraw/tech.md §20.3.
    const diff = canvasOf(width, height);
    const band = canvasOf(width, Math.min(height, strip + STRIP_OVERLAP * 2));
    const session = await startCompare(job.snapshot);
    let diffPixels = 0;
    let breakdown: DiffBreakdown;
    try {
      for (let y = 0; y < height; y += strip) {
        const rows = Math.min(strip, height - y);
        const y0 = Math.max(0, y - STRIP_OVERLAP);
        const y1 = Math.min(height, y + rows + STRIP_OVERLAP);
        band.ctx.fillRect(0, 0, width, y1 - y0);
        band.ctx.drawImage(bitmap, 0, y0, width, y1 - y0, 0, 0, width, y1 - y0);
        const out = await session.strip({
          expected: band.ctx.getImageData(0, 0, width, y1 - y0).data,
          actual: actual.ctx.getImageData(0, y0, width, y1 - y0).data,
          width,
          y,
          top: y - y0,
          rows,
        });
        diffPixels += out.diffPixels;
        diff.ctx.putImageData(new ImageData(out.diff, width, rows), 0, y);
      }
      breakdown = await session.finish();
    } finally {
      session.close();
      band.canvas.width = 0;
    }
    const actualPng = await toPng(actual.canvas);
    actual.canvas.width = 0;
    const diffPng = await toPng(diff.canvas);
    diff.canvas.width = 0;

    return {
      diff: (diffPixels / (width * height)) * 100,
      diffPixels,
      breakdown,
      warnings,
      actual: actualPng,
      diffImage: diffPng,
      ms: Math.round(performance.now() - started),
    };
  } finally {
    bitmap.close();
  }
}

/** A hidden canvas that renders one case at a time in screenshot mode. */
export function ShotStageHost({
  onReady,
}: {
  onReady: (stage: ShotStage | null) => void;
}) {
  useEffect(() => () => onReady(null), [onReady]);

  function handleMount(editor: Editor) {
    const stop = startFigmaEditing(editor);
    onReady({ analyze: (job) => analyze(editor, job) });
    return stop;
  }

  return (
    <div
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
        renderMode="direct"
        background="#ffffff"
        onMount={handleMount}
      />
    </div>
  );
}
