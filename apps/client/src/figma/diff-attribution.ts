import { renderArea, type RenderArea } from './render-area';
import type { FigmaNode, FigmaPaint, FigmaRect, Snapshot } from './types';

// See apps/docs/figma-to-tldraw/tech.md §10.2.

export type DiffKind = 'text' | 'image' | 'vector' | 'shape';

export interface DiffNode {
  id: string;
  name: string;
  type: string;
  kind: DiffKind;
  pixels: number;
  box: RenderArea;
  text?: string;
  font?: string;
}

export interface DiffBreakdown {
  byKind: Record<DiffKind, number>;
  nodes: DiffNode[];
}

export interface DiffImage {
  width: number;
  height: number;
  data: Uint8Array;
}

const VECTOR_TYPES = new Set([
  'VECTOR',
  'BOOLEAN_OPERATION',
  'STAR',
  'REGULAR_POLYGON',
  'LINE',
]);

const TOP_NODES = 8;

type Cover = 'all' | 'rim' | 'none';

const visible = <T extends { visible?: boolean }>(list: T[] | undefined) =>
  (list ?? []).filter((p) => p.visible !== false);

function isOpaque(paint: FigmaPaint): boolean {
  if ((paint.opacity ?? 1) < 1) {
    return false;
  }
  if (paint.blendMode && paint.blendMode !== 'NORMAL') {
    return false;
  }
  if (paint.type === 'SOLID') {
    return (paint.color?.a ?? 1) >= 1;
  }
  if (paint.type === 'IMAGE') {
    return true;
  }
  return (paint.gradientStops ?? []).every((stop) => stop.color.a >= 1);
}

function coverOf(node: FigmaNode): Cover {
  if (node.type === 'TEXT' || VECTOR_TYPES.has(node.type)) {
    return 'all';
  }
  const fills = visible(node.fills);
  const translucent =
    (node.opacity ?? 1) < 1 ||
    (node.blendMode !== undefined &&
      node.blendMode !== 'NORMAL' &&
      node.blendMode !== 'PASS_THROUGH');
  if (!translucent && fills.some(isOpaque)) {
    return 'all';
  }
  return fills.length > 0 ||
    visible(node.strokes).length > 0 ||
    visible(node.effects).length > 0
    ? 'rim'
    : 'none';
}

function inset(r: RenderArea, d: number): RenderArea {
  return {
    x: r.x + d,
    y: r.y + d,
    width: Math.max(0, r.width - d * 2),
    height: Math.max(0, r.height - d * 2),
  };
}

function kindOf(node: FigmaNode): DiffKind {
  if (node.type === 'TEXT') {
    return 'text';
  }
  if (VECTOR_TYPES.has(node.type)) {
    return 'vector';
  }
  if (node.fills?.some((f) => f.type === 'IMAGE' && f.visible !== false)) {
    return 'image';
  }
  return 'shape';
}

function union(a: FigmaRect, b: FigmaRect | null | undefined): FigmaRect {
  if (!b) {
    return a;
  }
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

function intersect(a: RenderArea, b: RenderArea | null): RenderArea | null {
  if (!b) {
    return a;
  }
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

function fontOf(node: FigmaNode): string | undefined {
  const s = node.style;
  return s?.fontFamily ? `${s.fontFamily} ${s.fontWeight ?? 400}` : undefined;
}

export function attributeDiff(
  snapshot: Snapshot,
  diff: DiffImage,
  scale: number,
): DiffBreakdown {
  const root = snapshot.rest.document;
  const area = renderArea(snapshot);
  const origin = root.absoluteBoundingBox ?? { x: 0, y: 0 };
  const cols = Math.max(1, Math.ceil(area.width));
  const rows = Math.max(1, Math.ceil(area.height));
  const owner = new Int32Array(cols * rows).fill(-1);
  const painted: { node: FigmaNode; box: RenderArea }[] = [];

  const toArea = (r: FigmaRect): RenderArea => ({
    x: r.x - origin.x - area.x,
    y: r.y - origin.y - area.y,
    width: r.width,
    height: r.height,
  });

  const fill = (index: number, box: RenderArea, hole: RenderArea | null) => {
    const x0 = Math.max(0, Math.floor(box.x));
    const y0 = Math.max(0, Math.floor(box.y));
    const x1 = Math.min(cols, Math.ceil(box.x + box.width));
    const y1 = Math.min(rows, Math.ceil(box.y + box.height));
    const hx0 = hole ? Math.ceil(hole.x) : 0;
    const hy0 = hole ? Math.ceil(hole.y) : 0;
    const hx1 = hole ? Math.floor(hole.x + hole.width) : 0;
    const hy1 = hole ? Math.floor(hole.y + hole.height) : 0;
    for (let y = y0; y < y1; y++) {
      const row = y * cols;
      if (y >= hy0 && y < hy1 && hx1 > hx0) {
        owner.fill(index, row + x0, row + Math.max(x0, Math.min(x1, hx0)));
        owner.fill(index, row + Math.min(x1, Math.max(x0, hx1)), row + x1);
      } else {
        owner.fill(index, row + x0, row + x1);
      }
    }
  };

  const paint = (node: FigmaNode, clip: RenderArea | null) => {
    if (node.visible === false || node.absoluteRenderBounds === null) {
      return;
    }
    const bounds = node.absoluteBoundingBox;
    const own = bounds
      ? union(bounds, node.absoluteRenderBounds)
      : node.absoluteRenderBounds;
    const cover = node === root ? 'all' : coverOf(node);
    const box =
      own && !node.isMask && cover !== 'none'
        ? intersect(toArea(own), clip)
        : null;
    if (box) {
      const index = painted.push({ node, box }) - 1;
      const stroke = visible(node.strokes).length
        ? (node.strokeWeight ?? 1)
        : 0;
      const hole =
        cover === 'rim' && bounds ? inset(toArea(bounds), stroke) : null;
      fill(index, box, hole);
    }
    if (VECTOR_TYPES.has(node.type) || !node.children) {
      return;
    }
    const childClip =
      node.clipsContent && bounds ? intersect(toArea(bounds), clip) : clip;
    if (node.clipsContent && !childClip) {
      return;
    }
    const children = node.itemReverseZIndex
      ? [...node.children].reverse()
      : node.children;
    for (const child of children) {
      paint(child, childClip);
    }
  };
  paint(root, null);

  const counts = Array.from({ length: painted.length }, () => 0);
  for (let py = 0; py < diff.height; py++) {
    const row = Math.min(rows - 1, Math.floor(py / scale)) * cols;
    for (let px = 0; px < diff.width; px++) {
      const i = (py * diff.width + px) * 4;
      if (
        diff.data[i] !== 255 ||
        diff.data[i + 1] !== 0 ||
        diff.data[i + 2] !== 0
      ) {
        continue;
      }
      const index = owner[row + Math.min(cols - 1, Math.floor(px / scale))];
      if (index >= 0) {
        counts[index]++;
      }
    }
  }

  const byKind: Record<DiffKind, number> = {
    text: 0,
    image: 0,
    vector: 0,
    shape: 0,
  };
  const nodes: DiffNode[] = [];
  painted.forEach(({ node, box }, i) => {
    if (counts[i] === 0) {
      return;
    }
    const kind = kindOf(node);
    byKind[kind] += counts[i];
    nodes.push({
      id: node.id,
      name: node.name,
      type: node.type,
      kind,
      pixels: counts[i],
      box,
      ...(kind === 'text' && {
        text: node.characters?.slice(0, 40),
        font: fontOf(node),
      }),
    });
  });
  nodes.sort((a, b) => b.pixels - a.pixels);
  return { byKind, nodes: nodes.slice(0, TOP_NODES) };
}
