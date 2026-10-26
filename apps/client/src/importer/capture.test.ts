import { describe, expect, it } from 'vitest';

import { inUnicodeRange } from './capture';

const chars = (text: string) =>
  new Set([...text].map((ch) => ch.codePointAt(0) ?? 0));

describe('inUnicodeRange', () => {
  it('keeps a face when any used character falls in its range', () => {
    expect(inUnicodeRange('U+0-FF, U+131', chars('Hi'))).toBe(true);
    expect(inUnicodeRange('U+4E00-9FFF', chars('Hi 你'))).toBe(true);
    expect(inUnicodeRange('U+4E00-9FFF', chars('Hi'))).toBe(false);
  });

  it('understands single code points and wildcards', () => {
    expect(inUnicodeRange('U+20AC', chars('€'))).toBe(true);
    expect(inUnicodeRange('U+4??', chars('Ж'))).toBe(true);
    expect(inUnicodeRange('U+4??', chars('A'))).toBe(false);
  });

  it('treats a face without a range as covering everything', () => {
    expect(inUnicodeRange('', chars('A'))).toBe(true);
  });
});
