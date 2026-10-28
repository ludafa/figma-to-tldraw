// See apps/docs/skia-engine/tech.md §6.8.

export type TLDefaultSize = 's' | 'm' | 'l' | 'xl';

/** Stroke widths of tldraw's draw and arrow shapes. */
export const STROKE_WIDTHS: Record<TLDefaultSize, number> = {
  s: 2,
  m: 3.5,
  l: 5,
  xl: 10,
};

/** tldraw's light-theme stroke colors. */
export const STROKE_COLORS: Record<string, string> = {
  black: '#1d1d1d',
  grey: '#9fa8b2',
  'light-violet': '#e085f4',
  violet: '#ae3ec9',
  blue: '#4465e9',
  'light-blue': '#4ba1f1',
  yellow: '#f1ac4b',
  orange: '#e16919',
  green: '#099268',
  'light-green': '#4cb05e',
  'light-red': '#f87777',
  red: '#e03131',
  white: '#ffffff',
};
