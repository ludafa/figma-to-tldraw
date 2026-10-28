import { describe, expect, it } from 'vitest';

import { createAttribution } from '../figma/diff-attribution';
import type { FigmaNode, Snapshot } from '../figma/types';
import { compareImages, compareStrip, SCALE, STRIP_OVERLAP } from './diff-core';

const root: FigmaNode = {
  id: '1:1',
  name: 'root',
  type: 'FRAME',
  absoluteBoundingBox: { x: 0, y: 0, width: 2, height: 2 },
  absoluteRenderBounds: { x: 0, y: 0, width: 2, height: 2 },
  fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
  children: [],
} as unknown as FigmaNode;

const snapshot = {
  meta: { width: 2, height: 2, images: {}, fonts: [], warnings: [] },
  rest: { document: root },
  svgs: {},
} as unknown as Snapshot;

function image(paint: (x: number, y: number) => number[]) {
  const data = new Uint8ClampedArray(4 * 4 * 4);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      data.set(paint(x, y), (y * 4 + x) * 4);
    }
  }
  return data;
}

const white = () => [255, 255, 255, 255];

describe('compareImages', () => {
  it('finds no difference between equal images', () => {
    const out = compareImages({
      expected: image(white),
      actual: image(white),
      width: 4,
      height: 4,
      snapshot,
    });
    expect(out.diffPixels).toBe(0);
    expect(out.breakdown.nodes).toEqual([]);
  });

  it('counts different pixels and blames the node under them', () => {
    const out = compareImages({
      expected: image(white),
      actual: image((x, y) => (x === 1 && y === 2 ? [0, 0, 0, 255] : white())),
      width: 4,
      height: 4,
      snapshot,
    });
    expect(out.diffPixels).toBe(1);
    expect(out.breakdown.byKind.shape).toBe(1);
    expect(out.breakdown.nodes[0]?.id).toBe('1:1');
  });
});

describe('compareStrip', () => {
  const width = 12;
  const height = 20;
  // A soft-edged disc in one image and a hard-edged, shifted one in the other:
  // both real differences and anti-aliased pixels, across strip boundaries.
  const disc = (cx: number, cy: number, soft: boolean) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const d = Math.hypot(x - cx, y - cy) - 5;
        const v = soft
          ? Math.round(255 * Math.min(1, Math.max(0, d)))
          : d > 0
            ? 255
            : 0;
        data.set([v, v, v, 255], (y * width + x) * 4);
      }
    }
    return data;
  };

  it('gives the same diff in strips as on the whole image', () => {
    const expected = disc(5.5, 9.5, true);
    const actual = disc(6, 10, false);
    const doc = {
      ...root,
      absoluteBoundingBox: { x: 0, y: 0, width: 6, height: 10 },
      absoluteRenderBounds: { x: 0, y: 0, width: 6, height: 10 },
    } as unknown as FigmaNode;
    const snap = {
      ...snapshot,
      rest: { document: doc },
    } as unknown as Snapshot;
    const whole = compareImages({
      expected: expected.slice(),
      actual: actual.slice(),
      width,
      height,
      snapshot: snap,
    });

    const attribution = createAttribution(snap, SCALE);
    const diff = new Uint8ClampedArray(width * height * 4);
    let diffPixels = 0;
    for (let y = 0; y < height; y += 3) {
      const rows = Math.min(3, height - y);
      const y0 = Math.max(0, y - STRIP_OVERLAP);
      const y1 = Math.min(height, y + rows + STRIP_OVERLAP);
      const out = compareStrip(
        {
          expected: expected.slice(y0 * width * 4, y1 * width * 4),
          actual: actual.slice(y0 * width * 4, y1 * width * 4),
          width,
          y,
          top: y - y0,
          rows,
        },
        attribution,
      );
      diffPixels += out.diffPixels;
      diff.set(out.diff, y * width * 4);
    }

    expect(whole.diffPixels).toBeGreaterThan(0);
    expect(diffPixels).toBe(whole.diffPixels);
    expect(diff).toEqual(whole.diff);
    expect(attribution.result()).toEqual(whole.breakdown);
  });
});
