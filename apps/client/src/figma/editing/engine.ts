import {
  type Editor,
  getIndexBetween,
  type IndexKey,
  resizeBox,
  type TLParentId,
  type TLResizeInfo,
  type TLShape,
  type TLShapeId,
  type TLShapePartial,
} from '../../engine';
import { isFigmaShape, type FigmaShape } from '../shape-types';
import type { FigmaLayoutSizing, FigmaNode } from '../types';
import {
  type Axis,
  axisSizing,
  inFlow,
  isAutoLayout,
  relayout,
} from './auto-layout';
import { constrain } from './constraints';
import { type DragStyle, installDragStyle } from './drag-style';
import {
  figmaChildren,
  figmaParent,
  isRigid,
  layoutBox,
  placeBox,
  tldrawLayoutHost,
} from './host';
import {
  emptyMainEdits,
  emptyRenames,
  hasMainEdits,
  isInsideInstance,
  mainAround,
  type MainEdits,
  recordOverride,
  renameOnCreate,
  type Renames,
  syncInstances,
} from './instances';

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
  dragged: Set<TLShapeId>;
  dragStyle: DragStyle;
  // See apps/docs/figma-to-tldraw/tech.md §16.4.
  /** Writes made for the user's edit, not by the user: no overrides, no constraints. */
  quiet: Set<TLShapeId>;
  mainEdits: MainEdits;
  renames: Renames;
  /** Undo and redo replay a step that already has its side effects. */
  replaying: number;
  allowDelete: number;
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

// See apps/docs/figma-to-tldraw/tech.md §14.1.
function followsText(node: FigmaNode): boolean {
  return node.autoRename ?? node.name === node.characters;
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
  const kids = figmaChildren(editor, group.id).filter(
    (k) => k.props.node.visible !== false,
  );
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
  // See apps/docs/figma-to-tldraw/tech.md §16.4.
  const quiet = state.quiet.delete(next.id);
  if (!state.replaying) {
    if (!quiet) {
      recordOverride(editor, prev, next);
    }
    const main = mainAround(editor, next);
    if (main && !state.mainEdits.changed.has(next.id)) {
      state.mainEdits.changed.set(next.id, { prev, main: main.props.node.id });
    }
  }
  const resizedW = prev.props.w !== next.props.w;
  const sized = resizedW || prev.props.h !== next.props.h;
  const nodeChanged = prev.props.node !== next.props.node;
  const moved =
    prev.x !== next.x || prev.y !== next.y || prev.rotation !== next.rotation;
  const node = next.props.node;

  if (
    next.type === 'figma-text' &&
    nodeChanged &&
    prev.props.node.characters !== node.characters &&
    followsText(prev.props.node)
  ) {
    editor.updateShape<FigmaShape>({
      id: next.id,
      type: next.type,
      props: { node: { ...node, name: node.characters ?? '' } },
    });
  }
  if (
    next.type === 'figma-text' &&
    ((nodeChanged && textKey(prev.props.node) !== textKey(node)) ||
      (resizedW && node.style?.textAutoResize === 'HEIGHT'))
  ) {
    fitText(editor, editor.getShape(next.id) as FigmaShape);
  }
  if (next.type === 'figma-frame' && sized && !isGroup(next) && !quiet) {
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
    moved &&
    translating &&
    inFlow(node) &&
    editor.getSelectedShapeIds().includes(next.id)
  ) {
    const parent = figmaParent(editor, next);
    if (parent && isAutoLayout(parent.props.node)) {
      state.dragged.add(next.id);
      state.dragStyle.show();
    }
  }
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
  if (state.paused) {
    return;
  }
  // See apps/docs/figma-to-tldraw/tech.md §16.4.
  state.quiet.clear();
  if (hasMainEdits(state.mainEdits)) {
    const edits = state.mainEdits;
    state.mainEdits = emptyMainEdits();
    syncInstances(editor, edits, componentHooks(editor, state));
  }
  for (const id of state.dragged) {
    const shape = editor.getShape(id) as FigmaShape | undefined;
    const parent = shape && figmaParent(editor, shape);
    if (parent) {
      swap(editor, parent, shape);
    }
  }
  state.dragged.clear();
  if (!state.dirty.size) {
    return;
  }
  const ids = [...state.dirty].filter((id) => editor.getShape(id));
  state.dirty.clear();
  const depth = new Map(
    ids.map((id) => [id, editor.getShapeAncestors(id).length]),
  );
  ids.sort((a, b) => depth.get(b)! - depth.get(a)!);
  const host = tldrawLayoutHost(
    editor,
    editor.isIn('select.translating')
      ? new Set(editor.getSelectedShapeIds())
      : undefined,
  );
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
    dragged: new Set(),
    dragStyle: installDragStyle(editor),
    quiet: new Set(),
    mainEdits: emptyMainEdits(),
    renames: emptyRenames(),
    replaying: 0,
    allowDelete: 0,
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
        // See apps/docs/figma-to-tldraw/tech.md §16.4.
        const main = state.replaying ? undefined : mainAround(editor, shape);
        if (main && main.id !== shape.id) {
          state.mainEdits.created.set(shape.id, main.props.node.id);
        }
      }
    }),
    sideEffects.registerAfterDeleteHandler('shape', (shape) => {
      if (!state.paused && isFigmaShape(shape)) {
        markParent(editor, state, shape);
        const parent = editor.getShape(shape.parentId as TLShapeId);
        const main =
          state.replaying || !parent ? undefined : mainAround(editor, parent);
        if (main) {
          state.mainEdits.deleted.push({ shape, main: main.props.node.id });
        }
      }
    }),
    sideEffects.registerBeforeCreateHandler('shape', (shape) =>
      state.paused ||
      state.replaying ||
      state.quiet.has(shape.id) ||
      !isFigmaShape(shape)
        ? shape
        : renameOnCreate(editor, shape, state.renames),
    ),
    sideEffects.registerBeforeChangeHandler('shape', (prev, next) =>
      keepInstanceLayout(editor, state, prev, next),
    ),
    sideEffects.registerOperationCompleteHandler(() => flush(editor, state)),
    patchHistory(editor, state),
    patchCreate(editor, state),
    patchDelete(editor, state),
  ];
  return () => {
    offs.forEach((off) => off());
    state.dragStyle.dispose();
    STATES.delete(editor);
  };
}

// See apps/docs/figma-to-tldraw/tech.md §16.4.
function componentHooks(editor: Editor, state: EditingState) {
  return {
    quiet: (id: TLShapeId) => state.quiet.add(id),
    deleteShapes: (ids: TLShapeId[]) => {
      state.allowDelete++;
      try {
        editor.deleteShapes(ids);
      } finally {
        state.allowDelete--;
      }
    },
    constrain: (frame: FigmaShape, from: { w: number; h: number }) =>
      applyConstraints(editor, frame, from),
  };
}

/** Hooks for instance operations (quiet writes, real deletes). */
export function figmaComponentHooks(editor: Editor) {
  const state = STATES.get(editor);
  return state
    ? componentHooks(editor, state)
    : {
        quiet: () => undefined,
        deleteShapes: (ids: TLShapeId[]) => editor.deleteShapes(ids),
        constrain: (frame: FigmaShape, from: { w: number; h: number }) =>
          applyConstraints(editor, frame, from),
      };
}

const MANIPULATING = [
  'select.translating',
  'select.resizing',
  'select.rotating',
] as const;

/** Layers inside an instance keep their place while the user drags them. */
function keepInstanceLayout(
  editor: Editor,
  state: EditingState,
  prev: TLShape,
  next: TLShape,
): TLShape {
  if (
    state.paused ||
    state.replaying ||
    !isFigmaShape(prev) ||
    !isFigmaShape(next) ||
    !editor.isInAny(...MANIPULATING) ||
    !editor.getSelectedShapeIds().includes(next.id) ||
    !isInsideInstance(editor, next)
  ) {
    return next;
  }
  return {
    ...next,
    x: prev.x,
    y: prev.y,
    rotation: prev.rotation,
    parentId: prev.parentId,
    index: prev.index,
    props: { ...next.props, w: prev.props.w, h: prev.props.h },
  };
}

function patchHistory(editor: Editor, state: EditingState): () => void {
  const { undo, redo } = editor;
  const replay = (fn: () => Editor) => (): Editor => {
    state.replaying++;
    try {
      return fn.call(editor);
    } finally {
      state.replaying--;
    }
  };
  editor.undo = replay(undo);
  editor.redo = replay(redo);
  return () => {
    editor.undo = undo;
    editor.redo = redo;
  };
}

// See apps/docs/figma-to-tldraw/tech.md §16.4.
function patchCreate(editor: Editor, state: EditingState): () => void {
  const original = editor.createShapes;
  editor.createShapes = function (shapes) {
    state.renames = emptyRenames();
    return original.call(editor, parentsFirst(shapes));
  };
  return () => {
    editor.createShapes = original;
  };
}

function parentsFirst<T extends { id?: TLShapeId; parentId?: TLParentId }>(
  shapes: T[],
): T[] {
  const byId = new Map(shapes.map((s) => [s.id, s]));
  const out: T[] = [];
  const seen = new Set<T>();
  const visit = (s: T) => {
    if (seen.has(s)) {
      return;
    }
    seen.add(s);
    const parent = s.parentId && byId.get(s.parentId as TLShapeId);
    if (parent) {
      visit(parent);
    }
    out.push(s);
  };
  shapes.forEach(visit);
  return out;
}

/** Deleting a layer inside an instance hides it, the way Figma does. */
function patchDelete(editor: Editor, state: EditingState): () => void {
  const original = editor.deleteShapes;
  const remove = (ids: TLShapeId[]) =>
    (original as (ids: TLShapeId[]) => Editor).call(editor, ids);
  editor.deleteShapes = function (ids) {
    const list = (ids as (TLShapeId | TLShape)[]).map((i) =>
      typeof i === 'string' ? i : i.id,
    );
    if (state.paused || state.allowDelete) {
      return remove(list);
    }
    const hide: FigmaShape[] = [];
    const rest: TLShapeId[] = [];
    for (const id of list) {
      const shape = editor.getShape(id);
      if (isFigmaShape(shape) && isInsideInstance(editor, shape)) {
        hide.push(shape);
      } else {
        rest.push(id);
      }
    }
    if (hide.length) {
      editor.updateShapes(
        hide.map((s) => ({
          id: s.id,
          type: s.type,
          props: { node: { ...s.props.node, visible: false } },
        })),
      );
    }
    return remove(rest);
  };
  return () => {
    editor.deleteShapes = original;
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

export function setSizing(
  node: FigmaNode,
  axis: Axis,
  sizing: FigmaLayoutSizing,
  parent: FigmaNode | undefined,
): FigmaNode {
  let next = node;
  if (node.type === 'TEXT') {
    const mode = node.style?.textAutoResize ?? 'NONE';
    let resize = mode;
    if (axis === 'x') {
      resize =
        sizing === 'HUG'
          ? 'WIDTH_AND_HEIGHT'
          : mode === 'WIDTH_AND_HEIGHT'
            ? 'HEIGHT'
            : mode;
    } else {
      resize = sizing === 'HUG' ? (mode === 'NONE' ? 'HEIGHT' : mode) : 'NONE';
    }
    if (resize !== mode) {
      next = withAutoResize(node, resize);
    }
  }
  return withSizing(next, axis, sizing, parent);
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

// See apps/docs/figma-to-tldraw/tech.md §13.6.
function swap(editor: Editor, parent: FigmaShape, shape: FigmaShape) {
  if (!isAutoLayout(parent.props.node) || !inFlow(shape.props.node)) {
    return;
  }
  const horiz = parent.props.node.layoutMode === 'HORIZONTAL';
  const span = (c: FigmaShape) => {
    const b = layoutBox(c);
    return horiz ? [b.x, b.x + b.w] : [b.y, b.y + b.h];
  };
  const mid = (c: FigmaShape) => {
    const [a, b] = span(c);
    return (a + b) / 2;
  };
  const flow = figmaChildren(editor, parent.id).filter((c) =>
    inFlow(c.props.node),
  );
  const others = flow.filter((c) => c.id !== shape.id);
  const from = flow.findIndex((c) => c.id === shape.id);
  if (from < 0) {
    return;
  }
  const [start, end] = span(shape);
  let slot = from;
  while (slot > 0 && start < mid(others[slot - 1])) {
    slot--;
  }
  if (slot === from) {
    while (slot < others.length && end > mid(others[slot])) {
      slot++;
    }
  }
  if (slot !== from) {
    editor.updateShape<FigmaShape>({
      id: shape.id,
      type: shape.type,
      index: slotIndex(parent, shape, others, slot),
    });
  }
}

// See apps/docs/figma-to-tldraw/tech.md §14.1.
/** The index that puts a layer into auto layout's flow where it sits now. */
export function flowIndex(
  editor: Editor,
  parent: FigmaShape,
  shape: FigmaShape,
): IndexKey {
  const horiz = parent.props.node.layoutMode === 'HORIZONTAL';
  const center = (c: FigmaShape) => {
    const b = layoutBox(c);
    return horiz ? b.x + b.w / 2 : b.y + b.h / 2;
  };
  const others = figmaChildren(editor, parent.id).filter(
    (c) => c.id !== shape.id && inFlow(c.props.node),
  );
  const mine = center(shape);
  const slot = others.filter((c) => center(c) < mine).length;
  return slotIndex(parent, shape, others, slot);
}

function slotIndex(
  parent: FigmaShape,
  shape: FigmaShape,
  others: FigmaShape[],
  slot: number,
): IndexKey {
  const order = [...others.slice(0, slot), shape, ...others.slice(slot)];
  const zOrder = parent.props.node.itemReverseZIndex ? order.reverse() : order;
  const at = zOrder.findIndex((c) => c.id === shape.id);
  const below = zOrder[at - 1]?.index as IndexKey | undefined;
  const above = zOrder[at + 1]?.index as IndexKey | undefined;
  return getIndexBetween(below, above);
}

export function figmaTranslateEnd(editor: Editor, shape: FigmaShape) {
  const parent = figmaParent(editor, shape);
  if (!parent || !isFigmaEditing(editor)) {
    return;
  }
  if (isAutoLayout(parent.props.node) && inFlow(shape.props.node)) {
    swap(editor, parent, editor.getShape(shape.id) as FigmaShape);
    relayout(tldrawLayoutHost(editor), parent.id);
  } else if (isGroup(parent)) {
    const state = STATES.get(editor);
    if (state) {
      fitGroup(editor, state, parent);
    }
  }
}
