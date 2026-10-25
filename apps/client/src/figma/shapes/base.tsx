import type { ReactNode } from 'react';
import {
  Ellipse2d,
  HTMLContainer,
  Rectangle2d,
  type RecordProps,
  ShapeUtil,
  T,
  type TLResizeInfo,
  type TLShapeId,
  type TLShapePartial,
  useEditor,
  useValue,
} from 'tldraw';

import { clipPathsFor } from '../clip';
import {
  figmaResize,
  figmaTranslateEnd,
  isFigmaEditing,
} from '../editing/engine';
import { figmaDoubleClick } from '../editing/selection';
import type {
  FigmaShape,
  FigmaShapeProps,
  FigmaShapeType,
} from '../shape-types';
import type { FigmaNode } from '../types';

// See apps/docs/figma-to-tldraw/tech.md §3.

export const figmaShapeProps: RecordProps<FigmaShape> = {
  w: T.number,
  h: T.number,
  node: T.jsonValue as unknown as T.Validator<FigmaNode>,
  svg: T.string,
  images: T.jsonValue as unknown as T.Validator<FigmaShapeProps['images']>,
  imageSizes: T.jsonValue as unknown as T.Validator<
    FigmaShapeProps['imageSizes']
  >,
  mask: T.string,
  maskPath: T.string,
  flipX: T.boolean,
};

export abstract class FigmaShapeUtil<
  Type extends FigmaShapeType,
> extends ShapeUtil<FigmaShape<Type>> {
  static override props = figmaShapeProps;

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
    );
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

  override canEdit() {
    return false;
  }

  indicator(shape: FigmaShape<Type>) {
    return <rect width={shape.props.w} height={shape.props.h} />;
  }
}

export function FigmaShapeContainer({
  shape,
  children,
  backdrop,
}: {
  shape: FigmaShape;
  children: ReactNode;
  backdrop?: (clipPath: string | undefined) => ReactNode;
}) {
  const editor = useEditor();
  const clipPaths = useValue(
    'figma clip paths',
    () => clipPathsFor(editor, shape.id as TLShapeId),
    [editor, shape.id],
  );
  const { w, h, node, flipX } = shape.props;

  let content: ReactNode = (
    <div
      data-figma-blend={
        node.blendMode && node.blendMode !== 'PASS_THROUGH'
          ? node.blendMode.toLowerCase()
          : undefined
      }
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: w,
        height: h,
        // See apps/docs/figma-to-tldraw/tech.md §12.3.
        transform: flipX ? 'scaleX(-1)' : undefined,
      }}
    >
      {children}
    </div>
  );
  for (const d of clipPaths) {
    content = (
      <div
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: w,
          height: h,
          clipPath: d,
        }}
      >
        {content}
      </div>
    );
  }
  return (
    <HTMLContainer
      style={{
        width: w,
        height: h,
        overflow: 'visible',
        pointerEvents: 'none',
        strokeLinecap: 'butt',
        strokeLinejoin: 'miter',
      }}
    >
      {/* See apps/docs/figma-to-tldraw/tech.md §6.3. */}
      {backdrop?.(clipPaths[0])}
      {content}
    </HTMLContainer>
  );
}
