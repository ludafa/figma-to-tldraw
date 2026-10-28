// See apps/docs/skia-engine/tech.md §10.3.

export interface WallInputCase {
  dir: string;
  width: number;
  height: number;
}

export interface WallInputGroup {
  key: string;
  title: string;
  cases: WallInputCase[];
}

export interface WallBoard {
  dir: string;
  /** Prefix of the shape ids of this copy of the case. */
  idPrefix: string;
  copy: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WallSection {
  key: string;
  title: string;
  copy: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WallBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Wall {
  boards: WallBoard[];
  sections: WallSection[];
  bounds: WallBox;
  /** Height above a section reserved for its title, in page units. */
  titleBand: number;
}

interface Packed<T> {
  item: T;
  x: number;
  y: number;
}

/** Shelf packing: left to right, a new row when the next item doesn't fit. */
function shelf<T extends { w: number; h: number }>(
  items: T[],
  maxW: number,
  gapX: number,
  gapY: number,
): { placed: Packed<T>[]; w: number; h: number } {
  const placed: Packed<T>[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  let w = 0;
  for (const item of items) {
    if (x > 0 && x + item.w > maxW) {
      x = 0;
      y += rowH + gapY;
      rowH = 0;
    }
    placed.push({ item, x, y });
    x += item.w + gapX;
    rowH = Math.max(rowH, item.h);
    w = Math.max(w, x - gapX);
  }
  return { placed, w, h: y + rowH };
}

function idPrefixFor(dir: string, copy: number) {
  return copy === 0 ? dir : `${dir}~${copy + 1}`;
}

export function layoutWall(groups: WallInputGroup[], copies = 1): Wall {
  const blocks = groups
    .filter((g) => g.cases.length)
    .map((g) => {
      const widest = Math.max(...g.cases.map((c) => c.width));
      const gapX = Math.max(80, Math.round(widest * 0.1));
      const gapY = Math.max(80, Math.round(widest * 0.25));
      const area = g.cases.reduce(
        (sum, c) => sum + (c.width + gapX) * (c.height + gapY),
        0,
      );
      const maxW = Math.max(widest, Math.sqrt(area) * 1.6);
      const packed = shelf(
        g.cases.map((c) => ({ c, w: c.width, h: c.height })),
        maxW,
        gapX,
        gapY,
      );
      return { group: g, packed, w: packed.w, h: packed.h };
    });

  const total = blocks.reduce((sum, b) => sum + b.w * b.h, 0);
  const wallW = Math.sqrt(total) * 1.8;
  const titleBand = Math.round(wallW * 0.025);
  const gap = Math.round(wallW * 0.02);
  const rows = shelf(
    blocks.map((b) => ({ b, w: b.w, h: b.h + titleBand })),
    wallW,
    gap,
    gap,
  );

  const boards: WallBoard[] = [];
  const sections: WallSection[] = [];
  const copyGap = gap * 3;
  for (let copy = 0; copy < copies; copy++) {
    const ox = (copy % 2) * (rows.w + copyGap);
    const oy = Math.floor(copy / 2) * (rows.h + copyGap);
    for (const { item, x, y } of rows.placed) {
      const { b } = item;
      const sx = ox + x;
      const sy = oy + y + titleBand;
      sections.push({
        key: b.group.key,
        title: b.group.title,
        copy,
        x: sx,
        y: sy,
        w: b.w,
        h: b.h,
      });
      for (const p of b.packed.placed) {
        boards.push({
          dir: p.item.c.dir,
          idPrefix: idPrefixFor(p.item.c.dir, copy),
          copy,
          x: sx + p.x,
          y: sy + p.y,
          w: p.item.w,
          h: p.item.h,
        });
      }
    }
  }
  const cols = Math.min(copies, 2);
  const lines = Math.ceil(copies / 2);
  return {
    boards,
    sections,
    bounds: {
      x: 0,
      y: 0,
      w: cols * rows.w + (cols - 1) * copyGap,
      h: lines * rows.h + (lines - 1) * copyGap,
    },
    titleBand,
  };
}
