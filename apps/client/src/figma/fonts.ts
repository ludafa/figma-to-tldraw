import type { FigmaTypeStyle } from './types';

// See apps/docs/figma-to-tldraw/tech.md §6.4.

const FALLBACK = '"Inter", "Noto Sans SC", sans-serif';

// See apps/docs/figma-to-tldraw/tech.md §15.
export const OPEN_FONTS = new Set([
  'Inter',
  'Noto Sans SC',
  'Red Hat Display',
  'Poppins',
  'Montserrat',
  'Lato',
  'DM Sans',
  'Urbanist',
  'Lexend',
  'Nunito',
  'Work Sans',
  'Zilla Slab',
  'Roboto Mono',
  'Bitter',
  'Space Mono',
]);

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

// See apps/docs/figma-to-tldraw/tech.md §6.4.
export function fontStyleCss(style: FigmaTypeStyle): string {
  if (!style.italic) {
    return 'normal';
  }
  return (style.fontFamily ?? 'Inter') === 'Inter' ? 'oblique 10deg' : 'italic';
}

export function fontShorthand(style: FigmaTypeStyle, size = 16): string {
  return `${fontStyleCss(style)} ${style.fontWeight ?? 400} ${size}px ${fontFamilyCss(style)}`;
}

export function primaryFontShorthand(style: FigmaTypeStyle, size = 16): string {
  return `${fontStyleCss(style)} ${style.fontWeight ?? 400} ${size}px ${fontFamilyCss(style).split(',')[0]}`;
}
