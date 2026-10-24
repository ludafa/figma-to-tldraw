import type { ReactNode } from 'react';
import {
  Ellipse2d,
  HTMLContainer,
  Rectangle2d,
  type RecordProps,
  ShapeUtil,
  T,
  type TLShapeId,
  useEditor,
  useValue,
} from 'tldraw';

import { clipPathsFor } from '../clip';
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
    };
  }

  getGeometry(shape: FigmaShape<Type>) {
    const { w, h, node } = shape.props;
    if (node.type === 'ELLIPSE' && !node.arcData) {
      return new Ellipse2d({ width: w, height: h, isFilled: true });
    }
    return new Rectangle2d({ width: w, height: h, isFilled: true });
  }

  override canResize() {
    return false;
  }

  override hideResizeHandles() {
    return true;
  }

  override hideRotateHandle() {
    return true;
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
  const { w, h, node } = shape.props;

  let content: ReactNode = (
    <div
      data-figma-blend={
        node.blendMode && node.blendMode !== 'PASS_THROUGH'
          ? node.blendMode.toLowerCase()
          : undefined
      }
      style={{ position: 'absolute', left: 0, top: 0, width: w, height: h }}
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
          clipPath: `path('${d}')`,
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
      {backdrop?.(clipPaths[0] ? `path('${clipPaths[0]}')` : undefined)}
      {content}
    </HTMLContainer>
  );
}
