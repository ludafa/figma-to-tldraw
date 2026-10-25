import type { FigmaLayoutSizing, FigmaNode } from '../types';

// See apps/docs/figma-to-tldraw/tech.md §13.2.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutChild<Id> {
  id: Id;
  node: FigmaNode;
  box: Box;
  /** Rotated layers keep their size; see tech.md §13.2. */
  rigid?: boolean;
}

export interface LayoutResult<Id> {
  w: number;
  h: number;
  boxes: Map<Id, Box>;
}

export type Axis = 'x' | 'y';

export function isAutoLayout(node: FigmaNode): boolean {
  return (
    (node.layoutMode === 'HORIZONTAL' || node.layoutMode === 'VERTICAL') &&
    node.layoutWrap !== 'WRAP'
  );
}

export function inFlow(node: FigmaNode): boolean {
  return node.layoutPositioning !== 'ABSOLUTE';
}

// See apps/docs/figma-to-tldraw/tech.md §13.2.
export function axisSizing(
  node: FigmaNode,
  axis: Axis,
  parent: FigmaNode | undefined,
): FigmaLayoutSizing {
  const flowing = !!parent && isAutoLayout(parent) && inFlow(node);
  const explicit =
    axis === 'x' ? node.layoutSizingHorizontal : node.layoutSizingVertical;
  if (explicit) {
    return explicit === 'FILL' && !flowing ? 'FIXED' : explicit;
  }
  if (flowing) {
    const parentMain = parent.layoutMode === 'HORIZONTAL' ? 'x' : 'y';
    if (
      axis === parentMain
        ? (node.layoutGrow ?? 0) === 1
        : node.layoutAlign === 'STRETCH'
    ) {
      return 'FILL';
    }
  }
  if (node.layoutMode === 'HORIZONTAL' || node.layoutMode === 'VERTICAL') {
    const ownMain = node.layoutMode === 'HORIZONTAL' ? 'x' : 'y';
    const mode =
      axis === ownMain
        ? node.primaryAxisSizingMode
        : node.counterAxisSizingMode;
    return (mode ?? 'AUTO') === 'AUTO' ? 'HUG' : 'FIXED';
  }
  const resize = node.style?.textAutoResize;
  if (
    node.type === 'TEXT' &&
    (resize === 'WIDTH_AND_HEIGHT' || (resize === 'HEIGHT' && axis === 'y'))
  ) {
    return 'HUG';
  }
  return 'FIXED';
}

function clamp(v: number, lo?: number | null, hi?: number | null): number {
  let out = v;
  if (hi !== undefined && hi !== null) {
    out = Math.min(out, hi);
  }
  if (lo !== undefined && lo !== null) {
    out = Math.max(out, lo);
  }
  return out;
}

function strokeInset(node: FigmaNode): number {
  if (!node.strokesIncludedInLayout || !node.strokes?.length) {
    return 0;
  }
  return node.strokeWeight ?? 0;
}

export function layoutFrame<Id>(
  frame: FigmaNode,
  size: { w: number; h: number },
  children: LayoutChild<Id>[],
  parent: FigmaNode | undefined,
): LayoutResult<Id> | undefined {
  if (!isAutoLayout(frame)) {
    return undefined;
  }
  const horiz = frame.layoutMode === 'HORIZONTAL';
  const kids = children.filter((c) => inFlow(c.node));
  if (!kids.length) {
    return { w: size.w, h: size.h, boxes: new Map() };
  }
  const stroke = strokeInset(frame);
  const pl = (frame.paddingLeft ?? 0) + stroke;
  const pr = (frame.paddingRight ?? 0) + stroke;
  const pt = (frame.paddingTop ?? 0) + stroke;
  const pb = (frame.paddingBottom ?? 0) + stroke;
  const gap = frame.itemSpacing ?? 0;
  const primary = frame.primaryAxisAlignItems ?? 'MIN';
  const counter = frame.counterAxisAlignItems ?? 'MIN';

  const main = (b: Box) => (horiz ? b.w : b.h);
  const cross = (b: Box) => (horiz ? b.h : b.w);
  const padMain = horiz ? pl + pr : pt + pb;
  const padCross = horiz ? pt + pb : pl + pr;
  const minMain = horiz ? frame.minWidth : frame.minHeight;
  const maxMain = horiz ? frame.maxWidth : frame.maxHeight;
  const minCross = horiz ? frame.minHeight : frame.minWidth;
  const maxCross = horiz ? frame.maxHeight : frame.maxWidth;
  const n = kids.length;
  const mainAxis: Axis = horiz ? 'x' : 'y';
  const crossAxis: Axis = horiz ? 'y' : 'x';
  const fills = (c: LayoutChild<Id>, axis: Axis) =>
    !c.rigid && axisSizing(c.node, axis, frame) === 'FILL';

  // See apps/docs/figma-to-tldraw/tech.md §13.2.
  let mainSize = horiz ? size.w : size.h;
  let crossSize = horiz ? size.h : size.w;
  const hugMain = axisSizing(frame, mainAxis, parent) === 'HUG';
  const hugCross = axisSizing(frame, crossAxis, parent) === 'HUG';
  if (hugMain) {
    const total = kids.reduce((sum, c) => sum + main(c.box), 0);
    mainSize = clamp(total + gap * (n - 1) + padMain, minMain, maxMain);
  }
  if (hugCross) {
    const sized = kids.filter((c) => !fills(c, crossAxis));
    const pool = sized.length ? sized : kids;
    const widest = Math.max(...pool.map((c) => cross(c.box)));
    crossSize = clamp(widest + padCross, minCross, maxCross);
  }

  const mainAvail = mainSize - padMain;
  const crossAvail = crossSize - padCross;
  const mainStart = horiz ? pl : pt;
  const crossStart = horiz ? pt : pl;

  const grows = hugMain ? [] : kids.filter((c) => fills(c, mainAxis));
  const fixedTotal = kids
    .filter((c) => !grows.includes(c))
    .reduce((sum, c) => sum + main(c.box), 0);
  const sizes = new Map<Id, number>();
  if (grows.length) {
    // See apps/docs/figma-to-tldraw/tech.md §13.2.
    const fillGap = primary === 'SPACE_BETWEEN' ? 0 : gap;
    const each = (mainAvail - fixedTotal - fillGap * (n - 1)) / grows.length;
    for (const c of grows) {
      sizes.set(
        c.id,
        Math.max(
          0,
          clamp(
            each,
            horiz ? c.node.minWidth : c.node.minHeight,
            horiz ? c.node.maxWidth : c.node.maxHeight,
          ),
        ),
      );
    }
  }
  const mainOf = (c: LayoutChild<Id>) => sizes.get(c.id) ?? main(c.box);
  const contentMain = kids.reduce((sum, c) => sum + mainOf(c), 0);
  const spacing =
    primary === 'SPACE_BETWEEN' && !hugMain
      ? n > 1
        ? (mainAvail - contentMain) / (n - 1)
        : 0
      : gap;
  const total = contentMain + spacing * (n - 1);

  let pos = mainStart;
  if (primary === 'CENTER') {
    pos += (mainAvail - total) / 2;
  } else if (primary === 'MAX') {
    pos += mainAvail - total;
  }

  const boxes = new Map<Id, Box>();
  for (const c of kids) {
    const m = mainOf(c);
    let cs = cross(c.box);
    const stretch = fills(c, crossAxis);
    if (stretch) {
      cs = clamp(
        crossAvail,
        horiz ? c.node.minHeight : c.node.minWidth,
        horiz ? c.node.maxHeight : c.node.maxWidth,
      );
    }
    let cp = crossStart;
    if (!(stretch && cs === crossAvail)) {
      if (counter === 'CENTER') {
        cp += (crossAvail - cs) / 2;
      } else if (counter === 'MAX') {
        cp += crossAvail - cs;
      }
    }
    boxes.set(
      c.id,
      horiz ? { x: pos, y: cp, w: m, h: cs } : { x: cp, y: pos, w: cs, h: m },
    );
    pos += m + spacing;
  }

  return {
    w: horiz ? mainSize : crossSize,
    h: horiz ? crossSize : mainSize,
    boxes,
  };
}

export interface LayoutHost<Id> {
  node(id: Id): FigmaNode;
  parent(id: Id): Id | undefined;
  /** In-flow and absolute children, in layout order. */
  children(id: Id): Id[];
  /** The layer's own (unrotated) size. */
  size(id: Id): { w: number; h: number };
  setSize(id: Id, w: number, h: number): void;
  /** The layer's bounding box in its parent's coordinates. */
  box(id: Id): Box;
  /** Whether the layer is rotated, so its box can only move. */
  rigid(id: Id): boolean;
  setBox(id: Id, box: Box): void;
}

const EPSILON = 1e-3;

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

function sameBox(a: Box, b: Box): boolean {
  return near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w) && near(a.h, b.h);
}

/** Re-runs one auto layout frame; returns whether anything moved. */
export function relayout<Id>(host: LayoutHost<Id>, frameId: Id): boolean {
  const frame = host.node(frameId);
  if (!isAutoLayout(frame)) {
    return false;
  }
  const parentId = host.parent(frameId);
  const size = host.size(frameId);
  const result = layoutFrame(
    frame,
    size,
    host.children(frameId).map((id) => ({
      id,
      node: host.node(id),
      box: host.box(id),
      rigid: host.rigid(id),
    })),
    parentId === undefined ? undefined : host.node(parentId),
  );
  if (!result) {
    return false;
  }
  let changed = false;
  if (!near(size.w, result.w) || !near(size.h, result.h)) {
    host.setSize(frameId, result.w, result.h);
    changed = true;
  }
  for (const [id, box] of result.boxes) {
    if (!sameBox(host.box(id), box)) {
      host.setBox(id, box);
      changed = true;
    }
  }
  return changed;
}
