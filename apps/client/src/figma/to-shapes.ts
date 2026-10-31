import {
  createShapeId,
  getIndices,
  type TLParentId,
  type TLShapeId,
  type TLShapePartial,
} from '../engine';
import { indexMains, rebuildTree } from './components';
import { filteredImageKey } from './image-filters';
import {
  decompose,
  determinant,
  IDENTITY,
  invert,
  mirrorX,
  multiply,
  translation,
} from './matrix';
import type { FigmaShape, FigmaShapeType } from './shape-types';
import type {
  FigmaNode,
  FigmaPaint,
  FigmaTextSegment,
  Matrix2x3,
  Snapshot,
} from './types';
import { withTextBindings } from './variables';

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
  /** Also lay out the main components from outside the page (§16.3). */
  mains?: boolean;
}

export interface ToShapesResult {
  rootId: TLShapeId;
  shapes: TLShapePartial<FigmaShape>[];
  /** Top-level shapes have no parent; they go on the components page. */
  mains: TLShapePartial<FigmaShape>[];
  warnings: string[];
}

/** Gap between main components on the components page. */
const MAIN_GAP = 80;
/** Main components wrap to a new row past this width. */
const MAIN_ROW = 4000;

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

export function svgSize(svg: string): { w: number; h: number } | undefined {
  const match = /<svg[^>]*?\swidth="([\d.]+)"[^>]*?\sheight="([\d.]+)"/.exec(
    svg,
  );
  return match ? { w: Number(match[1]), h: Number(match[2]) } : undefined;
}

function stripChildren(node: FigmaNode): FigmaNode {
  const { children: _children, ...rest } = node;
  return rest;
}

// See apps/docs/skia-engine/tech.md §11.4.
function withTextSegments(
  node: FigmaNode,
  segments: FigmaTextSegment[] | undefined,
): FigmaNode {
  return segments ? { ...node, textSegments: segments } : node;
}

// See apps/docs/figma-to-tldraw/tech.md §21.2.
function withVariableModes(
  raw: FigmaNode,
  variables: Snapshot['variables'],
): FigmaNode {
  const node = withTextBindings(raw);
  const own = variables?.modes[node.id];
  const inherited = variables?.inherited[node.id];
  if (!own && !inherited) {
    return node;
  }
  return {
    ...node,
    ...(own ? { explicitVariableModes: own } : {}),
    ...(inherited ? { inheritedVariableModes: inherited } : {}),
  };
}

// See apps/docs/figma-to-tldraw/tech.md §16.3.
function spanVariants(node: FigmaNode): FigmaNode {
  const boxes = node.absoluteBoundingBox
    ? []
    : (node.children ?? []).flatMap((c) =>
        c.absoluteBoundingBox ? [c.absoluteBoundingBox] : [],
      );
  if (!boxes.length) {
    return node;
  }
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return {
    ...node,
    absoluteBoundingBox: { x, y, width: right - x, height: bottom - y },
  };
}

function imagePaints(node: FigmaNode): FigmaPaint[] {
  const paints = [...(node.fills ?? []), ...(node.strokes ?? [])];
  return paints.filter((p) => p.type === 'IMAGE' && p.imageRef);
}

export function snapshotToShapes(
  snapshot: Snapshot,
  opts: ToShapesOptions,
): ToShapesResult {
  // See apps/docs/figma-to-tldraw/tech.md §16.3.
  const index = indexMains(snapshot);
  const root = rebuildTree(snapshot.rest.document, index);
  const transforms = snapshot.transforms ?? {};
  let shapes: TLShapePartial<FigmaShape>[] = [];
  const warnings: string[] = [];

  function placement(
    node: FigmaNode,
    type: FigmaShapeType,
    hidden: boolean,
  ): { m: Matrix2x3; w: number; h: number } | undefined {
    const svg = snapshot.svgs[node.id];
    // See apps/docs/figma-to-tldraw/tech.md §16.3.
    if (type === 'figma-vector' && !node.isMask && (svg || !hidden)) {
      // See apps/docs/figma-to-tldraw/tech.md §21.9.
      const rb =
        node.absoluteRenderBounds ?? snapshot.hiddenRenderBounds?.[node.id];
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

  const rootPlacement = placement(root, 'figma-frame', false);
  let origin = rootPlacement
    ? translation(-rootPlacement.m[0][2], -rootPlacement.m[1][2])
    : IDENTITY;

  function visit(
    node: FigmaNode,
    parentId: TLParentId | undefined,
    parentPage: Matrix2x3,
    index: string,
    mask: string,
    parentHidden = false,
  ) {
    // See apps/docs/figma-to-tldraw/tech.md §16.3.
    const hidden = parentHidden || node.visible === false;
    const type = shapeTypeFor(node);
    if (!type) {
      if (!hidden) {
        warnings.push(
          `不支持的节点类型 ${node.type}：${node.name}（${node.id}）`,
        );
      }
      return;
    }
    // See apps/docs/figma-to-tldraw/tech.md §9.
    if (
      type === 'figma-vector' &&
      !node.isMask &&
      !hidden &&
      node.absoluteRenderBounds === null
    ) {
      return;
    }
    const place = placement(node, type, hidden);
    if (!place) {
      if (!hidden) {
        warnings.push(`缺少位置或 SVG：${node.name}（${node.id}）`);
      }
      return;
    }

    // See apps/docs/figma-to-tldraw/tech.md §12.3.
    const flipX = determinant(place.m) < 0;
    const page = multiply(
      origin,
      flipX ? multiply(place.m, mirrorX(place.w)) : place.m,
    );
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
            `图片滤镜没有 Figma 渲染好的图，改用色表实时画：${node.name}（${node.id}）`,
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
        node: withVariableModes(
          withTextSegments(
            stripChildren(node),
            snapshot.textSegments?.[node.id],
          ),
          snapshot.variables,
        ),
        svg: node.isMask ? '' : (snapshot.svgs[node.id] ?? ''),
        images,
        imageSizes: snapshot.meta.imageSizes ?? {},
        mask,
        maskPath: snapshot.meta.masks?.[node.id] ?? '',
        flipX,
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
      visit(
        child,
        id,
        page,
        indices[i],
        child.isMask ? '' : currentMask,
        hidden,
      );
      if (child.isMask && child.visible !== false) {
        currentMask = shapeIdFor(opts.idPrefix, child.id);
      }
    });
  }

  visit(root, undefined, IDENTITY, 'a1', '');
  const pageShapes = shapes;
  shapes = [];
  if (opts.mains) {
    // See apps/docs/figma-to-tldraw/tech.md §16.3.
    let x = 0;
    let y = 0;
    let rowHeight = 0;
    const list = Object.values(snapshot.mains ?? {}).map(spanVariants);
    const indices = getIndices(list.length);
    for (const [i, main] of list.entries()) {
      const place = placement(main, 'figma-frame', false);
      if (!place) {
        continue;
      }
      if (x > 0 && x + place.w > MAIN_ROW) {
        x = 0;
        y += rowHeight + MAIN_GAP;
        rowHeight = 0;
      }
      origin = translation(x - place.m[0][2], y - place.m[1][2]);
      visit(rebuildTree(main, index), undefined, IDENTITY, indices[i], '');
      x += place.w + MAIN_GAP;
      rowHeight = Math.max(rowHeight, place.h);
    }
  }
  return {
    rootId: shapeIdFor(opts.idPrefix, root.id),
    shapes: pageShapes,
    mains: shapes,
    warnings,
  };
}
