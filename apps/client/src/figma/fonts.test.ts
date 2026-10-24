import { describe, expect, it } from 'vitest';

import { fontFamilyCss, fontVariationCss, primaryFontShorthand } from './fonts';

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
