import type { VecLike } from '../geometry';
import { type PaintContext, ShapeUtil } from '../shape-util';
import { StateNode, type TLPointerEventInfo } from '../tools/state-node';
import { createShapeId, type TLBaseShape, type TLShapeId } from '../types';
import { Polyline2d } from './polyline';
import { STROKE_COLORS, STROKE_WIDTHS, type TLDefaultSize } from './styles';

// See apps/docs/skia-engine/tech.md §6.8.

export interface TLDrawShapeSegment {
  type: 'free' | 'straight';
  points: { x: number; y: number; z?: number }[];
}

export type TLDrawShape = TLBaseShape<
  'draw',
  {
    color: string;
    size: TLDefaultSize;
    segments: TLDrawShapeSegment[];
    isComplete: boolean;
  }
>;

function pointsOf(shape: TLDrawShape): VecLike[] {
  return shape.props.segments.flatMap((s) => s.points);
}

export class DrawShapeUtil extends ShapeUtil<TLDrawShape> {
  static override type = 'draw' as const;

  getDefaultProps(): TLDrawShape['props'] {
    return { color: 'black', size: 'm', segments: [], isComplete: false };
  }

  getGeometry(shape: TLDrawShape) {
    return new Polyline2d({
      points: pointsOf(shape),
      width: STROKE_WIDTHS[shape.props.size],
    });
  }

  override getRenderBounds(shape: TLDrawShape) {
    return this.getGeometry(shape).bounds.expandBy(
      STROKE_WIDTHS[shape.props.size],
    );
  }

  override canResize() {
    return false;
  }

  paint(shape: TLDrawShape, { ck, canvas, keep }: PaintContext) {
    const pts = pointsOf(shape);
    if (!pts.length) {
      return;
    }
    const p = keep(new ck.Paint());
    p.setAntiAlias(true);
    p.setColor(
      ck.parseColorString(STROKE_COLORS[shape.props.color] ?? '#1d1d1d'),
    );
    const width = STROKE_WIDTHS[shape.props.size];
    if (pts.length === 1) {
      canvas.drawCircle(pts[0].x, pts[0].y, width / 2, p);
      return;
    }
    p.setStyle(ck.PaintStyle.Stroke);
    p.setStrokeWidth(width);
    p.setStrokeCap(ck.StrokeCap.Round);
    p.setStrokeJoin(ck.StrokeJoin.Round);
    const b = new ck.PathBuilder();
    b.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      b.quadTo(pts[i].x, pts[i].y, mx, my);
    }
    const last = pts[pts.length - 1];
    b.lineTo(last.x, last.y);
    canvas.drawPath(keep(b.detachAndDelete()), p);
  }
}

class DrawIdle extends StateNode {
  static override id = 'idle';

  override onEnter() {
    this.editor.setCursor({ type: 'cross', rotation: 0 });
  }

  override onPointerDown(info: TLPointerEventInfo) {
    this.parent.transition('drawing', info);
  }

  override onCancel() {
    this.editor.setCurrentTool('select');
  }
}

class Drawing extends StateNode {
  static override id = 'drawing';
  private shapeId: TLShapeId | null = null;

  override onEnter() {
    const { editor } = this;
    const origin = editor.inputs.originPagePoint;
    this.shapeId = createShapeId();
    editor.markHistoryStoppingPoint('draw');
    editor.createShape<TLDrawShape>({
      id: this.shapeId,
      type: 'draw',
      x: origin.x,
      y: origin.y,
      props: {
        segments: [{ type: 'free', points: [{ x: 0, y: 0, z: 0.5 }] }],
      },
    });
  }

  override onPointerMove() {
    const { editor } = this;
    const shape = this.shapeId && editor.getShape<TLDrawShape>(this.shapeId);
    if (!shape) {
      return;
    }
    const p = editor.inputs.currentPagePoint;
    const seg = shape.props.segments[0];
    editor.updateShape<TLDrawShape>({
      id: shape.id,
      type: 'draw',
      props: {
        segments: [
          {
            ...seg,
            points: [
              ...seg.points,
              { x: p.x - shape.x, y: p.y - shape.y, z: 0.5 },
            ],
          },
        ],
      },
    });
  }

  override onPointerUp() {
    if (this.shapeId) {
      this.editor.updateShape<TLDrawShape>({
        id: this.shapeId,
        type: 'draw',
        props: { isComplete: true },
      });
    }
    this.parent.transition('idle');
  }

  override onCancel() {
    this.onPointerUp();
  }
}

export class DrawShapeTool extends StateNode {
  static override id = 'draw';
  static override initial = 'idle';
  static override children = () => [DrawIdle, Drawing];
}
