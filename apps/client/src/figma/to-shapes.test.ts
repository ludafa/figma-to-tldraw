import { describe, expect, it } from 'vitest';

import { fromRotation } from './matrix';
import { shapeIdFor, snapshotToShapes } from './to-shapes';
import type { FigmaNode, Snapshot } from './types';

function box(x: number, y: number, width: number, height: number) {
  return { x, y, width, height };
}

function snapshot(
  document: FigmaNode,
  extra: Partial<Snapshot> = {},
): Snapshot {
  return {
    meta: {
      name: 'test',
      nodeId: document.id,
      type: document.type,
      width: 400,
      height: 300,
      expectedScale: 2,
      fonts: [],
      images: {},
      warnings: [],
    },
    rest: { document },
    svgs: {},
    ...extra,
  };
}

const opts = { idPrefix: 't', assetBase: '/cases/t/' };

describe('snapshotToShapes', () => {
  it('puts the root at the origin and children relative to their parent', () => {
    const doc: FigmaNode = {
      id: '1:1',
      name: 'root',
      type: 'FRAME',
      absoluteBoundingBox: box(1000, 500, 400, 300),
      children: [
        {
          id: '1:2',
          name: 'inner',
          type: 'FRAME',
          absoluteBoundingBox: box(1020, 530, 200, 100),
          children: [
            {
              id: '1:3',
              name: 'rect',
              type: 'RECTANGLE',
              absoluteBoundingBox: box(1030, 540, 50, 40),
            },
          ],
        },
      ],
    };
    const { shapes } = snapshotToShapes(snapshot(doc), opts);
    const byName = Object.fromEntries(
      shapes.map((s) => [s.props?.node?.name, s]),
    );
    expect(byName.root).toMatchObject({ x: 0, y: 0 });
    expect(byName.root.parentId).toBeUndefined();
    expect(byName.inner).toMatchObject({
      x: 20,
      y: 30,
      parentId: shapeIdFor('t', '1:1'),
    });
    expect(byName.rect).toMatchObject({
      x: 10,
      y: 10,
      parentId: shapeIdFor('t', '1:2'),
      props: { w: 50, h: 40 },
    });
  });

  it('uses absolute transforms for rotated nodes', () => {
    const doc: FigmaNode = {
      id: '1:1',
      name: 'root',
      type: 'FRAME',
      children: [
        {
          id: '1:2',
          name: 'rotated',
          type: 'FRAME',
          children: [{ id: '1:3', name: 'child', type: 'RECTANGLE' }],
        },
      ],
    };
    const angle = Math.PI / 6;
    const rotated = fromRotation(150, 100, angle);
    const child = fromRotation(0, 0, angle);
    child[0][2] = rotated[0][0] * 10 + rotated[0][1] * 20 + rotated[0][2];
    child[1][2] = rotated[1][0] * 10 + rotated[1][1] * 20 + rotated[1][2];
    const { shapes } = snapshotToShapes(
      snapshot(doc, {
        transforms: {
          '1:1': { m: fromRotation(100, 100, 0), w: 400, h: 300 },
          '1:2': { m: rotated, w: 120, h: 80 },
          '1:3': { m: child, w: 30, h: 30 },
        },
      }),
      opts,
    );
    const [root, frame, rect] = shapes;
    expect(root).toMatchObject({ x: 0, y: 0, rotation: 0 });
    expect(frame.x).toBeCloseTo(50);
    expect(frame.y).toBeCloseTo(0);
    expect(frame.rotation).toBeCloseTo(angle);
    expect(frame.props).toMatchObject({ w: 120, h: 80 });
    expect(rect.x).toBeCloseTo(10);
    expect(rect.y).toBeCloseTo(20);
    expect(rect.rotation).toBeCloseTo(0);
  });

  it('skips hidden nodes and their children', () => {
    const doc: FigmaNode = {
      id: '1:1',
      name: 'root',
      type: 'FRAME',
      absoluteBoundingBox: box(0, 0, 100, 100),
      children: [
        {
          id: '1:2',
          name: 'hidden',
          type: 'GROUP',
          visible: false,
          absoluteBoundingBox: box(0, 0, 10, 10),
          children: [
            {
              id: '1:3',
              name: 'inside hidden',
              type: 'RECTANGLE',
              absoluteBoundingBox: box(0, 0, 10, 10),
            },
          ],
        },
        {
          id: '1:4',
          name: 'shown',
          type: 'RECTANGLE',
          absoluteBoundingBox: box(0, 0, 10, 10),
        },
      ],
    };
    const { shapes } = snapshotToShapes(snapshot(doc), opts);
    expect(shapes.map((s) => s.props?.node?.name)).toEqual(['root', 'shown']);
  });

  it('skips vectors that render nothing without a warning', () => {
    const doc: FigmaNode = {
      id: '1:1',
      name: 'root',
      type: 'FRAME',
      clipsContent: true,
      absoluteBoundingBox: box(0, 0, 100, 100),
      children: [
        {
          id: '1:2',
          name: 'clipped out',
          type: 'VECTOR',
          absoluteBoundingBox: box(200, 0, 10, 10),
          absoluteRenderBounds: null,
        },
      ],
    };
    const { shapes, warnings } = snapshotToShapes(snapshot(doc), opts);
    expect(shapes).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it('orders siblings bottom-to-top like Figma', () => {
    const doc: FigmaNode = {
      id: '1:1',
      name: 'root',
      type: 'FRAME',
      absoluteBoundingBox: box(0, 0, 100, 100),
      children: ['a', 'b', 'c'].map((name, i) => ({
        id: `1:${i + 2}`,
        name,
        type: 'RECTANGLE',
        absoluteBoundingBox: box(0, 0, 10, 10),
      })),
    };
    const { shapes } = snapshotToShapes(snapshot(doc), opts);
    const indices = shapes.slice(1).map((s) => s.index as string);
    expect([...indices].sort()).toEqual(indices);
    expect(new Set(indices).size).toBe(3);
  });

  it('puts the first child on top when auto layout stacks first on top', () => {
    const doc: FigmaNode = {
      id: '1:1',
      name: 'root',
      type: 'FRAME',
      itemReverseZIndex: true,
      absoluteBoundingBox: box(0, 0, 100, 100),
      children: ['a', 'b', 'c'].map((name, i) => ({
        id: `1:${i + 2}`,
        name,
        type: 'RECTANGLE',
        absoluteBoundingBox: box(0, 0, 10, 10),
      })),
    };
    const { shapes } = snapshotToShapes(snapshot(doc), opts);
    const bottomToTop = shapes
      .slice(1)
      .sort((x, y) => ((x.index as string) < (y.index as string) ? -1 : 1))
      .map((s) => (s.props as { node: FigmaNode }).node.name);
    expect(bottomToTop).toEqual(['c', 'b', 'a']);
  });

  it('warns about unsupported node types', () => {
    const doc: FigmaNode = {
      id: '1:1',
      name: 'root',
      type: 'FRAME',
      absoluteBoundingBox: box(0, 0, 100, 100),
      children: [
        {
          id: '1:2',
          name: 'sticky',
          type: 'STICKY',
          absoluteBoundingBox: box(0, 0, 10, 10),
        },
      ],
    };
    const { shapes, warnings } = snapshotToShapes(snapshot(doc), opts);
    expect(shapes).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('STICKY');
  });

  it('places vectors at their render bounds, keeps their opacity in the SVG and masks later siblings', () => {
    const doc: FigmaNode = {
      id: '1:1',
      name: 'root',
      type: 'FRAME',
      absoluteBoundingBox: box(0, 0, 100, 100),
      children: [
        {
          id: '1:2',
          name: 'mask',
          type: 'ELLIPSE',
          isMask: true,
          absoluteBoundingBox: box(10, 10, 50, 50),
        },
        {
          id: '1:3',
          name: 'icon',
          type: 'VECTOR',
          opacity: 0.5,
          absoluteBoundingBox: box(20, 20, 30, 30),
          absoluteRenderBounds: box(19, 19, 32, 32),
        },
      ],
    };
    const { shapes } = snapshotToShapes(
      snapshot(doc, {
        svgs: { '1:3': '<svg width="32" height="32" viewBox="0 0 32 32"/>' },
        meta: {
          ...snapshot(doc).meta,
          masks: { '1:2': 'M0 0L50 0L50 50Z' },
        },
      }),
      opts,
    );
    const [, mask, icon] = shapes;
    expect(mask).toMatchObject({
      type: 'figma-rect',
      props: { mask: '', maskPath: 'M0 0L50 0L50 50Z', svg: '' },
    });
    expect(icon).toMatchObject({
      type: 'figma-vector',
      x: 19,
      y: 19,
      opacity: 1,
      props: { w: 32, h: 32, mask: shapeIdFor('t', '1:2') },
    });
  });
});
