import type { FigmaImageFilters } from './types';

// See apps/docs/figma-to-tldraw/tech.md §6.8.

const FILTER_KEYS: (keyof FigmaImageFilters)[] = [
  'exposure',
  'contrast',
  'saturation',
  'temperature',
  'tint',
  'highlights',
  'shadows',
];

export function filteredImageKey(
  imageRef: string,
  filters: FigmaImageFilters | undefined,
): string | undefined {
  if (!filters) {
    return undefined;
  }
  const parts = FILTER_KEYS.flatMap((k) => {
    const v = Math.round((filters[k] ?? 0) * 1000) / 1000;
    return v !== 0 ? [`${k}=${v}`] : [];
  });
  return parts.length ? `${imageRef}?${parts.join('&')}` : undefined;
}

// See apps/docs/figma-to-tldraw/tech.md §6.8.
export const STORED_SCALE: Partial<Record<keyof FigmaImageFilters, number>> = {
  contrast: 0.3,
};

/** A filter as Figma's slider shows it, -1 to 1. */
export function sliderValue(
  filters: FigmaImageFilters | undefined,
  key: keyof FigmaImageFilters,
): number {
  const v = (filters?.[key] ?? 0) / (STORED_SCALE[key] ?? 1);
  return Math.max(-1, Math.min(1, v));
}

// See apps/docs/figma-to-tldraw/tech.md §22.3.
export const FILTER_ORDER: (keyof FigmaImageFilters)[] = [
  'tint',
  'temperature',
  'contrast',
  'highlights',
  'shadows',
  'exposure',
  'saturation',
];

export const LUT_STEPS = [
  -1, -0.9, -0.8, -0.7, -0.6, -0.5, -0.4, -0.3, -0.2, -0.15, -0.1, -0.05, 0,
  0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1,
];

export function lutUrl(key: keyof FigmaImageFilters, v: number): string {
  return v === 0
    ? '/filter-luts/identity.png'
    : `/filter-luts/${key}/${v.toFixed(2)}.png`;
}

export interface LutLayer {
  lo: string;
  hi: string;
  /** How far the value is from `lo` towards `hi`, 0 to 1. */
  t: number;
}

/** One color table pair per filter that is on, in the order Figma applies them. */
export function lutLayers(filters: FigmaImageFilters | undefined): LutLayer[] {
  return FILTER_ORDER.flatMap((key) => {
    const v = sliderValue(filters, key);
    if (Math.abs(v) < 0.0005) {
      return [];
    }
    let i = 0;
    while (i < LUT_STEPS.length - 2 && LUT_STEPS[i + 1] < v) {
      i++;
    }
    const lo = LUT_STEPS[i];
    const hi = LUT_STEPS[i + 1];
    return [
      { lo: lutUrl(key, lo), hi: lutUrl(key, hi), t: (v - lo) / (hi - lo) },
    ];
  });
}
