import type { Canvas, CanvasKit, Path } from 'canvaskit-wasm';
import type { ReactNode } from 'react';

import type { Editor } from './editor';
import { Box, type Geometry2d, type VecLike } from './geometry';
import type { Resources } from './render/resources';
import type { TLShape, TLShapePartial } from './types';

// See apps/docs/skia-engine/tech.md §4.

export interface PaintContext {
  ck: CanvasKit;
  canvas: Canvas;
  resources: Resources;
  /**
   * Device pixels per local unit the drawing is recorded for (rounded up to a
   * power of two), for picking image sizes; undefined means full size.
   */
  scale?: number;
  /** Deletes `obj` once the drawing has been recorded. */
  keep<T extends { delete(): void }>(obj: T): T;
}

export type ClipShape =
  | { kind: 'rect'; rect: Float32Array }
  | { kind: 'rrect'; rrect: Float32Array }
  | { kind: 'path'; path: Path };

export type TLResizeHandle =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top_left'
  | 'top_right'
  | 'bottom_left'
  | 'bottom_right';

export type TLResizeMode = 'scale_shape' | 'resize_bounds';

export interface TLResizeInfo<T extends TLShape = TLShape> {
  newPoint: VecLike;
  handle: TLResizeHandle;
  mode: TLResizeMode;
  scaleX: number;
  scaleY: number;
  initialBounds: Box;
  initialShape: T;
}

export type BlendModeName =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'
  | 'plus-darker'
  | 'plus-lighter';

export interface LayerStyle {
  blendMode?: BlendModeName;
  /** Gaussian blur sigma applied to the whole subtree. */
  blur?: number;
  /** Composite the subtree on its own even when opaque and normal. */
  isolate?: boolean;
}

export interface TLShapeUtilConstructor<T extends TLShape = TLShape> {
  new (editor: Editor): ShapeUtil<T>;
  type: string;
  props?: unknown;
}

export abstract class ShapeUtil<T extends TLShape = TLShape> {
  static type: string;
  static props?: unknown;
  readonly editor: Editor;

  constructor(editor: Editor) {
    this.editor = editor;
  }

  abstract getDefaultProps(): T['props'];
  abstract getGeometry(shape: T): Geometry2d;

  /** Draws the shape's own content in its local space; children are drawn by the engine. */
  abstract paint(shape: T, ctx: PaintContext): void;

  /** Drawn after the children (above them, inside the shape's clip). */
  paintAfterChildren?(shape: T, ctx: PaintContext): void;

  /** Local-space shape that clips the children; undefined = no clipping. */
  getClip?(shape: T, ck: CanvasKit): ClipShape | undefined;

  /** Whether `getClip` clips; hit testing uses it without building a path. */
  clipsChildren(_shape: T): boolean {
    return false;
  }

  /** Clips the shape and its subtree (Figma masks); see tech.md §5.4. */
  getSubtreeClip?(shape: T, ck: CanvasKit): ClipShape | undefined;

  getLayerStyle?(shape: T): LayerStyle | undefined;

  /** Local-space bounds of everything `paint` draws (shadows, blur, strokes). */
  getRenderBounds(shape: T): Box {
    return this.editor.getShapeGeometry(shape).bounds;
  }

  /** Extra key that invalidates the cached drawing when it changes. */
  getPaintKey?(shape: T): unknown;

  /** DOM content shown over the canvas while the shape is being edited. */
  editingComponent?(shape: T): ReactNode;

  canResize(_shape: T): boolean {
    return true;
  }
  canResizeChildren(_shape: T): boolean {
    return true;
  }
  hideResizeHandles(_shape: T): boolean {
    return false;
  }
  hideRotateHandle(_shape: T): boolean {
    return false;
  }
  hideSelectionBoundsFg(_shape: T): boolean {
    return false;
  }
  canEdit(_shape: T): boolean {
    return false;
  }
  canSnap(_shape: T): boolean {
    return true;
  }
  isAspectRatioLocked(_shape: T): boolean {
    return false;
  }

  onResize?(shape: T, info: TLResizeInfo<T>): TLShapePartial<T> | void;
  onResizeStart?(shape: T): TLShapePartial<T> | void;
  onResizeEnd?(initial: T, current: T): TLShapePartial<T> | void;
  onTranslateStart?(shape: T): TLShapePartial<T> | void;
  onTranslate?(initial: T, current: T): TLShapePartial<T> | void;
  onTranslateEnd?(initial: T, current: T): TLShapePartial<T> | void;
  onRotateStart?(shape: T): TLShapePartial<T> | void;
  onRotate?(initial: T, current: T): TLShapePartial<T> | void;
  onRotateEnd?(initial: T, current: T): TLShapePartial<T> | void;
  onDoubleClick?(shape: T): TLShapePartial<T> | void;
  onEditEnd?(shape: T): void;
}

/** tldraw's `resizeBox` for shapes whose props have `w` and `h`. */
export function resizeBox<T extends TLShape>(
  shape: T,
  info: TLResizeInfo<T>,
  opts: { minWidth?: number; minHeight?: number } = {},
): TLShapePartial<T> {
  const { newPoint, scaleX, scaleY, handle, initialShape } = info;
  const props = initialShape.props as { w: number; h: number };
  const minW = opts.minWidth ?? 1;
  const minH = opts.minHeight ?? 1;
  let w = props.w * Math.abs(scaleX);
  let h = props.h * Math.abs(scaleY);
  w = Math.max(minW, w);
  h = Math.max(minH, h);
  const offset = { x: 0, y: 0 };
  if (scaleX < 0) {
    offset.x += w;
  }
  if (scaleY < 0) {
    offset.y += h;
  }
  const flipOffset = rotate(offset, shape.rotation);
  void handle;
  return {
    id: shape.id,
    type: shape.type,
    x: newPoint.x - flipOffset.x,
    y: newPoint.y - flipOffset.y,
    props: { w, h },
  } as unknown as TLShapePartial<T>;
}

function rotate(p: VecLike, r: number) {
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

export const EMPTY_BOX = new Box();
