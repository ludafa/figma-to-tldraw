import {
  Box,
  type Editor,
  getCanvasKit,
  getSharedResources,
  type PaintContext,
  type TLShapeId,
} from '../../engine';
import { isFigmaEditing } from '../editing/engine';
import { FigmaTextEditor } from '../editing/text-editor';
import type { FigmaShape, FigmaShapeProps } from '../shape-types';
import {
  disposeLayout,
  drawText,
  type FigmaTextLayout,
  layoutText,
  textStrokeOutset,
  withTextShadows,
} from '../skia/text';
import { FigmaShapeUtil, layerBlurSigma } from './base';

// See apps/docs/skia-engine/tech.md §7.2, §7.5.

/** Shapes whose Skia paragraphs stay alive; the rest keep only their extent. */
const LIVE_LAYOUTS = 64;

interface Cached {
  props: FigmaShapeProps;
  version: number;
  complete: boolean;
}

interface CachedLayout extends Cached {
  layout: FigmaTextLayout;
}

interface CachedExtent extends Cached {
  /** Union of the line boxes, or null without lines. */
  box: { l: number; t: number; r: number; b: number } | null;
}

function isFresh<T extends Cached>(
  hit: T | undefined,
  props: FigmaShapeProps,
  version: number,
): hit is T {
  return (
    !!hit && hit.props === props && (hit.complete || hit.version === version)
  );
}

function lineExtent(layout: FigmaTextLayout): CachedExtent['box'] {
  if (!layout.lines.length) {
    return null;
  }
  let l = Infinity;
  let t = Infinity;
  let r = -Infinity;
  let b = -Infinity;
  for (const line of layout.lines) {
    l = Math.min(l, line.x, line.marker?.x ?? line.x);
    r = Math.max(r, line.x + line.width);
    t = Math.min(t, line.top);
    b = Math.max(b, line.top + line.height);
  }
  return { l, t, r, b };
}

export class FigmaTextShapeUtil extends FigmaShapeUtil<'figma-text'> {
  static override type = 'figma-text' as const;
  private layouts = new Map<TLShapeId, CachedLayout>();
  private extents = new Map<TLShapeId, CachedExtent>();

  constructor(editor: Editor) {
    super(editor);
    editor.sideEffects.registerAfterDeleteHandler('shape', (shape) => {
      this.dropLayout(shape.id);
      this.extents.delete(shape.id);
    });
  }

  private dropLayout(id: TLShapeId) {
    const hit = this.layouts.get(id);
    if (hit) {
      disposeLayout(hit.layout);
      this.layouts.delete(id);
    }
  }

  /** The shape's text laid out with the fonts loaded so far. */
  getLayout(shape: FigmaShape<'figma-text'>): FigmaTextLayout {
    const ck = getCanvasKit();
    const res = getSharedResources(ck);
    const version = res.version.__unsafe__getWithoutCapture();
    const hit = this.layouts.get(shape.id);
    if (isFresh(hit, shape.props, version)) {
      this.layouts.delete(shape.id);
      this.layouts.set(shape.id, hit);
      if (!hit.complete) {
        res.markIncomplete();
      }
      return hit.layout;
    }
    this.dropLayout(shape.id);
    const { node, w, h } = shape.props;
    const layout = layoutText(ck, res, node, w, h);
    const { complete } = layout;
    if (!complete) {
      res.markIncomplete();
    }
    const { props } = shape;
    this.layouts.set(shape.id, { props, version, complete, layout });
    this.extents.set(shape.id, {
      props,
      version,
      complete,
      box: lineExtent(layout),
    });
    for (const id of this.layouts.keys()) {
      if (this.layouts.size <= LIVE_LAYOUTS) {
        break;
      }
      this.dropLayout(id);
    }
    return layout;
  }

  private getExtent(shape: FigmaShape<'figma-text'>): CachedExtent['box'] {
    const res = getSharedResources(getCanvasKit());
    const version = res.version.__unsafe__getWithoutCapture();
    const hit = this.extents.get(shape.id);
    if (isFresh(hit, shape.props, version)) {
      if (!hit.complete) {
        res.markIncomplete();
      }
      return hit.box;
    }
    this.getLayout(shape);
    return this.extents.get(shape.id)?.box ?? null;
  }

  override getRenderBounds(shape: FigmaShape<'figma-text'>) {
    const { w, h, node } = shape.props;
    let l = 0;
    let t = 0;
    let r = w;
    let b = h;
    const box = this.getExtent(shape);
    if (box) {
      const size =
        4 + (node.style?.fontSize ?? 16) * 0.5 + textStrokeOutset(node);
      l = Math.min(l, box.l - size);
      r = Math.max(r, box.r + size);
      t = Math.min(t, box.t - size);
      b = Math.max(b, box.b + size);
    }
    ({ l, t, r, b } = withTextShadows(node, { l, t, r, b }));
    const blur = layerBlurSigma(node) * 3;
    return this.flipBounds(
      shape,
      new Box(l - blur, t - blur, r - l + blur * 2, b - t + blur * 2),
    );
  }

  override canEdit() {
    return isFigmaEditing(this.editor);
  }

  override editingComponent(shape: FigmaShape<'figma-text'>) {
    return <FigmaTextEditor shape={shape} />;
  }

  override onEditEnd(shape: FigmaShape<'figma-text'>) {
    if (!shape.props.node.characters) {
      this.editor.deleteShapes([shape.id]);
    }
  }

  paint(shape: FigmaShape<'figma-text'>, ctx: PaintContext) {
    const { w, h, node, images, imageSizes } = shape.props;
    if (node.isMask) {
      return;
    }
    const layout = this.getLayout(shape);
    const src = { w, h, images, imageSizes, scale: ctx.scale };
    this.withFlip(shape, ctx, () =>
      drawText(ctx.ck, ctx.canvas, ctx.resources, node, layout, src, ctx),
    );
  }
}
