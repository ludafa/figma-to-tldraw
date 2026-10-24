import type { FigmaTypeStyle } from './types';

// See apps/docs/figma-to-tldraw/tech.md §6.4.

const FALLBACK = '"Inter", "Noto Sans SC", sans-serif';

export function fontFamilyCss(style: FigmaTypeStyle): string {
  const family = style.fontFamily ?? 'Inter';
  if (family === 'Inter' && style.italic) {
    return `"InterVariable", ${FALLBACK}`;
  }
  return `"${family}", ${FALLBACK}`;
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
