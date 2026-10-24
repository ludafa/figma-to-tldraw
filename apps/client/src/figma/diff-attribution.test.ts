import { describe, expect, it } from 'vitest';

import { attributeDiff, type DiffImage } from './diff-attribution';
import type { FigmaNode, Snapshot } from './types';

function box(x: number, y: number, width: number, height: number) {
  return { x, y, width, height };
}

function snapshot(document: FigmaNode): Snapshot {
  return {
    meta: {
      name: 'test',
      nodeId: document.id,
      type: document.type,
      width: 100,
      height: 100,
      expectedScale: 2,
      fonts: [],
      images: {},
      warnings: [],
    },
    rest: { document },
    svgs: {},
  };
}

function diffImage(
  width: number,
  height: number,
  red: [number, number, number, number][],
): DiffImage {
  const data = new Uint8Array(width * height * 4).fill(240);
  for (const [x0, y0, w, h] of red) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const i = (y * width + x) * 4;
        data.set([255, 0, 0, 255], i);
      }
    }
  }
  return { width, height, data };
}

describe('attributeDiff', () => {
  it('counts each red pixel for the topmost node under it', () => {
    const doc: FigmaNode = {
      id: '1:1',
      name: 'root',
      type: 'FRAME',
      absoluteBoundingBox: box(1000, 1000, 100, 100),
      children: [
        {
          id: '1:2',
          name: 'card',
          type: 'RECTANGLE',
          fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 } }],
          absoluteBoundingBox: box(1000, 1000, 50, 50),
        },
        {
          id: '1:3',
          name: 'title',
          type: 'TEXT',
          characters: 'Hello',
          style: { fontFamily: 'Inter', fontWeight: 700 },
          absoluteBoundingBox: box(1010, 1010, 20, 10),
        },
        {
          id: '1:4',
          name: 'icon',
          type: 'VECTOR',
          absoluteBoundingBox: box(1060, 1060, 10, 10),
        },
      ],
    };
    // Scale 2: the text covers diff pixels 20..60 × 20..40.
    const diff = diffImage(200, 200, [
      [20, 20, 10, 10],
      [0, 0, 4, 1],
      [120, 120, 2, 2],
      [180, 180, 1, 1],
    ]);
    const { byKind, nodes } = attributeDiff(snapshot(doc), diff, 2);
    expect(byKind).toEqual({ text: 100, shape: 5, vector: 4, image: 0 });
    expect(nodes.map((n) => [n.name, n.pixels])).toEqual([
      ['title', 100],
      ['card', 4],
      ['icon', 4],
      ['root', 1],
    ]);
    expect(nodes[0]).toMatchObject({
      kind: 'text',
      text: 'Hello',
      font: 'Inter 700',
      box: box(10, 10, 20, 10),
    });
  });

  it('clips children to frames that clip content and follows First on top', () => {
    const doc: FigmaNode = {
      id: '1:1',
      name: 'root',
      type: 'FRAME',
      absoluteBoundingBox: box(0, 0, 100, 100),
      children: [
        {
          id: '1:2',
          name: 'clip',
          type: 'FRAME',
          clipsContent: true,
          itemReverseZIndex: true,
          absoluteBoundingBox: box(0, 0, 50, 50),
          children: [
            {
              id: '1:3',
              name: 'photo',
              type: 'RECTANGLE',
              fills: [{ type: 'IMAGE', imageRef: 'a' }],
              absoluteBoundingBox: box(0, 0, 80, 80),
            },
            {
              id: '1:4',
              name: 'behind',
              type: 'RECTANGLE',
              absoluteBoundingBox: box(0, 0, 80, 80),
            },
          ],
        },
      ],
    };
    const diff = diffImage(100, 100, [
      [10, 10, 1, 1],
      [70, 70, 1, 1],
    ]);
    const { nodes } = attributeDiff(snapshot(doc), diff, 1);
    expect(nodes.map((n) => [n.name, n.kind, n.pixels])).toEqual([
      ['root', 'shape', 1],
      ['photo', 'image', 1],
    ]);
    expect(nodes[1].box).toEqual(box(0, 0, 50, 50));
  });

  it('lets content show through translucent overlays, outlines and empty frames', () => {
    const doc: FigmaNode = {
      id: '1:1',
      name: 'root',
      type: 'FRAME',
      absoluteBoundingBox: box(0, 0, 100, 100),
      children: [
        {
          id: '1:2',
          name: 'label',
          type: 'TEXT',
          absoluteBoundingBox: box(0, 0, 40, 20),
        },
        {
          id: '1:3',
          name: 'fade',
          type: 'RECTANGLE',
          fills: [
            {
              type: 'GRADIENT_LINEAR',
              gradientStops: [
                { position: 0, color: { r: 0, g: 0, b: 0, a: 0 } },
                { position: 1, color: { r: 0, g: 0, b: 0, a: 1 } },
              ],
            },
          ],
          absoluteBoundingBox: box(0, 0, 100, 50),
        },
        {
          id: '1:4',
          name: 'outline',
          type: 'RECTANGLE',
          strokes: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 } }],
          strokeWeight: 2,
          absoluteBoundingBox: box(50, 60, 40, 30),
        },
        {
          id: '1:5',
          name: 'wrapper',
          type: 'FRAME',
          absoluteBoundingBox: box(0, 60, 40, 40),
        },
      ],
    };
    const diff = diffImage(100, 100, [
      [10, 10, 1, 1],
      [70, 75, 1, 1],
      [50, 60, 1, 1],
      [10, 70, 1, 1],
    ]);
    const { nodes } = attributeDiff(snapshot(doc), diff, 1);
    expect(nodes.map((n) => [n.name, n.pixels])).toEqual([
      ['root', 2],
      ['label', 1],
      ['outline', 1],
    ]);
  });
});
