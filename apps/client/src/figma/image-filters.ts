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
