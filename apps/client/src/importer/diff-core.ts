import pixelmatch from 'pixelmatch';

import {
  type Attribution,
  createAttribution,
  type DiffBreakdown,
} from '../figma/diff-attribution';
import type { Snapshot } from '../figma/types';

// See apps/docs/figma-to-tldraw/tech.md §19.3.

export const SCALE = 2;
/** Extra rows read above and below each strip. */
export const STRIP_OVERLAP = 2;

export interface DiffInput {
  expected: Uint8ClampedArray<ArrayBuffer>;
  actual: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
  snapshot: Snapshot;
}

export interface DiffOutput {
  diffPixels: number;
  diff: Uint8ClampedArray<ArrayBuffer>;
  breakdown: DiffBreakdown;
}

/**
 * Rows `y` to `y + rows` of both images, read with up to STRIP_OVERLAP extra
 * rows on each side; `top` is how many extra rows come first.
 */
export interface StripInput {
  expected: Uint8ClampedArray<ArrayBuffer>;
  actual: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  y: number;
  top: number;
  rows: number;
}

export interface StripOutput {
  diffPixels: number;
  /** The diff of rows `y` to `y + rows` only. */
  diff: Uint8ClampedArray<ArrayBuffer>;
}

const isDiff = (d: Uint8ClampedArray, i: number) =>
  d[i] === 255 && d[i + 1] === 0 && d[i + 2] === 0;

// See apps/docs/figma-to-tldraw/tech.md §20.3.
export function compareStrip(
  input: StripInput,
  attribution: Attribution,
): StripOutput {
  const { expected, actual, width, y, top, rows } = input;
  const height = expected.length / 4 / width;
  const full = new Uint8ClampedArray(width * height * 4);
  pixelmatch(expected, actual, full, width, height, { threshold: 0.1 });
  const diff = full.slice(top * width * 4, (top + rows) * width * 4);
  let diffPixels = 0;
  for (let i = 0; i < diff.length; i += 4) {
    if (isDiff(diff, i)) {
      diffPixels++;
    }
  }
  attribution.add(
    { width, height: rows, data: new Uint8Array(diff.buffer) },
    y,
  );
  return { diffPixels, diff };
}

export function compareImages(input: DiffInput): DiffOutput {
  const { expected, actual, width, height, snapshot } = input;
  const attribution = createAttribution(snapshot, SCALE);
  const { diffPixels, diff } = compareStrip(
    { expected, actual, width, y: 0, top: 0, rows: height },
    attribution,
  );
  return { diffPixels, diff, breakdown: attribution.result() };
}
