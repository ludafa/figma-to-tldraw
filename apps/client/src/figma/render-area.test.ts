import { describe, expect, it } from 'vitest';

import { renderArea } from './render-area';
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
      height: 80,
      expectedScale: 2,
      fonts: [],
      images: {},
      warnings: [],
    },
    rest: { document },
    svgs: {},
  };
}

describe('renderArea', () => {
  it('covers what is drawn outside a frame', () => {
    const area = renderArea(
      snapshot({
        id: '1:1',
        name: 'frame',
        type: 'FRAME',
        absoluteBoundingBox: box(10, 20, 100, 80),
        absoluteRenderBounds: box(8, 20, 104, 200),
      }),
    );
    expect(area).toEqual({ x: -2, y: 0, width: 104, height: 200 });
  });

  it('adds the margin Figma exports around a section', () => {
    const area = renderArea(
      snapshot({
        id: '1:185',
        name: 'Section 2',
        type: 'SECTION',
        absoluteBoundingBox: box(1329, -100, 500, 400),
        absoluteRenderBounds: box(1329, -100, 1289, 912),
      }),
    );
    expect(area).toEqual({ x: -40, y: -40, width: 1369, height: 992 });
  });

  it('falls back to the case size without bounds', () => {
    const area = renderArea(
      snapshot({ id: '1:1', name: 'section', type: 'SECTION' }),
    );
    expect(area).toEqual({ x: -40, y: -40, width: 180, height: 160 });
  });
});
