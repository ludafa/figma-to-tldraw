import { describe, expect, it } from 'vitest';

import { filteredImageKey } from './image-filters';

describe('filteredImageKey', () => {
  it('lists non-zero filters in a fixed order, rounded to 3 decimals', () => {
    expect(
      filteredImageKey('abc', {
        tint: 0.8530852794647217,
        exposure: 0.4985434412956238,
        contrast: -0.19719280302524567,
        saturation: 0,
      }),
    ).toBe('abc?exposure=0.499&contrast=-0.197&tint=0.853');
  });

  it('returns nothing when no filter changes the image', () => {
    expect(filteredImageKey('abc', undefined)).toBeUndefined();
    expect(filteredImageKey('abc', { exposure: 0.0001 })).toBeUndefined();
  });
});
