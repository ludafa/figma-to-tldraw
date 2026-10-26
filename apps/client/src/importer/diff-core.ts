import pixelmatch from 'pixelmatch';

import { attributeDiff, type DiffBreakdown } from '../figma/diff-attribution';
import type { Snapshot } from '../figma/types';

// See apps/docs/figma-to-tldraw/tech.md §19.3.

export const SCALE = 2;

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

export function compareImages(input: DiffInput): DiffOutput {
  const { expected, actual, width, height, snapshot } = input;
  const diff = new Uint8ClampedArray(width * height * 4);
  const diffPixels = pixelmatch(expected, actual, diff, width, height, {
    threshold: 0.1,
  });
  const breakdown = attributeDiff(
    snapshot,
    { width, height, data: new Uint8Array(diff.buffer) },
    SCALE,
  );
  return { diffPixels, diff, breakdown };
}
