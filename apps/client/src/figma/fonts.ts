import type { FigmaTypeStyle } from './types';

// See apps/docs/figma-to-tldraw/tech.md §6.4.

const FALLBACK = '"Inter", "Noto Sans SC", sans-serif';

// See apps/docs/figma-to-tldraw/tech.md §6.9.
export const FONT_SUBSTITUTES: Record<
  string,
  { family: string; name: string; variation: string }
> = {
  'Product Sans': {
    family: 'Google Sans Flex Variable',
    name: 'Google Sans Flex',
    variation: '"wdth" 93.5, "opsz" 18',
  },
};

export function fontFamilyCss(style: FigmaTypeStyle): string {
  const family = style.fontFamily ?? 'Inter';
  if (family === 'Inter' && style.italic) {
    return `"InterVariable", ${FALLBACK}`;
  }
  const sub = FONT_SUBSTITUTES[family];
  return sub
    ? `"${family}", "${sub.family}", ${FALLBACK}`
    : `"${family}", ${FALLBACK}`;
}

export function fontVariationCss(style: FigmaTypeStyle): string | undefined {
  return FONT_SUBSTITUTES[style.fontFamily ?? '']?.variation;
}

export function fontStyleCss(style: FigmaTypeStyle): string {
  return style.italic ? 'oblique 10deg' : 'normal';
}

export function fontShorthand(style: FigmaTypeStyle, size = 16): string {
  return `${fontStyleCss(style)} ${style.fontWeight ?? 400} ${size}px ${fontFamilyCss(style)}`;
}

export function primaryFontShorthand(style: FigmaTypeStyle, size = 16): string {
  return `${fontStyleCss(style)} ${style.fontWeight ?? 400} ${size}px ${fontFamilyCss(style).split(',')[0]}`;
}
