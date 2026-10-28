import type { Canvas, CanvasKit, Paint } from 'canvaskit-wasm';

import type { PaintContext } from '../../engine/shape-util';
import {
  clampRadii,
  cornerRadii,
  type Radii,
  roundedRectPieces,
} from '../geometry';
import { ellipsePerimeter, fitDashes } from '../paint-math';
import type { FigmaShape } from '../shape-types';
import type { FigmaEffect, FigmaNode } from '../types';
import {
  color4f,
  type Disposer,
  type PaintSource,
  skiaPaint,
  visiblePaints,
} from './paints';

// See apps/docs/skia-engine/tech.md §7.1.

export function rrect(
  x: number,
  y: number,
  w: number,
  h: number,
  r: Radii | [number, number, number, number, number, number, number, number],
): Float32Array {
  const xy =
    r.length === 4 ? [r[0], r[0], r[1], r[1], r[2], r[2], r[3], r[3]] : r;
  return Float32Array.of(x, y, x + w, y + h, ...xy);
}

export function boxRadii(node: FigmaNode, w: number, h: number): Radii {
  if (node.type === 'ELLIPSE') {
    return [w / 2, w / 2, w / 2, w / 2];
  }
  return clampRadii(cornerRadii(node), w, h);
}

/** The node's outline as a rounded rect (ellipses are full-radius rects). */
export function outlineRRect(node: FigmaNode, w: number, h: number) {
  if (node.type === 'ELLIPSE') {
    return Float32Array.of(
      0,
      0,
      w,
      h,
      w / 2,
      h / 2,
      w / 2,
      h / 2,
      w / 2,
      h / 2,
      w / 2,
      h / 2,
    );
  }
  return rrect(0, 0, w, h, boxRadii(node, w, h));
}

function visibleEffects(node: FigmaNode, type: FigmaEffect['type']) {
  return (node.effects ?? []).filter(
    (e) => e.visible !== false && e.type === type,
  );
}

function shadowColor(ck: CanvasKit, e: FigmaEffect) {
  return e.color ? color4f(ck, e.color) : ck.Color4f(0, 0, 0, 0.25);
}

/** CSS rule for how spread grows a corner radius. */
function spreadRadius(r: number, spread: number): number {
  if (spread < 0) {
    return Math.max(0, r + spread);
  }
  if (r >= spread || spread === 0) {
    return r + spread;
  }
  return r + spread * (1 + (r / spread - 1) ** 3);
}

function blurPaint(ck: CanvasKit, d: Disposer, e: FigmaEffect): Paint {
  const p = d.keep(new ck.Paint());
  p.setAntiAlias(true);
  p.setColor(shadowColor(ck, e));
  if (e.radius > 0) {
    p.setMaskFilter(
      d.keep(ck.MaskFilter.MakeBlur(ck.BlurStyle.Normal, e.radius / 2, true)),
    );
  }
  return p;
}

function ellipseRRect(x: number, y: number, w: number, h: number) {
  return Float32Array.of(
    x,
    y,
    x + w,
    y + h,
    w / 2,
    h / 2,
    w / 2,
    h / 2,
    w / 2,
    h / 2,
    w / 2,
    h / 2,
  );
}

function dropShadow(
  ctx: PaintContext,
  d: Disposer,
  shape: FigmaShape,
  e: FigmaEffect,
) {
  const { ck, canvas } = ctx;
  const { w, h, node } = shape.props;
  const s = e.spread ?? 0;
  const dx = e.offset?.x ?? 0;
  const dy = e.offset?.y ?? 0;
  canvas.save();
  if (!e.showShadowBehindNode) {
    canvas.clipRRect(outlineRRect(node, w, h), ck.ClipOp.Difference, true);
  }
  const shadow =
    node.type === 'ELLIPSE'
      ? ellipseRRect(dx - s, dy - s, w + s * 2, h + s * 2)
      : rrect(
          dx - s,
          dy - s,
          w + s * 2,
          h + s * 2,
          boxRadii(node, w, h).map((r) => spreadRadius(r, s)) as Radii,
        );
  if (shadow[2] > shadow[0] && shadow[3] > shadow[1]) {
    canvas.drawRRect(shadow, blurPaint(ck, d, e));
  }
  canvas.restore();
}

function innerShadow(
  ctx: PaintContext,
  d: Disposer,
  shape: FigmaShape,
  e: FigmaEffect,
) {
  const { ck, canvas } = ctx;
  const { w, h, node } = shape.props;
  const s = e.spread ?? 0;
  const dx = e.offset?.x ?? 0;
  const dy = e.offset?.y ?? 0;
  const paint = blurPaint(ck, d, e);
  canvas.save();
  canvas.clipRRect(outlineRRect(node, w, h), ck.ClipOp.Intersect, true);
  const hw = w - s * 2;
  const hh = h - s * 2;
  if (hw <= 0 || hh <= 0) {
    canvas.drawPaint(paint);
  } else {
    const pad = Math.abs(dx) + Math.abs(dy) + e.radius * 2 + Math.abs(s) + 10;
    const hole =
      node.type === 'ELLIPSE'
        ? ellipseRRect(dx + s, dy + s, hw, hh)
        : rrect(
            dx + s,
            dy + s,
            hw,
            hh,
            boxRadii(node, w, h).map((r) => Math.max(0, r - s)) as Radii,
          );
    const outer = rrect(
      -pad + Math.min(0, dx),
      -pad + Math.min(0, dy),
      w + pad * 2 + Math.abs(dx),
      h + pad * 2 + Math.abs(dy),
      [0, 0, 0, 0],
    );
    canvas.drawDRRect(outer, hole, paint);
  }
  canvas.restore();
}

/** Shadow of the stroke ring alone, for shapes without fills (§12.4). */
function strokeShadows(
  ctx: PaintContext,
  d: Disposer,
  shape: FigmaShape,
  shadows: FigmaEffect[],
) {
  const { ck, canvas } = ctx;
  const { w, h, node } = shape.props;
  const weight = node.strokeWeight ?? 0;
  const inset = strokeInset(node);
  const behind = shadows.some((e) => e.showShadowBehindNode);
  canvas.save();
  if (!behind) {
    canvas.clipRRect(outlineRRect(node, w, h), ck.ClipOp.Difference, true);
  }
  for (const e of shadows) {
    const p = blurPaint(ck, d, e);
    p.setStyle(ck.PaintStyle.Stroke);
    p.setStrokeWidth(weight + (e.spread ?? 0) * 2);
    const dx = e.offset?.x ?? 0;
    const dy = e.offset?.y ?? 0;
    const ring =
      node.type === 'ELLIPSE'
        ? ellipseRRect(inset + dx, inset + dy, w - inset * 2, h - inset * 2)
        : rrect(
            inset + dx,
            inset + dy,
            w - inset * 2,
            h - inset * 2,
            boxRadii(node, w, h).map((r) => Math.max(0, r - inset)) as Radii,
          );
    canvas.drawRRect(ring, p);
  }
  canvas.restore();
}

function strokeInset(node: FigmaNode): number {
  const weight = node.strokeWeight ?? 0;
  const align = node.strokeAlign ?? 'INSIDE';
  return align === 'INSIDE' ? weight / 2 : align === 'CENTER' ? 0 : -weight / 2;
}

const CAP: Record<string, 'Butt' | 'Round' | 'Square'> = {
  NONE: 'Butt',
  ROUND: 'Round',
  SQUARE: 'Square',
};
const JOIN: Record<string, 'Miter' | 'Round' | 'Bevel'> = {
  MITER: 'Miter',
  ROUND: 'Round',
  BEVEL: 'Bevel',
};

function individualStrokes(
  ctx: PaintContext,
  d: Disposer,
  shape: FigmaShape,
  src: PaintSource,
  iw: NonNullable<FigmaNode['individualStrokeWeights']>,
) {
  const { ck, canvas } = ctx;
  const { w, h, node } = shape.props;
  const first = visiblePaints(node.strokes)[0];
  const p = first && skiaPaint(ck, first, src, ctx.resources, d);
  if (!p) {
    return;
  }
  const align = node.strokeAlign ?? 'INSIDE';
  const out = (v: number) =>
    align === 'INSIDE' ? 0 : align === 'CENTER' ? v / 2 : v;
  const x = -out(iw.left);
  const y = -out(iw.top);
  const ow = w + out(iw.left) + out(iw.right);
  const oh = h + out(iw.top) + out(iw.bottom);
  const [tl, tr, br, bl] = clampRadii(
    clampRadii(cornerRadii(node), w, h),
    ow,
    oh,
  );
  const outer = rrect(x, y, ow, oh, [tl, tr, br, bl]);
  const inner = rrect(
    x + iw.left,
    y + iw.top,
    Math.max(0, ow - iw.left - iw.right),
    Math.max(0, oh - iw.top - iw.bottom),
    [
      Math.max(0, tl - iw.left),
      Math.max(0, tl - iw.top),
      Math.max(0, tr - iw.right),
      Math.max(0, tr - iw.top),
      Math.max(0, br - iw.right),
      Math.max(0, br - iw.bottom),
      Math.max(0, bl - iw.left),
      Math.max(0, bl - iw.bottom),
    ],
  );
  canvas.drawDRRect(outer, inner, p);
}

export function paintStrokes(
  ctx: PaintContext,
  d: Disposer,
  shape: FigmaShape,
  src: PaintSource,
) {
  const { ck, canvas } = ctx;
  const { w, h, node } = shape.props;
  const paints = visiblePaints(node.strokes);
  if (!paints.length) {
    return;
  }
  const iw = node.individualStrokeWeights;
  if (iw && node.type !== 'ELLIPSE') {
    individualStrokes(ctx, d, shape, src, iw);
    return;
  }
  const weight = node.strokeWeight ?? 0;
  if (weight <= 0) {
    return;
  }
  const inset = strokeInset(node);
  const sw = w - inset * 2;
  const sh = h - inset * 2;
  const radii = boxRadii(node, w, h).map((r) =>
    Math.max(0, r - inset),
  ) as Radii;
  const dashes = node.strokeDashes?.length ? node.strokeDashes : undefined;
  for (const paint of paints) {
    const p = skiaPaint(ck, paint, src, ctx.resources, d);
    if (!p) {
      continue;
    }
    p.setStyle(ck.PaintStyle.Stroke);
    p.setStrokeWidth(weight);
    p.setStrokeCap(ck.StrokeCap[CAP[node.strokeCap ?? 'NONE'] ?? 'Butt']);
    p.setStrokeJoin(ck.StrokeJoin[JOIN[node.strokeJoin ?? 'MITER'] ?? 'Miter']);
    if (node.type === 'ELLIPSE') {
      if (dashes) {
        const { intervals, phase } = fitDashes(
          dashes,
          ellipsePerimeter(sw, sh),
        );
        p.setPathEffect(
          d.keep(ck.PathEffect.MakeDash(evenDashes(intervals), phase)),
        );
      }
      canvas.drawOval(ck.XYWHRect(inset, inset, sw, sh), p);
      continue;
    }
    if (!dashes) {
      canvas.drawRRect(rrect(inset, inset, sw, sh, radii), p);
      continue;
    }
    for (const piece of roundedRectPieces(inset, inset, sw, sh, radii)) {
      const path = ck.Path.MakeFromSVGString(piece.d);
      if (!path) {
        continue;
      }
      d.keep(path);
      const { intervals, phase } = fitDashes(dashes, piece.length);
      const pp = d.keep(p.copy());
      pp.setPathEffect(
        d.keep(ck.PathEffect.MakeDash(evenDashes(intervals), phase)),
      );
      canvas.drawPath(path, pp);
    }
  }
}

function evenDashes(intervals: number[]): number[] {
  return intervals.length % 2 ? [...intervals, ...intervals] : intervals;
}

export function hasVisibleFill(node: FigmaNode): boolean {
  return visiblePaints(node.fills).some(
    (p) => (p.opacity ?? 1) > 0 && (p.color?.a ?? 1) > 0,
  );
}

/** Fills, shadows, background blur and strokes of a rectangle, ellipse or frame. */
export function paintBox(ctx: PaintContext, d: Disposer, shape: FigmaShape) {
  const { ck, canvas } = ctx;
  const { w, h, node, images, imageSizes } = shape.props;
  if (node.isMask || w <= 0 || h <= 0) {
    return;
  }
  const src: PaintSource = { w, h, images, imageSizes, scale: ctx.scale };
  const outline = outlineRRect(node, w, h);
  const fills = visiblePaints(node.fills);

  const backdrop = visibleEffects(node, 'BACKGROUND_BLUR')[0];
  if (backdrop && backdrop.radius > 0 && hasVisibleFill(node)) {
    canvas.save();
    canvas.clipRRect(outline, ck.ClipOp.Intersect, true);
    const sigma = backdrop.radius / 2;
    const blur = d.keep(
      ck.ImageFilter.MakeBlur(sigma, sigma, ck.TileMode.Clamp, null),
    );
    // See apps/docs/skia-engine/tech.md §7.1.
    const copy = d.keep(ck.ImageFilter.MakeOffset(0, 0, null));
    canvas.saveLayer(undefined, null, copy, 0, ck.TileMode.Clamp);
    canvas.saveLayer(undefined, null, blur, 0, ck.TileMode.Mirror);
    canvas.restore();
    canvas.restore();
    canvas.restore();
  }

  const shadows = visibleEffects(node, 'DROP_SHADOW');
  const strokeOnly =
    shadows.length > 0 &&
    fills.length === 0 &&
    visiblePaints(node.strokes).length > 0 &&
    (node.strokeWeight ?? 0) > 0 &&
    !node.individualStrokeWeights;
  if (strokeOnly) {
    strokeShadows(ctx, d, shape, shadows);
  } else {
    for (const e of shadows) {
      dropShadow(ctx, d, shape, e);
    }
  }

  for (const paint of fills) {
    const p = skiaPaint(ck, paint, src, ctx.resources, d);
    if (p) {
      drawOutline(canvas, outline, node, p, ck);
    }
  }

  for (const e of visibleEffects(node, 'INNER_SHADOW')) {
    innerShadow(ctx, d, shape, e);
  }
  paintStrokes(ctx, d, shape, src);
}

function drawOutline(
  canvas: Canvas,
  outline: Float32Array,
  node: FigmaNode,
  p: Paint,
  ck: CanvasKit,
) {
  if (node.type === 'ELLIPSE') {
    canvas.drawOval(
      ck.LTRBRect(outline[0], outline[1], outline[2], outline[3]),
      p,
    );
  } else {
    canvas.drawRRect(outline, p);
  }
}

/** Local bounds of everything `paintBox` can draw. */
export function boxRenderBounds(node: FigmaNode, w: number, h: number) {
  let l = 0;
  let t = 0;
  let r = w;
  let b = h;
  const grow = (x0: number, y0: number, x1: number, y1: number) => {
    l = Math.min(l, x0);
    t = Math.min(t, y0);
    r = Math.max(r, x1);
    b = Math.max(b, y1);
  };
  const weight = Math.max(
    node.strokeWeight ?? 0,
    ...Object.values(node.individualStrokeWeights ?? {}),
  );
  if (visiblePaints(node.strokes).length && node.strokeAlign !== 'INSIDE') {
    grow(-weight, -weight, w + weight, h + weight);
  }
  for (const e of node.effects ?? []) {
    if (e.visible === false) {
      continue;
    }
    const blur = e.radius * 1.5;
    if (e.type === 'DROP_SHADOW') {
      const s = Math.max(0, e.spread ?? 0) + blur + weight;
      const dx = e.offset?.x ?? 0;
      const dy = e.offset?.y ?? 0;
      grow(dx - s, dy - s, w + dx + s, h + dy + s);
    } else if (e.type === 'LAYER_BLUR') {
      grow(l - blur, t - blur, r + blur, b + blur);
    }
  }
  return { x: l, y: t, w: r - l, h: b - t };
}
