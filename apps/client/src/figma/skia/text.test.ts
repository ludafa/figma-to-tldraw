import { describe, expect, it } from 'vitest';

import type { FigmaNode } from '../types';
import { paragraphs, resolvedLineHeight, textRuns } from './text';

const node = (characters: string) =>
  ({
    id: '1:1',
    name: 'text',
    type: 'TEXT',
    characters,
    style: { fontFamily: 'Inter', fontSize: 16, lineHeightPx: 24 },
  }) as unknown as FigmaNode;

const texts = (characters: string) =>
  paragraphs(textRuns(node(characters))).map((p) =>
    p.map((r) => r.text).join(''),
  );

describe('paragraphs', () => {
  it('starts a paragraph at each \\n', () => {
    expect(texts('one\ntwo\n\nfour')).toEqual(['one', 'two', '', 'four']);
  });

  it('draws \\r as a space, not a break', () => {
    expect(texts('Selected\rprojects')).toEqual(['Selected projects']);
    expect(texts('shots.\r')).toEqual(['shots. ']);
  });
});

describe('resolvedLineHeight', () => {
  const inter = {
    fontFamily: 'Inter',
    fontSize: 20,
    lineHeightPx: 24.204544067382813,
    lineHeightUnit: 'INTRINSIC_%',
  } as const;

  it('scales the base ratio for a bigger run in the same font', () => {
    expect(resolvedLineHeight(inter)).toBe(24);
    expect(resolvedLineHeight(inter, { fontSize: 40 })).toBe(48);
  });

  it("uses each font's own auto line height for runs in another font", () => {
    expect(resolvedLineHeight(inter, { fontFamily: 'Poppins' })).toBe(30);
    expect(resolvedLineHeight(inter, { fontFamily: 'Roboto Mono' })).toBe(26);
    expect(resolvedLineHeight(inter, { fontFamily: 'Noto Sans SC' })).toBe(24);
    expect(
      resolvedLineHeight(inter, { fontFamily: 'Poppins', fontSize: 28 }),
    ).toBe(42);
  });

  it('keeps fixed line heights', () => {
    const fixed = {
      ...inter,
      lineHeightPx: 24,
      lineHeightUnit: 'PIXELS',
    } as const;
    expect(resolvedLineHeight(fixed, { fontFamily: 'Poppins' })).toBe(24);
    expect(
      resolvedLineHeight(inter, { lineHeightPx: 40, lineHeightUnit: 'PIXELS' }),
    ).toBe(40);
  });
});

describe('title case', () => {
  it('leaves a run that starts mid-word alone', () => {
    const n = {
      ...node('wordsplit title case'),
      characterStyleOverrides: [0, 0, 0, 0, ...Array(16).fill(2)],
      styleOverrideTable: { 2: { textCase: 'TITLE' } },
    } as unknown as FigmaNode;
    expect(
      paragraphs(textRuns(n)).map((p) => p.map((r) => r.text).join('')),
    ).toEqual(['wordsplit Title Case']);
  });
});
