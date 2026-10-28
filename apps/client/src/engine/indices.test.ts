import { describe, expect, it } from 'vitest';

import {
  getIndexAbove,
  getIndexBelow,
  getIndexBetween,
  getIndices,
  getIndicesBetween,
  sortByIndex,
} from './indices';

describe('fractional indices', () => {
  it('generates keys strictly between two keys', () => {
    let lo = getIndexAbove();
    let hi = getIndexAbove(lo);
    for (let i = 0; i < 50; i++) {
      const mid = getIndexBetween(lo, hi);
      expect(mid > lo && mid < hi).toBe(true);
      if (i % 2) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
  });

  it('keeps above and below ordered', () => {
    const a = getIndexAbove();
    expect(getIndexAbove(a) > a).toBe(true);
    expect(getIndexBelow(a) < a).toBe(true);
  });

  it('returns n sorted keys', () => {
    const keys = getIndices(30);
    expect(keys).toHaveLength(30);
    expect([...keys].sort()).toEqual(keys);
    const between = getIndicesBetween(keys[3], keys[4], 5);
    expect(between).toHaveLength(5);
    for (const k of between) {
      expect(k > keys[3] && k < keys[4]).toBe(true);
    }
  });

  it('sorts records by index', () => {
    const keys = getIndices(3);
    const sorted = [{ index: keys[2] }, { index: keys[0] }, { index: keys[1] }]
      .sort(sortByIndex)
      .map((r) => r.index);
    expect(sorted).toEqual(keys);
  });
});
