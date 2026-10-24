import { describe, expect, it } from 'vitest';

import { roundedRectPieces } from './geometry';

describe('roundedRectPieces', () => {
  it('splits a rounded rect into four edges and four corners', () => {
    const pieces = roundedRectPieces(2, 2, 236, 116, [14, 14, 14, 14]);
    expect(pieces).toHaveLength(8);
    const lengths = pieces.map((p) => p.length);
    expect(lengths[0]).toBeCloseTo(208);
    expect(lengths[1]).toBeCloseTo((Math.PI / 2) * 14);
    expect(lengths[2]).toBeCloseTo(88);
    expect(pieces[0].d).toBe('M 16 2 L 224 2');
  });

  it('drops zero-length corners of a sharp rect', () => {
    const pieces = roundedRectPieces(0, 0, 100, 50, [0, 0, 0, 0]);
    expect(pieces.map((p) => Math.round(p.length))).toEqual([100, 50, 100, 50]);
  });
});
