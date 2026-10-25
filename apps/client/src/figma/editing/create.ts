import {
  createShapeId,
  type Editor,
  type TLShapeId,
  type VecLike,
} from 'tldraw';

import { isFigmaShape } from '../clip';
import type { FigmaShape, FigmaShapeType } from '../shape-types';
import type { FigmaNode, FigmaPaint } from '../types';
import { isAutoLayout } from './auto-layout';
import { flowIndex, isGroup } from './engine';
import { figmaParent } from './host';
import { isInsideInstance } from './instances';
import { autoLineHeight } from './panel-ops';

// See apps/docs/figma-to-tldraw/tech.md §14.1.

export type NewLayerKind = 'FRAME' | 'RECTANGLE' | 'ELLIPSE' | 'TEXT';

const SHAPE_TYPES: Record<NewLayerKind, FigmaShapeType> = {
  FRAME: 'figma-frame',
  RECTANGLE: 'figma-rect',
  ELLIPSE: 'figma-rect',
  TEXT: 'figma-text',
};

const NAMES: Record<NewLayerKind, string> = {
  FRAME: 'Frame',
  RECTANGLE: 'Rectangle',
  ELLIPSE: 'Ellipse',
  TEXT: 'Text',
};

export const DEFAULT_SIZE = 100;

function solid(v: number): FigmaPaint {
  return {
    blendMode: 'NORMAL',
    type: 'SOLID',
    color: { r: v, g: v, b: v, a: 1 },
  };
}

function nextName(editor: Editor, base: string): string {
  const pattern = new RegExp(`^${base} (\\d+)$`);
  let max = 0;
  for (const shape of editor.getCurrentPageShapes()) {
    const match = isFigmaShape(shape) && pattern.exec(shape.props.node.name);
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }
  return `${base} ${max + 1}`;
}

export function newNode(
  editor: Editor,
  kind: NewLayerKind,
  id: string,
): FigmaNode {
  const base: FigmaNode = {
    id,
    name: kind === 'TEXT' ? '' : nextName(editor, NAMES[kind]),
    type: kind,
    blendMode: 'PASS_THROUGH',
    strokes: [],
    strokeWeight: 1,
    strokeAlign: 'INSIDE',
    effects: [],
    constraints: { horizontal: 'LEFT', vertical: 'TOP' },
    layoutSizingHorizontal: 'FIXED',
    layoutSizingVertical: 'FIXED',
  };
  if (kind === 'FRAME') {
    return { ...base, clipsContent: true, fills: [solid(1)] };
  }
  if (kind !== 'TEXT') {
    return { ...base, fills: [solid(0xd9 / 255)] };
  }
  const style: FigmaNode['style'] = {
    fontFamily: 'Inter',
    fontPostScriptName: null,
    fontStyle: 'Regular',
    fontWeight: 400,
    fontSize: 12,
    textAutoResize: 'WIDTH_AND_HEIGHT',
    textAlignHorizontal: 'LEFT',
    textAlignVertical: 'TOP',
    letterSpacing: 0,
    lineHeightPercent: 100,
    lineHeightUnit: 'INTRINSIC_%',
  };
  return {
    ...base,
    autoRename: true,
    fills: [solid(0)],
    strokeAlign: 'OUTSIDE',
    characters: '',
    characterStyleOverrides: [],
    styleOverrideTable: {},
    style: { ...style, lineHeightPx: autoLineHeight(style) },
    layoutSizingHorizontal: 'HUG',
    layoutSizingVertical: 'HUG',
  };
}

function clippedAway(
  editor: Editor,
  frame: FigmaShape,
  point: VecLike,
): boolean {
  return editor
    .getShapeAncestors(frame)
    .some(
      (a) =>
        isFigmaShape(a) &&
        a.props.node.clipsContent &&
        !editor.isPointInShape(a, point, { hitInside: true, margin: 0 }),
    );
}

/** The frame a layer drawn at `point` goes into: the topmost one under it. */
export function dropTarget(
  editor: Editor,
  point: VecLike,
): FigmaShape | undefined {
  const shapes = editor.getCurrentPageShapesSorted();
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i];
    if (
      isFigmaShape(shape) &&
      shape.type === 'figma-frame' &&
      !isGroup(shape) &&
      // See apps/docs/figma-to-tldraw/tech.md §16.4.
      shape.props.node.type !== 'INSTANCE' &&
      !isInsideInstance(editor, shape) &&
      !editor.isShapeHidden(shape) &&
      editor.isPointInShape(shape, point, { hitInside: true, margin: 0 }) &&
      !clippedAway(editor, shape, point)
    ) {
      return shape;
    }
  }
  return undefined;
}

/**
 * Creates a layer with its top left corner at `point` (page space). Inside
 * auto layout it stays where it is drawn until `finishLayer`.
 */
export function createLayer(
  editor: Editor,
  kind: NewLayerKind,
  point: VecLike,
  size: { w: number; h: number },
): TLShapeId {
  const id = createShapeId();
  const parent = dropTarget(editor, point);
  const local = parent ? editor.getPointInShapeSpace(parent, point) : point;
  let node = newNode(editor, kind, id.replace('shape:', 'new:'));
  if (parent && isAutoLayout(parent.props.node)) {
    node = { ...node, layoutPositioning: 'ABSOLUTE' };
  }
  editor.createShape<FigmaShape>({
    id,
    type: SHAPE_TYPES[kind],
    parentId: parent?.id ?? editor.getCurrentPageId(),
    x: local.x,
    y: local.y,
    rotation: parent ? -editor.getShapePageTransform(parent).rotation() : 0,
    props: {
      w: size.w,
      h: kind === 'TEXT' ? (node.style?.lineHeightPx ?? size.h) : size.h,
      node,
      svg: '',
      images: {},
      imageSizes: {},
      mask: '',
      maskPath: '',
      flipX: false,
    },
  });
  return id;
}

/** A layer drawn into auto layout joins the flow at the place it was drawn. */
export function finishLayer(editor: Editor, id: TLShapeId) {
  const shape = editor.getShape(id);
  if (!isFigmaShape(shape)) {
    return;
  }
  const parent = figmaParent(editor, shape);
  if (
    !parent ||
    !isAutoLayout(parent.props.node) ||
    shape.props.node.layoutPositioning !== 'ABSOLUTE'
  ) {
    return;
  }
  const { layoutPositioning: _absolute, ...node } = shape.props.node;
  editor.updateShape<FigmaShape>({
    id,
    type: shape.type,
    index: flowIndex(editor, parent, shape),
    props: { node },
  });
}
