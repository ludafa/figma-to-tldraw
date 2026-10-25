import type { Editor, TLShapeId, TLShapePartial } from 'tldraw';

import { isFigmaShape } from '../clip';
import type { FigmaShape } from '../shape-types';
import { svgSize } from '../to-shapes';
import type { Box, LayoutHost } from './auto-layout';

// See apps/docs/figma-to-tldraw/tech.md §13.1.

interface Placed {
  type: FigmaShape['type'];
  x: number;
  y: number;
  rotation: number;
  props: FigmaShape['props'];
}

/** A vector's layout rectangle inside the shape, which is drawn at its render bounds. */
function vectorRect(shape: Placed) {
  const { node, svg, w, h } = shape.props;
  const bb = node.absoluteBoundingBox;
  const rb = node.absoluteRenderBounds;
  if (shape.type !== 'figma-vector' || node.isMask || !bb || !rb) {
    return undefined;
  }
  const base = svgSize(svg) ?? { w: rb.width, h: rb.height };
  const sx = base.w > 0 ? w / base.w : 1;
  const sy = base.h > 0 ? h / base.h : 1;
  return {
    dx: (bb.x - rb.x) * sx,
    dy: (bb.y - rb.y) * sy,
    w: bb.width * sx,
    h: bb.height * sy,
    base,
    bb,
  };
}

function layoutRect(shape: Placed) {
  const v = vectorRect(shape);
  return v
    ? { dx: v.dx, dy: v.dy, w: v.w, h: v.h }
    : { dx: 0, dy: 0, w: shape.props.w, h: shape.props.h };
}

export function isRigid(shape: { rotation: number }): boolean {
  return Math.abs(Math.sin(shape.rotation)) > 1e-6;
}

export function layoutBox(shape: Placed): Box {
  const r = layoutRect(shape);
  const cos = Math.cos(shape.rotation);
  const sin = Math.sin(shape.rotation);
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [px, py] of [
    [r.dx, r.dy],
    [r.dx + r.w, r.dy],
    [r.dx, r.dy + r.h],
    [r.dx + r.w, r.dy + r.h],
  ]) {
    xs.push(shape.x + px * cos - py * sin);
    ys.push(shape.y + px * sin + py * cos);
  }
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** The update that puts a layer's layout box at `box` (rotated layers only move). */
export function placeBox(
  shape: FigmaShape,
  box: Box,
): TLShapePartial<FigmaShape> {
  let { w, h } = shape.props;
  if (!isRigid(shape)) {
    const v = vectorRect(shape);
    if (v) {
      w = v.bb.width > 0 ? (v.base.w * box.w) / v.bb.width : w;
      h = v.bb.height > 0 ? (v.base.h * box.h) / v.bb.height : h;
    } else {
      w = box.w;
      h = box.h;
    }
  }
  const now = layoutBox({ ...shape, props: { ...shape.props, w, h } });
  return {
    id: shape.id,
    type: shape.type,
    x: shape.x + box.x - now.x,
    y: shape.y + box.y - now.y,
    props: { w, h },
  };
}

export function figmaChildren(editor: Editor, id: TLShapeId): FigmaShape[] {
  const parent = editor.getShape(id);
  const kids = editor
    .getSortedChildIdsForParent(id)
    .map((child) => editor.getShape(child))
    .filter(isFigmaShape);
  // See apps/docs/figma-to-tldraw/tech.md §4.3.
  return isFigmaShape(parent) && parent.props.node.itemReverseZIndex
    ? kids.reverse()
    : kids;
}

export function figmaParent(
  editor: Editor,
  shape: { parentId: string },
): FigmaShape | undefined {
  const parent = editor.getShape(shape.parentId as TLShapeId);
  return isFigmaShape(parent) ? parent : undefined;
}

export function tldrawLayoutHost(editor: Editor): LayoutHost<TLShapeId> {
  const shape = (id: TLShapeId) => editor.getShape(id) as FigmaShape;
  return {
    node: (id) => shape(id).props.node,
    parent: (id) => figmaParent(editor, shape(id))?.id,
    children: (id) => figmaChildren(editor, id).map((s) => s.id),
    size: (id) => {
      const r = layoutRect(shape(id));
      return { w: r.w, h: r.h };
    },
    setSize: (id, w, h) => {
      editor.updateShape<FigmaShape>({
        id,
        type: shape(id).type,
        props: { w, h },
      });
    },
    box: (id) => layoutBox(shape(id)),
    rigid: (id) => isRigid(shape(id)),
    setBox: (id, box) => {
      editor.updateShape<FigmaShape>(placeBox(shape(id), box));
    },
  };
}
