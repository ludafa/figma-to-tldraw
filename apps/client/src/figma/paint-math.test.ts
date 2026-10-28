import { describe, expect, it } from 'vitest';

import { ellipsePerimeter, fitDashes, gradientMatrix } from './paint-math';
import type { FigmaPaint } from './types';

const stops = [
  { position: 0, color: { r: 0, g: 0, b: 1, a: 1 } },
  { position: 1, color: { r: 1, g: 0, b: 0, a: 1 } },
];

describe('gradientMatrix', () => {
  it('maps the gradient handles onto the node box', () => {
    const paint: FigmaPaint = {
      type: 'GRADIENT_LINEAR',
      gradientStops: stops,
      gradientHandlePositions: [
        { x: 0, y: 0.5 },
        { x: 0.5, y: 0.5 },
        { x: 0, y: 1 },
      ],
    };
    expect(gradientMatrix(paint, 200, 100)).toEqual([
      [100, 0, 0],
      [0, 50, 50],
    ]);
  });

  it('defaults to a left-to-right gradient', () => {
    const paint: FigmaPaint = { type: 'GRADIENT_LINEAR', gradientStops: stops };
    expect(gradientMatrix(paint, 200, 100)).toEqual([
      [200, 0, 0],
      [0, 50, 50],
    ]);
  });
});

describe('fitDashes', () => {
  it('stretches the pattern to a whole number of periods', () => {
    const { intervals, phase } = fitDashes([4, 2], 100);
    expect(intervals[0] + intervals[1]).toBeCloseTo(100 / 17, 6);
    expect(phase).toBeCloseTo(intervals[0] / 2, 6);
  });
});

describe('ellipsePerimeter', () => {
  it('is 2πr for a circle', () => {
    expect(ellipsePerimeter(20, 20)).toBeCloseTo(2 * Math.PI * 10, 6);
  });
});
