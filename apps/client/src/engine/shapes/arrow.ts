import { Vec } from '../geometry';
import { type PaintContext, ShapeUtil } from '../shape-util';
import { StateNode, type TLPointerEventInfo } from '../tools/state-node';
import { createShapeId, type TLBaseShape, type TLShapeId } from '../types';
import { Polyline2d } from './polyline';
import { STROKE_COLORS, STROKE_WIDTHS, type TLDefaultSize } from './styles';

// See apps/docs/skia-engine/tech.md §6.8.

export type TLArrowShape = TLBaseShape<
  'arrow',
  {
    color: string;
    size: TLDefaultSize;
    start: { x: number; y: number };
    end: { x: number; y: number };
    arrowheadStart: 'none' | 'arrow';
    arrowheadEnd: 'none' | 'arrow';
  }
>;

export class ArrowShapeUtil extends ShapeUtil<TLArrowShape> {
  static override type = 'arrow' as const;

  getDefaultProps(): TLArrowShape['props'] {
    return {
      color: 'black',
      size: 'm',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 0 },
      arrowheadStart: 'none',
      arrowheadEnd: 'arrow',
    };
  }

  getGeometry(shape: TLArrowShape) {
    return new Polyline2d({
      points: [shape.props.start, shape.props.end],
      width: STROKE_WIDTHS[shape.props.size],
    });
  }

  override getRenderBounds(shape: TLArrowShape) {
    const w = STROKE_WIDTHS[shape.props.size];
    return this.getGeometry(shape).bounds.expandBy(w * 2 + 12);
  }

  override canResize() {
    return false;
  }

  paint(shape: TLArrowShape, { ck, canvas, keep }: PaintContext) {
    const { start, end, size } = shape.props;
    const width = STROKE_WIDTHS[size];
    const p = keep(new ck.Paint());
    p.setAntiAlias(true);
    p.setStyle(ck.PaintStyle.Stroke);
    p.setStrokeWidth(width);
    p.setStrokeCap(ck.StrokeCap.Round);
    p.setStrokeJoin(ck.StrokeJoin.Round);
    p.setColor(
      ck.parseColorString(STROKE_COLORS[shape.props.color] ?? '#1d1d1d'),
    );
    const b = new ck.PathBuilder();
    b.moveTo(start.x, start.y);
    b.lineTo(end.x, end.y);
    const len = Vec.Dist(start, end);
    const head = Math.min(len / 2, 8 + width * 2);
    const heads: [Vec, Vec][] = [];
    if (shape.props.arrowheadEnd === 'arrow') {
      heads.push([Vec.From(end), Vec.From(start)]);
    }
    if (shape.props.arrowheadStart === 'arrow') {
      heads.push([Vec.From(start), Vec.From(end)]);
    }
    for (const [tip, from] of heads) {
      if (len < 1) {
        break;
      }
      const angle = Math.atan2(from.y - tip.y, from.x - tip.x);
      for (const side of [-1, 1]) {
        const a = angle + (side * Math.PI) / 6;
        b.moveTo(tip.x + Math.cos(a) * head, tip.y + Math.sin(a) * head);
        b.lineTo(tip.x, tip.y);
      }
    }
    canvas.drawPath(keep(b.detachAndDelete()), p);
  }
}

class ArrowIdle extends StateNode {
  static override id = 'idle';

  override onEnter() {
    this.editor.setCursor({ type: 'cross', rotation: 0 });
  }

  override onPointerDown(info: TLPointerEventInfo) {
    this.parent.transition('pointing', info);
  }

  override onCancel() {
    this.editor.setCurrentTool('select');
  }
}

class ArrowPointing extends StateNode {
  static override id = 'pointing';
  private shapeId: TLShapeId | null = null;

  override onEnter() {
    this.shapeId = null;
  }

  override onPointerMove() {
    const { editor } = this;
    if (!editor.inputs.isDragging) {
      return;
    }
    const origin = editor.inputs.originPagePoint;
    const p = editor.inputs.currentPagePoint;
    if (!this.shapeId) {
      this.shapeId = createShapeId();
      editor.markHistoryStoppingPoint('arrow');
      editor.createShape<TLArrowShape>({
        id: this.shapeId,
        type: 'arrow',
        x: origin.x,
        y: origin.y,
      });
    }
    editor.updateShape<TLArrowShape>({
      id: this.shapeId,
      type: 'arrow',
      props: { end: { x: p.x - origin.x, y: p.y - origin.y } },
    });
  }

  override onPointerUp() {
    const { editor } = this;
    if (this.shapeId && editor.getShape(this.shapeId)) {
      editor.select(this.shapeId);
      editor.setCurrentTool('select');
      return;
    }
    this.parent.transition('idle');
  }

  override onCancel() {
    if (this.shapeId) {
      this.editor.deleteShapes([this.shapeId]);
    }
    this.parent.transition('idle');
  }
}

export class ArrowShapeTool extends StateNode {
  static override id = 'arrow';
  static override initial = 'idle';
  static override children = () => [ArrowIdle, ArrowPointing];
}
