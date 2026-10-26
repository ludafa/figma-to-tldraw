import { describe, expect, it } from 'vitest';

import {
  fontFamilyCss,
  fontStyleCss,
  fontVariationCss,
  primaryFontShorthand,
} from './fonts';

describe('font substitutes', () => {
  it('puts the substitute right after a font we cannot load', () => {
    const style = { fontFamily: 'Product Sans', fontWeight: 400 };
    expect(fontFamilyCss(style)).toBe(
      '"Product Sans", "Google Sans Flex Variable", "Inter", "Noto Sans SC", sans-serif',
    );
    expect(fontVariationCss(style)).toBe('"wdth" 93.5, "opsz" 18');
    expect(primaryFontShorthand(style)).toBe('normal 400 16px "Product Sans"');
  });

  it('leaves other fonts alone', () => {
    const style = { fontFamily: 'Inter', fontWeight: 400 };
    expect(fontFamilyCss(style)).toBe(
      '"Inter", "Inter", "Noto Sans SC", sans-serif',
    );
    expect(fontVariationCss(style)).toBeUndefined();
  });
});

describe('italic', () => {
  it('slants Inter and uses the real italic face of other fonts', () => {
    expect(fontStyleCss({ fontFamily: 'Inter', italic: true })).toBe(
      'oblique 10deg',
    );
    expect(fontStyleCss({ fontFamily: 'Lato', italic: true })).toBe('italic');
    expect(fontStyleCss({ fontFamily: 'Lato' })).toBe('normal');
  });
});
