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

// See apps/docs/figma-to-tldraw/tech.md §4.1.
function isOpaqueBox(shape: TLShape): boolean {
  if (!isFigmaShape(shape) || shape.opacity < 1 || shape.props.mask) {
    return false;
  }
  const { node } = shape.props;
  if (
    node.visible === false ||
    node.isMask ||
    (node.blendMode && !['PASS_THROUGH', 'NORMAL'].includes(node.blendMode)) ||
    node.effects?.some((e) => e.visible !== false) ||
    (node.strokes?.some((p) => p.visible !== false) &&
      node.strokeAlign !== 'INSIDE')
  ) {
    return false;
  }
  const arc = node.arcData;
  const plainVector =
    shape.type === 'figma-vector' &&
    (node.type === 'RECTANGLE' ||
      (node.type === 'ELLIPSE' &&
        (!arc ||
          (arc.innerRadius === 0 &&
            Math.abs(arc.endingAngle - arc.startingAngle) >=
              2 * Math.PI - 1e-4))));
  if (
    (node.opacity ?? 1) < 1 ||
    !(
      shape.type === 'figma-rect' ||
      (shape.type === 'figma-frame' && node.clipsContent) ||
      plainVector
    )
  ) {
    return false;
  }
  return (node.fills ?? []).some(
    (p) =>
      p.visible !== false &&
      p.type === 'SOLID' &&
      (p.opacity ?? 1) === 1 &&
      (p.color?.a ?? 1) === 1 &&
      (!p.blendMode || p.blendMode === 'NORMAL'),
  );
}

const EVERYWHERE = 'M -100000 -100000 H 100000 V 100000 H -100000 Z';

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
  const chain: TLShape[] = [
    shape,
    ...editor.getShapeAncestors(shape.id).reverse(),
  ];
  chain.forEach((item, i) => {
    if (!isFigmaShape(item)) {
      return;
    }
    if (
      item !== shape &&
      item.type === 'figma-frame' &&
      item.props.node.clipsContent
    ) {
      paths.push(`path('${pathOf(item)}')`);
    }
    if (item.props.mask) {
      const mask = editor.getShape(item.props.mask as TLShapeId);
      if (isFigmaShape(mask)) {
        paths.push(`path('${pathOf(mask)}')`);
      }
    }
    if (item !== shape && item.type === 'figma-frame' && item.opacity < 1) {
      const below = chain[i - 1];
      const siblings = editor.getSortedChildIdsForParent(item.id);
      for (const id of siblings.slice(siblings.indexOf(below.id) + 1)) {
        const above = editor.getShape(id);
        if (above && isOpaqueBox(above)) {
          paths.push(
            `path(evenodd, '${EVERYWHERE} ${pathOf(above as FigmaShape)}')`,
          );
        }
      }
    }
  });
  return paths;
}
