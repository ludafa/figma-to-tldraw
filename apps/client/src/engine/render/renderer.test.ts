import type { CanvasKit } from 'canvaskit-wasm';
import { describe, expect, it } from 'vitest';

import { Editor } from '../editor';
import { Box, Rectangle2d } from '../geometry';
import { ShapeUtil } from '../shape-util';
import { createShapeId, type TLShape, type TLShapeId } from '../types';
import { easeInOut, SceneRenderer } from './renderer';
import type { Resources } from './resources';

describe('easeInOut', () => {
  it('matches CSS ease-in-out at the ends and the middle', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 5);
  });

  it('starts and ends slowly, and is symmetric', () => {
    expect(easeInOut(0.1)).toBeLessThan(0.1);
    expect(easeInOut(0.9)).toBeGreaterThan(0.9);
    for (const t of [0.1, 0.25, 0.4]) {
      expect(easeInOut(t) + easeInOut(1 - t)).toBeCloseTo(1, 5);
    }
  });

  it('only goes forward', () => {
    let prev = 0;
    for (let i = 1; i <= 100; i++) {
      const v = easeInOut(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

type BoxShape = TLShape & { props: { w: number; h: number } };

class BoxUtil extends ShapeUtil<BoxShape> {
  static override type = 'box';
  getDefaultProps() {
    return { w: 10, h: 10 };
  }
  getGeometry(shape: BoxShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }
  paint() {}
}

function scene() {
  const editor = new Editor({
    shapeUtils: [BoxUtil],
    tools: [],
    getContainer: () => ({}) as HTMLElement,
  });
  const ck = {
    Paint: class {
      delete() {}
    },
  } as unknown as CanvasKit;
  const renderer = new SceneRenderer(editor, {} as Resources, ck);
  const parent = createShapeId();
  const child = createShapeId();
  editor.createShapes([
    { id: parent, type: 'box', x: 0, y: 0, props: { w: 400, h: 400 } },
    { id: child, type: 'box', parentId: parent, x: 10, y: 10 },
  ]);
  // Painting caches page bounds like this.
  renderer.getSubtreePageBounds(parent);
  renderer.getSubtreePageBounds(child);
  renderer.takeDirtyAreas();
  return { editor, renderer, parent, child };
}

function covers(areas: Box[], box: Box) {
  return areas.some((a) => Box.Contains(a, box));
}

describe('SceneRenderer dirty areas', () => {
  it('cover the whole old tree when it is deleted children first', () => {
    const { editor, renderer, parent } = scene();
    editor.deleteShapes([parent]);
    expect(covers(renderer.takeDirtyAreas(), new Box(0, 0, 400, 400))).toBe(
      true,
    );
  });

  it('keep the old parent bounds after a child changed first', () => {
    const { editor, renderer, parent, child } = scene();
    editor.updateShapes([
      { id: child as TLShapeId, type: 'box', x: 20 },
      { id: parent, type: 'box', props: { w: 100, h: 100 } },
    ]);
    expect(covers(renderer.takeDirtyAreas(), new Box(0, 0, 400, 400))).toBe(
      true,
    );
  });
});
