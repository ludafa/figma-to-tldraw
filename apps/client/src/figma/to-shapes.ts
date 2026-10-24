import {
  createShapeId,
  getIndices,
  type TLParentId,
  type TLShapeId,
  type TLShapePartial,
} from 'tldraw';

import { filteredImageKey } from './image-filters';
import { decompose, IDENTITY, invert, multiply, translation } from './matrix';
import type { FigmaShape, FigmaShapeType } from './shape-types';
import type { FigmaNode, FigmaPaint, Matrix2x3, Snapshot } from './types';

// See apps/docs/figma-to-tldraw/tech.md §4.

const SHAPE_TYPES: Record<string, FigmaShapeType> = {
  FRAME: 'figma-frame',
  COMPONENT: 'figma-frame',
  COMPONENT_SET: 'figma-frame',
  INSTANCE: 'figma-frame',
  SECTION: 'figma-frame',
  GROUP: 'figma-frame',
  RECTANGLE: 'figma-rect',
  ELLIPSE: 'figma-rect',
  TEXT: 'figma-text',
  VECTOR: 'figma-vector',
  BOOLEAN_OPERATION: 'figma-vector',
  STAR: 'figma-vector',
  REGULAR_POLYGON: 'figma-vector',
  LINE: 'figma-vector',
};

export interface ToShapesOptions {
  idPrefix: string;
  assetBase: string;
}

export interface ToShapesResult {
  rootId: TLShapeId;
  shapes: TLShapePartial<FigmaShape>[];
  warnings: string[];
}

export function shapeIdFor(prefix: string, nodeId: string): TLShapeId {
  return createShapeId(`figma:${prefix}:${nodeId}`);
}

function shapeTypeFor(node: FigmaNode): FigmaShapeType | undefined {
  if (node.type === 'ELLIPSE' && node.arcData && !node.isMask) {
    return 'figma-vector';
  }
  if (node.isMask) {
    return node.type === 'RECTANGLE' || node.type === 'ELLIPSE'
      ? 'figma-rect'
      : 'figma-vector';
  }
  return SHAPE_TYPES[node.type];
}

function svgSize(svg: string): { w: number; h: number } | undefined {
  const match = /<svg[^>]*?\swidth="([\d.]+)"[^>]*?\sheight="([\d.]+)"/.exec(
    svg,
  );
  return match ? { w: Number(match[1]), h: Number(match[2]) } : undefined;
}

function stripChildren(node: FigmaNode): FigmaNode {
  const { children: _children, ...rest } = node;
  return rest;
}

function imagePaints(node: FigmaNode): FigmaPaint[] {
  const paints = [...(node.fills ?? []), ...(node.strokes ?? [])];
  return paints.filter((p) => p.type === 'IMAGE' && p.imageRef);
}

export function snapshotToShapes(
  snapshot: Snapshot,
  opts: ToShapesOptions,
): ToShapesResult {
  const root = snapshot.rest.document;
  const transforms = snapshot.transforms ?? {};
  const shapes: TLShapePartial<FigmaShape>[] = [];
  const warnings: string[] = [];

  function placement(
    node: FigmaNode,
    type: FigmaShapeType,
  ): { m: Matrix2x3; w: number; h: number } | undefined {
    const svg = snapshot.svgs[node.id];
    if (type === 'figma-vector' && !node.isMask) {
      const rb = node.absoluteRenderBounds;
      if (!svg || !rb) {
        return undefined;
      }
      const size = svgSize(svg) ?? {
        w: Math.ceil(rb.width),
        h: Math.ceil(rb.height),
      };
      return { m: translation(rb.x, rb.y), ...size };
    }
    const t = transforms[node.id];
    if (t) {
      return t;
    }
    const bb = node.absoluteBoundingBox;
    if (!bb) {
      return undefined;
    }
    return { m: translation(bb.x, bb.y), w: bb.width, h: bb.height };
  }

  const rootPlacement = placement(root, 'figma-frame');
  const origin = rootPlacement
    ? translation(-rootPlacement.m[0][2], -rootPlacement.m[1][2])
    : IDENTITY;

  function visit(
    node: FigmaNode,
    parentId: TLParentId | undefined,
    parentPage: Matrix2x3,
    index: string,
    mask: string,
  ) {
    if (node.visible === false) {
      return;
    }
    const type = shapeTypeFor(node);
    if (!type) {
      warnings.push(
        `不支持的节点类型 ${node.type}：${node.name}（${node.id}）`,
      );
      return;
    }
    // See apps/docs/figma-to-tldraw/tech.md §9.
    if (
      type === 'figma-vector' &&
      !node.isMask &&
      node.absoluteRenderBounds === null
    ) {
      return;
    }
    const place = placement(node, type);
    if (!place) {
      warnings.push(`缺少位置或 SVG：${node.name}（${node.id}）`);
      return;
    }

    const page = multiply(origin, place.m);
    const local = parentId ? multiply(invert(parentPage), page) : page;
    const { x, y, rotation } = decompose(local);
    const id = shapeIdFor(opts.idPrefix, node.id);

    const images: Record<string, string> = {};
    for (const paint of imagePaints(node)) {
      const ref = paint.imageRef!;
      const rel = snapshot.meta.images[ref];
      if (rel) {
        images[ref] = opts.assetBase + rel;
      }
      // See apps/docs/figma-to-tldraw/tech.md §6.8.
      const key = filteredImageKey(ref, paint.filters);
      if (key) {
        const baked = snapshot.meta.filteredImages?.[key];
        if (baked) {
          images[key] = opts.assetBase + baked;
        } else {
          warnings.push(
            `图片滤镜没有效果（缺少渲染好的图）：${node.name}（${node.id}）`,
          );
        }
      }
    }

    shapes.push({
      id,
      type,
      ...(parentId ? { parentId } : {}),
      index: index as TLShapePartial['index'],
      x,
      y,
      rotation,
      // See apps/docs/figma-to-tldraw/tech.md §4.1.
      opacity: type === 'figma-vector' ? 1 : (node.opacity ?? 1),
      props: {
        w: place.w,
        h: place.h,
        node: stripChildren(node),
        svg: node.isMask ? '' : (snapshot.svgs[node.id] ?? ''),
        images,
        imageSizes: snapshot.meta.imageSizes ?? {},
        mask,
        maskPath: snapshot.meta.masks?.[node.id] ?? '',
      },
    });

    if (type === 'figma-vector' || !node.children?.length) {
      return;
    }
    // See apps/docs/figma-to-tldraw/tech.md §4.3.
    const children = node.itemReverseZIndex
      ? [...node.children].reverse()
      : node.children;
    const indices = getIndices(children.length);
    let currentMask = '';
    children.forEach((child, i) => {
      if (child.visible === false) {
        return;
      }
      visit(child, id, page, indices[i], child.isMask ? '' : currentMask);
      if (child.isMask) {
        currentMask = shapeIdFor(opts.idPrefix, child.id);
      }
    });
  }

  visit(root, undefined, IDENTITY, 'a1', '');
  return { rootId: shapeIdFor(opts.idPrefix, root.id), shapes, warnings };
}
