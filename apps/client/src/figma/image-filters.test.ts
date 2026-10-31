import { describe, expect, it } from 'vitest';

import { filteredImageKey, lutLayers, sliderValue } from './image-filters';

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

describe('sliderValue', () => {
  it('shows contrast at 1 / 0.3 of the stored value and clamps to -1..1', () => {
    expect(sliderValue({ contrast: -0.3 }, 'contrast')).toBeCloseTo(-1);
    expect(sliderValue({ contrast: 0.15 }, 'contrast')).toBeCloseTo(0.5);
    expect(sliderValue({ exposure: 0.4 }, 'exposure')).toBe(0.4);
    expect(sliderValue({ exposure: 1.2 }, 'exposure')).toBe(1);
    expect(sliderValue(undefined, 'tint')).toBe(0);
  });
});

describe('lutLayers', () => {
  it('picks the two measured tables around each value, in the order Figma applies them', () => {
    const layers = lutLayers({ saturation: -0.5, exposure: 0.37, tint: 0.03 });
    expect(layers.map((l) => [l.lo, l.hi])).toEqual([
      ['/filter-luts/identity.png', '/filter-luts/tint/0.05.png'],
      ['/filter-luts/exposure/0.30.png', '/filter-luts/exposure/0.40.png'],
      [
        '/filter-luts/saturation/-0.60.png',
        '/filter-luts/saturation/-0.50.png',
      ],
    ]);
    expect(layers[0].t).toBeCloseTo(0.6);
    expect(layers[1].t).toBeCloseTo(0.7);
    expect(layers[2].t).toBeCloseTo(1);
  });

  it('uses the slider value for contrast and skips filters that are off', () => {
    const layers = lutLayers({ contrast: -0.3, shadows: 0 });
    expect(layers).toEqual([
      {
        lo: '/filter-luts/contrast/-1.00.png',
        hi: '/filter-luts/contrast/-0.90.png',
        t: 0,
      },
    ]);
    expect(lutLayers(undefined)).toEqual([]);
  });
});
