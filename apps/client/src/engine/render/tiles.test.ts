import { describe, expect, it } from 'vitest';

import { Box } from '../geometry';
import { overviewCovers } from './tiles';

describe('overviewCovers', () => {
  const o = { scale: 0.5, x: 100, y: 50, w: 200, h: 100 };

  it('accepts areas inside the overview and within one overview pixel', () => {
    expect(overviewCovers(o, new Box(100, 50, 400, 200))).toBe(true);
    expect(overviewCovers(o, new Box(99, 49, 402, 202))).toBe(true);
  });

  it('rejects areas that reach past it', () => {
    expect(overviewCovers(o, new Box(90, 50, 10, 10))).toBe(false);
    expect(overviewCovers(o, new Box(480, 240, 30, 30))).toBe(false);
  });
});
