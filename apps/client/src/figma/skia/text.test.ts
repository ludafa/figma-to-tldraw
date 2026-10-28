import { describe, expect, it } from 'vitest';

import type { FigmaNode } from '../types';
import { paragraphs, textRuns } from './text';

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
