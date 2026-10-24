import type { Matrix2x3 } from './types';

// See apps/docs/figma-to-tldraw/tech.md §4.2.

export const IDENTITY: Matrix2x3 = [
  [1, 0, 0],
  [0, 1, 0],
];

export function translation(x: number, y: number): Matrix2x3 {
  return [
    [1, 0, x],
    [0, 1, y],
  ];
}

export function multiply(m: Matrix2x3, n: Matrix2x3): Matrix2x3 {
  const [[a, c, e], [b, d, f]] = m;
  const [[a2, c2, e2], [b2, d2, f2]] = n;
  return [
    [a * a2 + c * b2, a * c2 + c * d2, a * e2 + c * f2 + e],
    [b * a2 + d * b2, b * c2 + d * d2, b * e2 + d * f2 + f],
  ];
}

export function invert(m: Matrix2x3): Matrix2x3 {
  const [[a, c, e], [b, d, f]] = m;
  const det = a * d - b * c;
  return [
    [d / det, -c / det, (c * f - d * e) / det],
    [-b / det, a / det, (b * e - a * f) / det],
  ];
}

export function apply(m: Matrix2x3, x: number, y: number): [number, number] {
  const [[a, c, e], [b, d, f]] = m;
  return [a * x + c * y + e, b * x + d * y + f];
}

export function decompose(m: Matrix2x3): {
  x: number;
  y: number;
  rotation: number;
} {
  return { x: m[0][2], y: m[1][2], rotation: Math.atan2(m[1][0], m[0][0]) };
}

export function fromRotation(x: number, y: number, rotation: number) {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  return [
    [cos, -sin, x],
    [sin, cos, y],
  ] satisfies Matrix2x3;
}

export function toCss(m: Matrix2x3): string {
  return `matrix(${m[0][0]}, ${m[1][0]}, ${m[0][1]}, ${m[1][1]}, ${m[0][2]}, ${m[1][2]})`;
}

export function toSvg(m: Matrix2x3): string {
  return `matrix(${m[0][0]} ${m[1][0]} ${m[0][1]} ${m[1][1]} ${m[0][2]} ${m[1][2]})`;
}
