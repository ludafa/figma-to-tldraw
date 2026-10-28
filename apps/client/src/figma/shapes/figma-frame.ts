import { Box, type PaintContext } from '../../engine';
import type { FigmaShape } from '../shape-types';
import { boxRenderBounds, paintBox } from '../skia/box';
import { FigmaShapeUtil } from './base';

// See apps/docs/skia-engine/tech.md §7.1.

export class FigmaFrameShapeUtil extends FigmaShapeUtil<'figma-frame'> {
  static override type = 'figma-frame' as const;

  override getRenderBounds(shape: FigmaShape<'figma-frame'>) {
    const { node, w, h } = shape.props;
    return this.flipBounds(shape, Box.From(boxRenderBounds(node, w, h)));
  }

  paint(shape: FigmaShape<'figma-frame'>, ctx: PaintContext) {
    this.withFlip(shape, ctx, () => paintBox(ctx, ctx, shape));
  }
}
