import { Box, type PaintContext } from '../../engine';
import type { FigmaShape } from '../shape-types';
import { FigmaShapeUtil } from './base';

// See apps/docs/skia-engine/tech.md §7.3.

const MARGIN = 2;

export class FigmaVectorShapeUtil extends FigmaShapeUtil<'figma-vector'> {
  static override type = 'figma-vector' as const;

  override getRenderBounds(shape: FigmaShape<'figma-vector'>) {
    const { w, h } = shape.props;
    return new Box(-MARGIN, -MARGIN, w + MARGIN * 2, h + MARGIN * 2);
  }

  paint(shape: FigmaShape<'figma-vector'>, ctx: PaintContext) {
    const { w, h, svg, node } = shape.props;
    if (node.isMask || !svg || w <= 0 || h <= 0) {
      return;
    }
    const pic = ctx.resources.svgPicture(svg);
    if (!pic || pic.width <= 0 || pic.height <= 0) {
      return;
    }
    this.withFlip(shape, ctx, () => {
      ctx.canvas.save();
      ctx.canvas.scale(w / pic.width, h / pic.height);
      ctx.canvas.drawPicture(pic.picture);
      ctx.canvas.restore();
    });
  }
}
