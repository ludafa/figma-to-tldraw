import type { Canvas, CanvasKit, Paint } from 'canvaskit-wasm';

import type { Editor } from '../editor';
import { Mat, Vec, type VecLike } from '../geometry';
import type { TLSelectionHandle } from '../tools/state-node';
import type { TLShape } from '../types';

// See apps/docs/skia-engine/tech.md §5.6.

const SELECTION = '#0D99FF';
const SNAP = '#F24822';
const HANDLE = 8;
const HANDLE_HIT = 6;
const ROTATE_HIT = 16;
const EDGE_HIT = 4;

export interface OverlayColors {
  selection: string;
  selectionFill: string;
}

/** Reads the selection colors the page's CSS sets on the container. */
export function readOverlayColors(el: HTMLElement): OverlayColors {
  const css = getComputedStyle(el);
  const stroke = css.getPropertyValue('--color-selection-stroke').trim();
  const fill = css.getPropertyValue('--color-selection-fill').trim();
  return {
    selection: stroke || SELECTION,
    selectionFill: fill || 'rgb(13 153 255 / 8%)',
  };
}

interface SelectionFrame {
  /** Corners in viewport pixels: top-left, top-right, bottom-right, bottom-left. */
  corners: Vec[];
  showHandles: boolean;
}

/** Selection box, handles, hover outline, brush and snap lines, drawn in viewport pixels. */
export class OverlayRenderer {
  readonly editor: Editor;
  readonly ck: CanvasKit;
  private stroke: Paint;
  private fill: Paint;
  private colorCache = new Map<string, Float32Array>();

  constructor(editor: Editor, ck: CanvasKit) {
    this.editor = editor;
    this.ck = ck;
    this.stroke = new ck.Paint();
    this.stroke.setStyle(ck.PaintStyle.Stroke);
    this.stroke.setAntiAlias(true);
    this.fill = new ck.Paint();
    this.fill.setAntiAlias(true);
  }

  dispose() {
    this.stroke.delete();
    this.fill.delete();
  }

  private color(css: string): Float32Array {
    let c = this.colorCache.get(css);
    if (!c) {
      c = parseCssColor(this.ck, css) ?? this.ck.parseColorString(css);
      this.colorCache.set(css, c);
    }
    return c;
  }

  private toViewport(m: Mat, p: VecLike): Vec {
    return this.editor.pageToViewport(Mat.applyToPoint(m, p));
  }

  private outline(shape: TLShape): Vec[] {
    const m = this.editor.getShapePageTransform(shape);
    return this.editor
      .getShapeGeometry(shape)
      .vertices.map((v) => this.toViewport(m, v));
  }

  private polyline(canvas: Canvas, pts: Vec[], closed: boolean) {
    if (pts.length < 2) {
      return;
    }
    const b = new this.ck.PathBuilder();
    b.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      b.lineTo(pts[i].x, pts[i].y);
    }
    if (closed) {
      b.close();
    }
    const path = b.detachAndDelete();
    canvas.drawPath(path, this.stroke);
    path.delete();
  }

  getSelectionFrame(): SelectionFrame | null {
    const editor = this.editor;
    const shapes = editor.getSelectedShapes();
    if (!shapes.length) {
      return null;
    }
    const box = editor.getSelectionRotatedPageBounds();
    if (!box) {
      return null;
    }
    const rot = Mat.Rotate(editor.getSelectionRotation());
    const corners = [
      { x: box.x, y: box.y },
      { x: box.maxX, y: box.y },
      { x: box.maxX, y: box.maxY },
      { x: box.x, y: box.maxY },
    ].map((p) => this.toViewport(rot, p));
    const only = shapes.length === 1 ? shapes[0] : null;
    const util = only ? editor.getShapeUtil(only) : null;
    const busy = editor.isInAny(
      'select.translating',
      'select.resizing',
      'select.rotating',
      'select.brushing',
    );
    const showHandles =
      !busy &&
      !editor.getEditingShapeId() &&
      !editor.getInstanceState().isReadonly &&
      !(only && util?.hideResizeHandles(only));
    return { corners, showHandles };
  }

  /** Which selection handle is under a viewport point, if any. */
  getHandleAt(point: VecLike): TLSelectionHandle | null {
    const frame = this.getSelectionFrame();
    if (!frame?.showHandles) {
      return null;
    }
    const [tl, tr, br, bl] = frame.corners;
    const corners: [Vec, TLSelectionHandle][] = [
      [tl, 'top_left'],
      [tr, 'top_right'],
      [br, 'bottom_right'],
      [bl, 'bottom_left'],
    ];
    for (const [c, h] of corners) {
      if (Vec.Dist(c, point) <= HANDLE_HIT) {
        return h;
      }
    }
    const edges: [Vec, Vec, TLSelectionHandle][] = [
      [tl, tr, 'top'],
      [tr, br, 'right'],
      [br, bl, 'bottom'],
      [bl, tl, 'left'],
    ];
    for (const [a, b, h] of edges) {
      if (distToSegment(point, a, b) <= EDGE_HIT) {
        return h;
      }
    }
    const only = this.editor.getOnlySelectedShape();
    if (only && this.editor.getShapeUtil(only).hideRotateHandle(only)) {
      return null;
    }
    const center = Vec.Mul(Vec.Add(tl, br), 0.5);
    for (const [c, h] of corners) {
      const d = Vec.Dist(c, point);
      const outside = Vec.Dist(center, point) > Vec.Dist(center, c);
      if (d <= ROTATE_HIT && outside) {
        return `${h}_rotate` as TLSelectionHandle;
      }
    }
    return null;
  }

  /** Draws the overlay; the canvas is already scaled to CSS pixels. */
  draw(canvas: Canvas, colors: OverlayColors) {
    const editor = this.editor;
    const ck = this.ck;
    const sel = this.color(colors.selection);
    this.stroke.setColor(sel);
    this.stroke.setStrokeWidth(1);

    const selected = new Set(editor.getSelectedShapeIds());
    const hovered = editor.getHoveredShape();
    if (
      hovered &&
      !selected.has(hovered.id) &&
      !editor.getEditingShapeId() &&
      editor.isInAny('select.idle', 'select.pointing_canvas')
    ) {
      this.stroke.setStrokeWidth(1.5);
      this.polyline(canvas, this.outline(hovered), true);
      this.stroke.setStrokeWidth(1);
    }

    const brush = editor.getInstanceState().brush;
    if (brush) {
      const a = editor.pageToViewport(brush);
      const b = editor.pageToViewport({
        x: brush.x + brush.w,
        y: brush.y + brush.h,
      });
      const r = ck.LTRBRect(a.x, a.y, b.x, b.y);
      this.fill.setColor(this.color(colors.selectionFill));
      canvas.drawRect(r, this.fill);
      canvas.drawRect(r, this.stroke);
    }

    const frame = this.getSelectionFrame();
    if (frame) {
      if (selected.size > 1) {
        for (const shape of editor.getSelectedShapes()) {
          this.polyline(canvas, this.outline(shape), true);
        }
      }
      this.polyline(canvas, frame.corners, true);
      if (frame.showHandles) {
        this.fill.setColor(ck.WHITE);
        for (const c of frame.corners) {
          const r = ck.XYWHRect(
            Math.round(c.x) - HANDLE / 2 + 0.5,
            Math.round(c.y) - HANDLE / 2 + 0.5,
            HANDLE - 1,
            HANDLE - 1,
          );
          canvas.drawRect(r, this.fill);
          canvas.drawRect(r, this.stroke);
        }
      }
    }

    const snaps = editor.snaps.getIndicators();
    if (snaps.length) {
      this.stroke.setColor(this.color(SNAP));
      for (const s of snaps) {
        const pts = s.points.map((p) => editor.pageToViewport(p));
        this.polyline(canvas, pts, false);
        for (const p of pts) {
          this.polyline(
            canvas,
            [Vec.Add(p, { x: -3, y: -3 }), Vec.Add(p, { x: 3, y: 3 })],
            false,
          );
          this.polyline(
            canvas,
            [Vec.Add(p, { x: 3, y: -3 }), Vec.Add(p, { x: -3, y: 3 })],
            false,
          );
        }
      }
    }
  }
}

function distToSegment(p: VecLike, a: VecLike, b: VecLike) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2
    ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
    : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

// See apps/docs/skia-engine/tech.md §5.6.
export function parseCssColor(ck: CanvasKit, css: string): Float32Array | null {
  const m =
    /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[/,]\s*([\d.]+)(%?))?\s*\)/.exec(
      css,
    );
  if (!m) {
    return null;
  }
  const a = m[4] === undefined ? 1 : Number(m[4]) / (m[5] ? 100 : 1);
  return ck.Color4f(
    Number(m[1]) / 255,
    Number(m[2]) / 255,
    Number(m[3]) / 255,
    a,
  );
}
