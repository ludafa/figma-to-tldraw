/// <reference types="node" />

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { getSchema } from '@tiptap/core';
import { describe, expect, it } from 'vitest';

import type { TLRichText } from '../../engine';
import type { CaseIndex, FigmaNode, Snapshot } from '../types';
import { figmaTextOptions, fromRichText, toRichText } from './rich-text';

const schema = getSchema(figmaTextOptions.tipTapConfig.extensions);

/** Through the real TipTap schema, the way the editor would hand it back. */
function viaSchema(node: FigmaNode): TLRichText {
  const doc = toRichText(node, (key) => `--k:${key}`);
  return schema.nodeFromJSON(doc).toJSON() as TLRichText;
}

function normal(node: FigmaNode) {
  const keys = [...(node.characterStyleOverrides ?? [])];
  while (keys.length && !keys[keys.length - 1]) {
    keys.pop();
  }
  return {
    characters: node.characters ?? '',
    keys,
    table: node.styleOverrideTable ?? {},
  };
}

function text(
  characters: string,
  characterStyleOverrides?: number[],
  styleOverrideTable?: FigmaNode['styleOverrideTable'],
): FigmaNode {
  return {
    id: '1:1',
    name: 't',
    type: 'TEXT',
    characters,
    ...(characterStyleOverrides && { characterStyleOverrides }),
    ...(styleOverrideTable && { styleOverrideTable }),
  };
}

type Json = {
  type: string;
  text?: string;
  content?: Json[];
  marks?: { type: string }[];
};

describe('rich text conversion', () => {
  it('keeps runs, paragraphs and line breaks', () => {
    const node = text(
      'Hi there\nsecond line\n',
      [0, 0, 0, 1, 1, 1, 1, 1, 2, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 1],
      {
        '1': { fontWeight: 700 },
        '2': { fontSize: 20 },
        '3': { italic: true },
      },
    );
    const doc = viaSchema(node) as Json;
    expect(doc.content?.map((p) => p.type)).toEqual([
      'paragraph',
      'paragraph',
      'paragraph',
    ]);
    expect(normal(fromRichText(doc as TLRichText, node))).toEqual(normal(node));
  });

  it('lets typed characters take the style of their run', () => {
    const node = text('ab', [1, 1], { '1': { fontSize: 20 } });
    const doc = viaSchema(node) as Json;
    doc.content![0].content![0].text = 'aXYb';
    const out = fromRichText(doc as TLRichText, node);
    expect(out.characters).toBe('aXYb');
    expect(out.characterStyleOverrides).toEqual([1, 1, 1, 1]);
  });

  it('turns Cmd+B into one shared override entry', () => {
    const node = text('one two', [0, 0, 0, 0, 2, 2, 2], {
      '2': { fontSize: 20 },
    });
    const doc = viaSchema(node) as Json;
    for (const t of doc.content![0].content!) {
      t.marks = [...(t.marks ?? []), { type: 'bold' }];
    }
    const out = fromRichText(doc as TLRichText, node);
    expect(out.styleOverrideTable).toEqual({
      '2': { fontSize: 20 },
      '3': { fontWeight: 700 },
      '4': { fontSize: 20, fontWeight: 700 },
    });
    expect(out.characterStyleOverrides).toEqual([3, 3, 3, 3, 4, 4, 4]);
  });

  it('handles empty text and adds no keys it did not have', () => {
    const node = text('');
    const out = fromRichText(viaSchema(node), node);
    expect(out.characters).toBe('');
    expect('characterStyleOverrides' in out).toBe(false);
    expect('styleOverrideTable' in out).toBe(false);
  });
});

const CASES = path.resolve(__dirname, '../../../../../cases');

function texts(node: FigmaNode, out: FigmaNode[] = []): FigmaNode[] {
  if (node.type === 'TEXT') {
    out.push(node);
  }
  node.children?.forEach((c) => texts(c, out));
  return out;
}

describe.skipIf(!existsSync(path.join(CASES, 'index.json')))(
  'rich text round trip over the exported cases',
  () => {
    it('gives back every text layer unchanged', () => {
      const index = JSON.parse(
        readFileSync(path.join(CASES, 'index.json'), 'utf8'),
      ) as CaseIndex;
      let count = 0;
      for (const c of index.cases) {
        const snapshot = JSON.parse(
          readFileSync(path.join(CASES, c.dir, 'snapshot.json'), 'utf8'),
        ) as Snapshot;
        for (const node of texts(snapshot.rest.document)) {
          count++;
          expect(normal(fromRichText(viaSchema(node), node)), node.id).toEqual(
            normal(node),
          );
        }
      }
      console.log(`rich text: ${count} text layers round-tripped`);
      expect(count).toBeGreaterThan(0);
    });
  },
);
