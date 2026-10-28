import type { FigmaPaint, Matrix2x3 } from './types';

// See apps/docs/figma-to-tldraw/tech.md §6.1 and §6.2.

/** Gradient space (s, t) → node pixels. */
export function gradientMatrix(paint: FigmaPaint, w: number, h: number) {
  const [p0, p1, p2] = paint.gradientHandlePositions ?? [
    { x: 0, y: 0.5 },
    { x: 1, y: 0.5 },
    { x: 0, y: 1 },
  ];
  return [
    [(p1.x - p0.x) * w, (p2.x - p0.x) * w, p0.x * w],
    [(p1.y - p0.y) * h, (p2.y - p0.y) * h, p0.y * h],
  ] satisfies Matrix2x3;
}

/** Whole dash periods along `length`, starting and ending on half a dash. */
export function fitDashes(
  pattern: number[],
  length: number,
): { intervals: number[]; phase: number } {
  const period = pattern.reduce((a, b) => a + b, 0) || 1;
  const scale = length / (Math.max(1, Math.round(length / period)) * period);
  const intervals = pattern.map((v) => v * scale);
  return { intervals, phase: intervals[0] / 2 };
}

export function ellipsePerimeter(w: number, h: number): number {
  const a = w / 2;
  const b = h / 2;
  return Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
}
