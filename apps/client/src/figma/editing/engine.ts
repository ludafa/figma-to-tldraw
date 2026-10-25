import {
  type Editor,
  getIndexBetween,
  type IndexKey,
  resizeBox,
  type TLResizeInfo,
  type TLShape,
  type TLShapeId,
  type TLShapePartial,
} from 'tldraw';

import { isFigmaShape } from '../clip';
import type { FigmaShape } from '../shape-types';
import type { FigmaLayoutSizing, FigmaNode } from '../types';
import {
  type Axis,
  axisSizing,
  inFlow,
  isAutoLayout,
  relayout,
} from './auto-layout';
import { constrain } from './constraints';
import {
  figmaChildren,
  figmaParent,
  isRigid,
  layoutBox,
  placeBox,
  tldrawLayoutHost,
} from './host';

// See apps/docs/figma-to-tldraw/tech.md §13.1 and §13.2.

export type MeasureText = (
  editor: Editor,
  node: FigmaNode,
  width: number | undefined,
  h: number,
) => { w: number; h: number };

interface EditingState {
  paused: number;
  dirty: Set<TLShapeId>;
  measure: MeasureText;
  slack: Map<TLShapeId, Slack>;
}

const STATES = new WeakMap<Editor, EditingState>();
const EPSILON = 1e-3;

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

export function isFigmaEditing(editor: Editor): boolean {
  return STATES.has(editor);
}

/** Runs `fn` without re-measuring or re-laying out anything (used on import). */
export function withoutFigmaEffects<T>(editor: Editor, fn: () => T): T {
  const state = STATES.get(editor);
  if (!state) {
    return fn();
  }
  state.paused++;
  try {
    return fn();
  } finally {
    state.paused--;
  }
}

export function isGroup(shape: FigmaShape): boolean {
  return shape.type === 'figma-frame' && shape.props.node.type === 'GROUP';
}

function textKey(node: FigmaNode): string {
  const { fills: _fills, ...style } = node.style ?? {};
  const table = Object.entries(node.styleOverrideTable ?? {}).map(
    ([key, { fills: _f, ...rest }]) => [key, rest],
  );
  return JSON.stringify([
    node.characters,
    style,
    node.characterStyleOverrides,
    table,
  ]);
}

export function withAutoResize(
  node: FigmaNode,
  mode: NonNullable<NonNullable<FigmaNode['style']>['textAutoResize']>,
): FigmaNode {
  return {
    ...node,
    style: { ...node.style, textAutoResize: mode },
    layoutSizingHorizontal:
      node.layoutSizingHorizontal === 'FILL'
        ? 'FILL'
        : mode === 'WIDTH_AND_HEIGHT'
          ? 'HUG'
          : 'FIXED',
    layoutSizingVertical:
      node.layoutSizingVertical === 'FILL'
        ? 'FILL'
        : mode === 'NONE'
          ? 'FIXED'
          : 'HUG',
  };
}

// See apps/docs/figma-to-tldraw/tech.md §13.3.
export function fitText(editor: Editor, shape: FigmaShape) {
  const { node, w, h } = shape.props;
  const mode = node.style?.textAutoResize ?? 'NONE';
  const state = STATES.get(editor);
  if (!state || (mode !== 'WIDTH_AND_HEIGHT' && mode !== 'HEIGHT')) {
    return;
  }
  const size = state.measure(
    editor,
    node,
    mode === 'HEIGHT' ? w : undefined,
    h,
  );
  const nextW = mode === 'HEIGHT' ? w : size.w;
  if (near(nextW, w) && near(size.h, h)) {
    return;
  }
  const align = node.style?.textAlignHorizontal;
  const grow = nextW - w;
  const dx = align === 'CENTER' ? -grow / 2 : align === 'RIGHT' ? -grow : 0;
  editor.updateShape<FigmaShape>({
    id: shape.id,
    type: shape.type,
    x: shape.x + dx * Math.cos(shape.rotation),
    y: shape.y + dx * Math.sin(shape.rotation),
    props: { w: nextW, h: size.h },
  });
}

function applyConstraints(
  editor: Editor,
  frame: FigmaShape,
  from: { w: number; h: number },
) {
  const to = { w: frame.props.w, h: frame.props.h };
  const auto = isAutoLayout(frame.props.node);
  const updates: TLShapePartial<FigmaShape>[] = [];
  for (const child of figmaChildren(editor, frame.id)) {
    const { node } = child.props;
    if (auto && inFlow(node)) {
      continue;
    }
    const box = layoutBox(child);
    const next = constrain(box, node.constraints, from, to, isRigid(child));
    if (
      near(box.x, next.x) &&
      near(box.y, next.y) &&
      near(box.w, next.w) &&
      near(box.h, next.h)
    ) {
      continue;
    }
    const update = placeBox(child, next);
    if (
      child.type === 'figma-text' &&
      !near(box.w, next.w) &&
      node.style?.textAutoResize === 'WIDTH_AND_HEIGHT'
    ) {
      update.props = { ...update.props, node: withAutoResize(node, 'HEIGHT') };
    }
    updates.push(update);
  }
  if (updates.length) {
    editor.updateShapes(updates);
  }
}

interface Slack {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The union of a group's children; masked layers count as their mask. */
function contentBounds(editor: Editor, group: FigmaShape) {
  const kids = figmaChildren(editor, group.id);
  if (!kids.length) {
    return undefined;
  }
  const boxes = kids.map((k) => {
    const mask = k.props.mask
      ? editor.getShape(k.props.mask as TLShapeId)
      : undefined;
    return layoutBox(isFigmaShape(mask) ? mask : k);
  });
  return {
    kids,
    minX: Math.min(...boxes.map((b) => b.x)),
    minY: Math.min(...boxes.map((b) => b.y)),
    maxX: Math.max(...boxes.map((b) => b.x + b.w)),
    maxY: Math.max(...boxes.map((b) => b.y + b.h)),
  };
}

// See apps/docs/figma-to-tldraw/tech.md §13.1.
function measureSlack(editor: Editor, group: FigmaShape): Slack | undefined {
  const c = contentBounds(editor, group);
  return (
    c && {
      left: c.minX,
      top: c.minY,
      right: group.props.w - c.maxX,
      bottom: group.props.h - c.maxY,
    }
  );
}

function fitGroup(editor: Editor, state: EditingState, group: FigmaShape) {
  const c = contentBounds(editor, group);
  const slack = state.slack.get(group.id);
  if (!c || !slack) {
    return;
  }
  const minX = c.minX - slack.left;
  const minY = c.minY - slack.top;
  const w = c.maxX + slack.right - minX;
  const h = c.maxY + slack.bottom - minY;
  if (
    near(minX, 0) &&
    near(minY, 0) &&
    near(w, group.props.w) &&
    near(h, group.props.h)
  ) {
    return;
  }
  const cos = Math.cos(group.rotation);
  const sin = Math.sin(group.rotation);
  editor.updateShapes<FigmaShape>([
    {
      id: group.id,
      type: group.type,
      x: group.x + minX * cos - minY * sin,
      y: group.y + minX * sin + minY * cos,
      props: { w, h },
    },
    ...c.kids.map((k) => ({
      id: k.id,
      type: k.type,
      x: k.x - minX,
      y: k.y - minY,
    })),
  ]);
}

function markParent(editor: Editor, state: EditingState, shape: TLShape) {
  const parent = figmaParent(editor, shape);
  if (parent && (isAutoLayout(parent.props.node) || isGroup(parent))) {
    state.dirty.add(parent.id);
  }
}

function onChange(
  editor: Editor,
  state: EditingState,
  prev: TLShape,
  next: TLShape,
) {
  if (state.paused || !isFigmaShape(prev) || !isFigmaShape(next)) {
    return;
  }
  const resizedW = prev.props.w !== next.props.w;
  const sized = resizedW || prev.props.h !== next.props.h;
  const nodeChanged = prev.props.node !== next.props.node;
  const moved =
    prev.x !== next.x || prev.y !== next.y || prev.rotation !== next.rotation;
  const node = next.props.node;

  if (
    next.type === 'figma-text' &&
    ((nodeChanged && textKey(prev.props.node) !== textKey(node)) ||
      (resizedW && node.style?.textAutoResize === 'HEIGHT'))
  ) {
    fitText(editor, editor.getShape(next.id) as FigmaShape);
  }
  if (next.type === 'figma-frame' && sized && !isGroup(next)) {
    applyConstraints(editor, editor.getShape(next.id) as FigmaShape, {
      w: prev.props.w,
      h: prev.props.h,
    });
  }
  if (isAutoLayout(node) && (sized || nodeChanged)) {
    state.dirty.add(next.id);
  }
  if (prev.parentId !== next.parentId) {
    markParent(editor, state, prev);
  }
  const translating = editor.isIn('select.translating');
  if (
    (inFlow(prev.props.node) || inFlow(node)) &&
    (sized ||
      nodeChanged ||
      prev.index !== next.index ||
      prev.parentId !== next.parentId ||
      (moved && !translating))
  ) {
    markParent(editor, state, next);
  }
}

function flush(editor: Editor, state: EditingState) {
  if (state.paused || !state.dirty.size) {
    return;
  }
  const ids = [...state.dirty].filter((id) => editor.getShape(id));
  state.dirty.clear();
  const depth = new Map(
    ids.map((id) => [id, editor.getShapeAncestors(id).length]),
  );
  ids.sort((a, b) => depth.get(b)! - depth.get(a)!);
  const host = tldrawLayoutHost(editor);
  for (const id of ids) {
    const shape = editor.getShape(id) as FigmaShape;
    if (isGroup(shape)) {
      fitGroup(editor, state, shape);
    } else {
      relayout(host, id);
    }
  }
}

export function enableFigmaEditing(
  editor: Editor,
  measure: MeasureText,
): () => void {
  const state: EditingState = {
    paused: 0,
    dirty: new Set(),
    measure,
    slack: new Map(),
  };
  STATES.set(editor, state);
  const { sideEffects } = editor;
  const offs = [
    sideEffects.registerAfterChangeHandler('shape', (prev, next) =>
      onChange(editor, state, prev, next),
    ),
    sideEffects.registerAfterCreateHandler('shape', (shape) => {
      if (!isFigmaShape(shape)) {
        return;
      }
      if (isGroup(shape)) {
        const slack = measureSlack(editor, shape);
        if (slack) {
          state.slack.set(shape.id, slack);
        }
      }
      if (!state.paused) {
        markParent(editor, state, shape);
      }
    }),
    sideEffects.registerAfterDeleteHandler('shape', (shape) => {
      if (!state.paused && isFigmaShape(shape)) {
        markParent(editor, state, shape);
      }
    }),
    sideEffects.registerOperationCompleteHandler(() => flush(editor, state)),
  ];
  return () => {
    offs.forEach((off) => off());
    STATES.delete(editor);
  };
}

/** Re-runs every auto layout frame and group; for checks, see verification.md §4. */
export function relayoutAll(editor: Editor) {
  const state = STATES.get(editor);
  if (!state) {
    return;
  }
  editor.run(() => {
    for (const shape of editor.getCurrentPageShapes()) {
      if (
        isFigmaShape(shape) &&
        (isAutoLayout(shape.props.node) || isGroup(shape))
      ) {
        state.dirty.add(shape.id);
      }
    }
    flush(editor, state);
  });
}

// See apps/docs/figma-to-tldraw/tech.md §13.1.

function withSizing(
  node: FigmaNode,
  axis: Axis,
  sizing: FigmaLayoutSizing,
  parent: FigmaNode | undefined,
): FigmaNode {
  const out: FigmaNode = {
    ...node,
    [axis === 'x' ? 'layoutSizingHorizontal' : 'layoutSizingVertical']: sizing,
  };
  if (parent && isAutoLayout(parent)) {
    const parentMain = parent.layoutMode === 'HORIZONTAL' ? 'x' : 'y';
    if (axis === parentMain) {
      out.layoutGrow = sizing === 'FILL' ? 1 : 0;
    } else {
      out.layoutAlign = sizing === 'FILL' ? 'STRETCH' : 'INHERIT';
    }
  }
  if (isAutoLayout(node)) {
    const ownMain = node.layoutMode === 'HORIZONTAL' ? 'x' : 'y';
    const mode = sizing === 'HUG' ? 'AUTO' : 'FIXED';
    if (axis === ownMain) {
      out.primaryAxisSizingMode = mode;
    } else {
      out.counterAxisSizingMode = mode;
    }
  }
  return out;
}

export function figmaResize(
  editor: Editor,
  shape: FigmaShape,
  info: TLResizeInfo<FigmaShape>,
): TLShapePartial<FigmaShape> {
  const out = resizeBox(shape, info);
  if (!isFigmaEditing(editor)) {
    return out;
  }
  const handle = info.handle;
  const node = resizedNode(
    editor,
    shape,
    handle !== 'top' && handle !== 'bottom',
    handle !== 'left' && handle !== 'right',
  );
  return node === shape.props.node
    ? out
    : { ...out, props: { ...out.props, node } };
}

/** The node after a manual resize: touched axes become fixed size. */
export function resizedNode(
  editor: Editor,
  shape: FigmaShape,
  changesX: boolean,
  changesY: boolean,
): FigmaNode {
  const parent = figmaParent(editor, shape)?.props.node;
  let node = shape.props.node;
  if (node.type === 'TEXT') {
    const mode = node.style?.textAutoResize ?? 'NONE';
    const next = changesY ? 'NONE' : mode === 'NONE' ? 'NONE' : 'HEIGHT';
    if (next !== mode) {
      node = withAutoResize(node, next);
    }
  }
  for (const axis of ['x', 'y'] as const) {
    const touched = axis === 'x' ? changesX : changesY;
    if (touched && axisSizing(node, axis, parent) !== 'FIXED') {
      node = withSizing(node, axis, 'FIXED', parent);
    }
  }
  return node;
}

// See apps/docs/figma-to-tldraw/tech.md §13.2.
function reorder(editor: Editor, parent: FigmaShape, shape: FigmaShape) {
  const horiz = parent.props.node.layoutMode === 'HORIZONTAL';
  const flow = figmaChildren(editor, parent.id).filter((c) =>
    inFlow(c.props.node),
  );
  const center = (c: FigmaShape) => {
    const b = layoutBox(c);
    return horiz ? b.x + b.w / 2 : b.y + b.h / 2;
  };
  const others = flow.filter((c) => c.id !== shape.id);
  const mine = center(shape);
  let slot = others.findIndex((c) => mine < center(c));
  if (slot < 0) {
    slot = others.length;
  }
  const order = [...others.slice(0, slot), shape, ...others.slice(slot)];
  if (order.every((c, i) => c.id === flow[i]?.id)) {
    return;
  }
  const zOrder = parent.props.node.itemReverseZIndex ? order.reverse() : order;
  const at = zOrder.findIndex((c) => c.id === shape.id);
  const below = zOrder[at - 1]?.index as IndexKey | undefined;
  const above = zOrder[at + 1]?.index as IndexKey | undefined;
  editor.updateShape<FigmaShape>({
    id: shape.id,
    type: shape.type,
    index: getIndexBetween(below, above),
  });
}

export function figmaTranslateEnd(editor: Editor, shape: FigmaShape) {
  const parent = figmaParent(editor, shape);
  if (!parent || !isFigmaEditing(editor)) {
    return;
  }
  if (isAutoLayout(parent.props.node) && inFlow(shape.props.node)) {
    reorder(editor, parent, editor.getShape(shape.id) as FigmaShape);
    relayout(tldrawLayoutHost(editor), parent.id);
  } else if (isGroup(parent)) {
    const state = STATES.get(editor);
    if (state) {
      fitGroup(editor, state, parent);
    }
  }
}
