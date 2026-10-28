import type { CanvasKit } from 'canvaskit-wasm';

import {
  Box,
  type ClipShape,
  Ellipse2d,
  type LayerStyle,
  type BlendModeName,
  Mat,
  type PaintContext,
  Rectangle2d,
  ShapeUtil,
  type TLResizeInfo,
  type TLShapeId,
  type TLShapePartial,
} from '../../engine';
import {
  figmaResize,
  figmaTranslateEnd,
  isFigmaEditing,
} from '../editing/engine';
import { figmaDoubleClick } from '../editing/selection';
import { transformPath } from '../geometry';
import type {
  FigmaShape,
  FigmaShapeProps,
  FigmaShapeType,
} from '../shape-types';
import { outlineRRect } from '../skia/box';
import type { FigmaBlendMode, FigmaNode } from '../types';

// See apps/docs/skia-engine/tech.md §7.

const BLEND_NAMES: Partial<Record<FigmaBlendMode, BlendModeName>> = {
  MULTIPLY: 'multiply',
  SCREEN: 'screen',
  OVERLAY: 'overlay',
  DARKEN: 'darken',
  LIGHTEN: 'lighten',
  COLOR_DODGE: 'color-dodge',
  COLOR_BURN: 'color-burn',
  HARD_LIGHT: 'hard-light',
  SOFT_LIGHT: 'soft-light',
  DIFFERENCE: 'difference',
  EXCLUSION: 'exclusion',
  HUE: 'hue',
  SATURATION: 'saturation',
  COLOR: 'color',
  LUMINOSITY: 'luminosity',
  LINEAR_BURN: 'plus-darker',
  LINEAR_DODGE: 'plus-lighter',
};

export function layerBlurSigma(node: FigmaNode): number {
  const blur = (node.effects ?? []).find(
    (e) => e.visible !== false && e.type === 'LAYER_BLUR',
  );
  return blur ? blur.radius / 2 : 0;
}

interface MaskClip {
  mask: FigmaShape;
  rel: string;
  clip: ClipShape;
}

/** The outline a mask or clipping frame cuts with, in its own space, as SVG path data. */
function outlineOf(ck: CanvasKit, shape: FigmaShape, m: Mat) {
  const { w, h, node, maskPath } = shape.props;
  if (maskPath) {
    const d = transformPath(maskPath, [
      [m.a, m.c, m.e],
      [m.b, m.d, m.f],
    ]);
    const path = ck.Path.MakeFromSVGString(d);
    return path ? { kind: 'path' as const, path } : undefined;
  }
  const rr = outlineRRect(node, w, h);
  const b = new ck.PathBuilder();
  b.addRRect(rr);
  b.transform(m.toSkia());
  return { kind: 'path' as const, path: b.detachAndDelete() };
}

export abstract class FigmaShapeUtil<
  Type extends FigmaShapeType,
> extends ShapeUtil<FigmaShape<Type>> {
  private masks = new Map<TLShapeId, MaskClip>();
  private clips = new WeakMap<FigmaShapeProps, ClipShape>();

  getDefaultProps(): FigmaShapeProps {
    return {
      w: 100,
      h: 100,
      node: { id: '', name: '', type: 'RECTANGLE' },
      svg: '',
      images: {},
      imageSizes: {},
      mask: '',
      maskPath: '',
      flipX: false,
    };
  }

  getGeometry(shape: FigmaShape<Type>) {
    const { w, h, node } = shape.props;
    if (node.type === 'ELLIPSE' && !node.arcData) {
      return new Ellipse2d({ width: w, height: h, isFilled: true });
    }
    return new Rectangle2d({ width: w, height: h, isFilled: true });
  }

  // See apps/docs/figma-to-tldraw/tech.md §13.1.
  override canResize() {
    return isFigmaEditing(this.editor);
  }

  override hideResizeHandles() {
    return !isFigmaEditing(this.editor);
  }

  override hideRotateHandle() {
    return !isFigmaEditing(this.editor);
  }

  override canResizeChildren(shape: FigmaShape<Type>) {
    return shape.props.node.type === 'GROUP';
  }

  override onResize(
    shape: FigmaShape<Type>,
    info: TLResizeInfo<FigmaShape<Type>>,
  ) {
    return figmaResize(
      this.editor,
      shape as FigmaShape,
      info as unknown as TLResizeInfo<FigmaShape>,
    ) as TLShapePartial<FigmaShape<Type>>;
  }

  override onTranslateEnd(
    _initial: FigmaShape<Type>,
    current: FigmaShape<Type>,
  ) {
    figmaTranslateEnd(this.editor, current as FigmaShape);
  }

  override onDoubleClick(shape: FigmaShape<Type>) {
    return figmaDoubleClick(this.editor, shape as FigmaShape) as
      | TLShapePartial<FigmaShape<Type>>
      | undefined;
  }

  override canEdit(_shape: FigmaShape<Type>) {
    return false;
  }

  override clipsChildren(shape: FigmaShape<Type>) {
    return shape.type === 'figma-frame' && !!shape.props.node.clipsContent;
  }

  override getClip(shape: FigmaShape<Type>): ClipShape | undefined {
    if (!this.clipsChildren(shape)) {
      return undefined;
    }
    let clip = this.clips.get(shape.props);
    if (!clip) {
      const { w, h, node } = shape.props;
      clip = { kind: 'rrect', rrect: outlineRRect(node, w, h) };
      this.clips.set(shape.props, clip);
    }
    return clip;
  }

  // See apps/docs/skia-engine/tech.md §5.4.
  override getSubtreeClip(
    shape: FigmaShape<Type>,
    ck: CanvasKit,
  ): ClipShape | undefined {
    const maskId = shape.props.mask as TLShapeId;
    if (!maskId) {
      return undefined;
    }
    const mask = this.editor.getShape<FigmaShape>(maskId);
    if (!mask) {
      return undefined;
    }
    const rel = Mat.Multiply(
      Mat.Inverse(this.editor.getShapePageTransform(shape)),
      this.editor.getShapePageTransform(mask),
    );
    const key = [rel.a, rel.b, rel.c, rel.d, rel.e, rel.f]
      .map((n) => n.toFixed(4))
      .join(',');
    const hit = this.masks.get(shape.id);
    if (hit && hit.mask === mask && hit.rel === key) {
      return hit.clip;
    }
    if (hit?.clip.kind === 'path') {
      hit.clip.path.delete();
    }
    const clip = outlineOf(ck, mask, rel);
    if (!clip) {
      this.masks.delete(shape.id);
      return undefined;
    }
    this.masks.set(shape.id, { mask, rel: key, clip });
    return clip;
  }

  override getLayerStyle(shape: FigmaShape<Type>): LayerStyle | undefined {
    const { node } = shape.props;
    const blendMode = node.blendMode ? BLEND_NAMES[node.blendMode] : undefined;
    const blur = shape.type === 'figma-vector' ? 0 : layerBlurSigma(node);
    if (!blendMode && !blur) {
      return undefined;
    }
    return { blendMode, blur: blur || undefined };
  }

  /** Mirrors the content of shapes whose Figma transform flips them. */
  protected withFlip(
    shape: FigmaShape<Type>,
    ctx: PaintContext,
    draw: () => void,
  ) {
    if (!shape.props.flipX) {
      draw();
      return;
    }
    ctx.canvas.save();
    ctx.canvas.translate(shape.props.w, 0);
    ctx.canvas.scale(-1, 1);
    draw();
    ctx.canvas.restore();
  }

  protected flipBounds(shape: FigmaShape<Type>, b: Box): Box {
    return shape.props.flipX
      ? new Box(shape.props.w - b.maxX, b.y, b.w, b.h)
      : b;
  }
}
