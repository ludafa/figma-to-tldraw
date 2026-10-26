import { describe, expect, it } from 'vitest';

import type { FigmaNode, Snapshot } from '../figma/types';
import { compareImages } from './diff-core';

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
