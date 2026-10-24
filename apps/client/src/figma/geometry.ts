import { apply } from './matrix';
import type { FigmaColor, FigmaNode, Matrix2x3 } from './types';

// See apps/docs/figma-to-tldraw/tech.md §5 and §6.5.

export function rgba(color: FigmaColor, opacity = 1): string {
  const r = Math.round(color.r * 255);
  const g = Math.round(color.g * 255);
  const b = Math.round(color.b * 255);
  const a = Math.round(color.a * opacity * 1000) / 1000;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export type Radii = [number, number, number, number];

export function cornerRadii(node: FigmaNode): Radii {
  if (node.rectangleCornerRadii) {
    return node.rectangleCornerRadii;
  }
  const r = node.cornerRadius ?? 0;
  return [r, r, r, r];
}

// See apps/docs/figma-to-tldraw/tech.md §6.5.
export function clampRadii(radii: Radii, w: number, h: number): Radii {
  const [tl, tr, br, bl] = radii;
  const f = Math.min(
    1,
    w / Math.max(tl + tr, 1e-9),
    h / Math.max(tr + br, 1e-9),
    w / Math.max(br + bl, 1e-9),
    h / Math.max(bl + tl, 1e-9),
  );
  return [tl * f, tr * f, br * f, bl * f];
}

export function borderRadiusCss(radii: Radii): string {
  return radii.map((r) => `${r}px`).join(' ');
}

const K = 0.5522847498;

type Point = [number, number];
type Segment = ['M', Point] | ['L', Point] | ['C', Point, Point, Point] | ['Z'];

function roundedRectSegments(
  x: number,
  y: number,
  w: number,
  h: number,
  radii: Radii,
): Segment[] {
  const [tl, tr, br, bl] = clampRadii(radii, w, h);
  const segs: Segment[] = [['M', [x + tl, y]]];
  segs.push(['L', [x + w - tr, y]]);
  if (tr > 0) {
    segs.push([
      'C',
      [x + w - tr + tr * K, y],
      [x + w, y + tr - tr * K],
      [x + w, y + tr],
    ]);
  }
  segs.push(['L', [x + w, y + h - br]]);
  if (br > 0) {
    segs.push([
      'C',
      [x + w, y + h - br + br * K],
      [x + w - br + br * K, y + h],
      [x + w - br, y + h],
    ]);
  }
  segs.push(['L', [x + bl, y + h]]);
  if (bl > 0) {
    segs.push([
      'C',
      [x + bl - bl * K, y + h],
      [x, y + h - bl + bl * K],
      [x, y + h - bl],
    ]);
  }
  segs.push(['L', [x, y + tl]]);
  if (tl > 0) {
    segs.push(['C', [x, y + tl - tl * K], [x + tl - tl * K, y], [x + tl, y]]);
  }
  segs.push(['Z']);
  return segs;
}

function ellipseSegments(w: number, h: number): Segment[] {
  const rx = w / 2;
  const ry = h / 2;
  const kx = rx * K;
  const ky = ry * K;
  return [
    ['M', [w, ry]],
    ['C', [w, ry + ky], [rx + kx, h], [rx, h]],
    ['C', [rx - kx, h], [0, ry + ky], [0, ry]],
    ['C', [0, ry - ky], [rx - kx, 0], [rx, 0]],
    ['C', [rx + kx, 0], [w, ry - ky], [w, ry]],
    ['Z'],
  ];
}

function segmentsToPath(segs: Segment[], m?: Matrix2x3): string {
  const fmt = ([px, py]: Point) => {
    const [x, y] = m ? apply(m, px, py) : [px, py];
    return `${Math.round(x * 1000) / 1000} ${Math.round(y * 1000) / 1000}`;
  };
  return segs
    .map((s) => {
      if (s[0] === 'Z') {
        return 'Z';
      }
      if (s[0] === 'C') {
        return `C ${fmt(s[1])} ${fmt(s[2])} ${fmt(s[3])}`;
      }
      return `${s[0]} ${fmt(s[1])}`;
    })
    .join(' ');
}

export function roundedRectPath(
  x: number,
  y: number,
  w: number,
  h: number,
  radii: Radii,
  m?: Matrix2x3,
): string {
  return segmentsToPath(roundedRectSegments(x, y, w, h, radii), m);
}

export interface PathPiece {
  d: string;
  length: number;
}

// See apps/docs/figma-to-tldraw/tech.md §6.2.
export function roundedRectPieces(
  x: number,
  y: number,
  w: number,
  h: number,
  radii: Radii,
): PathPiece[] {
  const segs = roundedRectSegments(x, y, w, h, radii);
  const pieces: PathPiece[] = [];
  let cur: Point = [x, y];
  for (const s of segs) {
    if (s[0] === 'M') {
      cur = s[1];
      continue;
    }
    if (s[0] === 'Z') {
      continue;
    }
    const start = cur;
    const end = s[0] === 'L' ? s[1] : s[3];
    const chord = Math.hypot(end[0] - start[0], end[1] - start[1]);
    const length = s[0] === 'L' ? chord : (Math.PI / 2) * (chord / Math.SQRT2);
    if (length > 1e-6) {
      pieces.push({
        d: segmentsToPath([['M', start], s]),
        length,
      });
    }
    cur = end;
  }
  const first = segs[0];
  const last = pieces.length ? cur : undefined;
  if (first[0] === 'M' && last) {
    const length = Math.hypot(first[1][0] - last[0], first[1][1] - last[1]);
    if (length > 1e-6) {
      pieces.push({
        d: segmentsToPath([
          ['M', last],
          ['L', first[1]],
        ]),
        length,
      });
    }
  }
  return pieces;
}

export function ellipsePath(w: number, h: number, m?: Matrix2x3): string {
  return segmentsToPath(ellipseSegments(w, h), m);
}

// See apps/docs/figma-to-tldraw/tech.md §5.1.
export function transformPath(d: string, m: Matrix2x3): string {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) ?? [];
  const out: string[] = [];
  let cmd = '';
  let cx = 0;
  let cy = 0;
  let i = 0;
  const num = () => Number(tokens[i++]);
  const pt = (x: number, y: number) => {
    const [tx, ty] = apply(m, x, y);
    return `${Math.round(tx * 1000) / 1000} ${Math.round(ty * 1000) / 1000}`;
  };
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) {
      cmd = tokens[i++];
    }
    switch (cmd) {
      case 'M':
      case 'L': {
        cx = num();
        cy = num();
        out.push(`${cmd} ${pt(cx, cy)}`);
        if (cmd === 'M') {
          cmd = 'L';
        }
        break;
      }
      case 'H': {
        cx = num();
        out.push(`L ${pt(cx, cy)}`);
        break;
      }
      case 'V': {
        cy = num();
        out.push(`L ${pt(cx, cy)}`);
        break;
      }
      case 'Q': {
        const x1 = num();
        const y1 = num();
        cx = num();
        cy = num();
        out.push(`Q ${pt(x1, y1)} ${pt(cx, cy)}`);
        break;
      }
      case 'C': {
        const x1 = num();
        const y1 = num();
        const x2 = num();
        const y2 = num();
        cx = num();
        cy = num();
        out.push(`C ${pt(x1, y1)} ${pt(x2, y2)} ${pt(cx, cy)}`);
        break;
      }
      case 'Z':
      case 'z': {
        out.push('Z');
        break;
      }
      default:
        i++;
    }
  }
  return out.join(' ');
}
