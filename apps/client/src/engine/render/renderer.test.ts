import { describe, expect, it } from 'vitest';

import { easeInOut } from './renderer';

describe('easeInOut', () => {
  it('matches CSS ease-in-out at the ends and the middle', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 5);
  });

  it('starts and ends slowly, and is symmetric', () => {
    expect(easeInOut(0.1)).toBeLessThan(0.1);
    expect(easeInOut(0.9)).toBeGreaterThan(0.9);
    for (const t of [0.1, 0.25, 0.4]) {
      expect(easeInOut(t) + easeInOut(1 - t)).toBeCloseTo(1, 5);
    }
  });

  it('only goes forward', () => {
    let prev = 0;
    for (let i = 1; i <= 100; i++) {
      const v = easeInOut(i / 100);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});
