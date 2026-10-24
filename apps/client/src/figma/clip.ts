import type { Editor, Mat, TLShape, TLShapeId } from 'tldraw';

import {
  cornerRadii,
  ellipsePath,
  roundedRectPath,
  transformPath,
} from './geometry';
import { invert, multiply } from './matrix';
import type { FigmaShape } from './shape-types';
import type { Matrix2x3 } from './types';

// See apps/docs/figma-to-tldraw/tech.md §5.

function toMatrix(m: Mat): Matrix2x3 {
  return [
    [m.a, m.c, m.e],
    [m.b, m.d, m.f],
  ];
}

export function isFigmaShape(shape: TLShape | undefined): shape is FigmaShape {
  return !!shape && shape.type.startsWith('figma-');
}

function outlinePath(shape: FigmaShape, m: Matrix2x3): string {
  const { w, h, node, maskPath } = shape.props;
  if (maskPath) {
    return transformPath(maskPath, m);
  }
  if (node.type === 'ELLIPSE') {
    return ellipsePath(w, h, m);
  }
  return roundedRectPath(0, 0, w, h, cornerRadii(node), m);
}

export function clipPathsFor(editor: Editor, shapeId: TLShapeId): string[] {
  const shape = editor.getShape(shapeId);
  if (!isFigmaShape(shape)) {
    return [];
  }
  const toLocal = invert(toMatrix(editor.getShapePageTransform(shape.id)));
  const pathOf = (source: FigmaShape) =>
    outlinePath(
      source,
      multiply(toLocal, toMatrix(editor.getShapePageTransform(source.id))),
    );

  const paths: string[] = [];
  const chain: TLShape[] = [shape, ...editor.getShapeAncestors(shape.id)];
  for (const item of chain) {
    if (!isFigmaShape(item)) {
      continue;
    }
    if (
      item !== shape &&
      item.type === 'figma-frame' &&
      item.props.node.clipsContent
    ) {
      paths.push(pathOf(item));
    }
    if (item.props.mask) {
      const mask = editor.getShape(item.props.mask as TLShapeId);
      if (isFigmaShape(mask)) {
        paths.push(pathOf(mask));
      }
    }
  }
  return paths;
}
