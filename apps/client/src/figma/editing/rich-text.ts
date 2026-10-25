import { Extension, Mark } from '@tiptap/core';
import {
  type TLRichText,
  type TLTextOptions,
  tipTapDefaultExtensions,
} from 'tldraw';

import type { FigmaNode, FigmaTypeStyle } from '../types';

// See apps/docs/figma-to-tldraw/tech.md §13.3.

export const FIGMA_STYLE_MARK = 'figmaStyle';
export const FIGMA_BREAK_ATTR = 'figmaBreak';

const PARAGRAPH = '\n';
const LINE_BREAK = ' ';

const FigmaStyle = Mark.create({
  name: FIGMA_STYLE_MARK,
  addAttributes() {
    return {
      key: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute('data-figma-style') ?? 0),
        renderHTML: (attrs) => ({ 'data-figma-style': attrs.key }),
      },
      css: {
        default: '',
        parseHTML: (el) => el.getAttribute('style') ?? '',
        renderHTML: (attrs) => ({ style: attrs.css }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-figma-style]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['span', HTMLAttributes, 0];
  },
});

const FigmaBreak = Extension.create({
  name: FIGMA_BREAK_ATTR,
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'hardBreak'],
        attributes: {
          [FIGMA_BREAK_ATTR]: { default: null, renderHTML: () => ({}) },
        },
      },
    ];
  },
});

/** Passed to `<Tldraw textOptions>`; must stay one object for the page's lifetime. */
export const figmaTextOptions = {
  tipTapConfig: {
    extensions: [...tipTapDefaultExtensions, FigmaStyle, FigmaBreak],
  },
} satisfies TLTextOptions;

interface MarkJson {
  type: string;
  attrs?: Record<string, unknown>;
}

interface NodeJson {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: MarkJson[];
  content?: NodeJson[];
}

/** Figma's characters and per-character style keys as a TipTap document. */
export function toRichText(
  node: FigmaNode,
  cssFor: (key: number) => string,
): TLRichText {
  const chars = node.characters ?? '';
  const overrides = node.characterStyleOverrides ?? [];
  const paragraphs: NodeJson[] = [];
  let content: NodeJson[] = [];
  let run = '';
  let runKey = 0;
  const flush = () => {
    if (run) {
      content.push({
        type: 'text',
        text: run,
        ...(runKey && {
          marks: [
            {
              type: FIGMA_STYLE_MARK,
              attrs: { key: runKey, css: cssFor(runKey) },
            },
          ],
        }),
      });
    }
    run = '';
  };
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    const key = overrides[i] ?? 0;
    if (ch === PARAGRAPH || ch === LINE_BREAK) {
      flush();
      const attrs = { [FIGMA_BREAK_ATTR]: key };
      if (ch === LINE_BREAK) {
        content.push({ type: 'hardBreak', attrs });
      } else {
        paragraphs.push({ type: 'paragraph', attrs, content });
        content = [];
      }
      continue;
    }
    if (key !== runKey) {
      flush();
      runKey = key;
    }
    run += ch;
  }
  flush();
  paragraphs.push({ type: 'paragraph', content });
  for (const p of paragraphs) {
    if (!p.content?.length) {
      delete p.content;
    }
  }
  return { type: 'doc', content: paragraphs };
}

/** What TipTap's own marks (Cmd+B and friends) mean in Figma terms. */
function markStyle(marks: MarkJson[] | undefined): FigmaTypeStyle | undefined {
  let out: FigmaTypeStyle | undefined;
  for (const mark of marks ?? []) {
    if (mark.type === 'bold') {
      out = { ...out, fontWeight: 700 };
    } else if (mark.type === 'italic') {
      out = { ...out, italic: true };
    } else if (mark.type === 'strike') {
      out = { ...out, textDecoration: 'STRIKETHROUGH' };
    }
  }
  return out;
}

function textBlocks(node: NodeJson, out: NodeJson[] = []): NodeJson[] {
  if (node.type === 'paragraph' || node.type === 'heading') {
    out.push(node);
  } else {
    node.content?.forEach((child) => textBlocks(child, out));
  }
  return out;
}

/** The inverse of `toRichText`; TipTap marks become new style override entries. */
export function fromRichText(doc: TLRichText, node: FigmaNode): FigmaNode {
  const table = { ...node.styleOverrideTable };
  const known = new Map(
    Object.entries(table).map(([key, style]) => [
      JSON.stringify(style),
      Number(key),
    ]),
  );
  let next = Math.max(0, ...known.values()) + 1;
  const keyFor = (key: number, marks: MarkJson[] | undefined) => {
    const extra = markStyle(marks);
    if (!extra) {
      return key;
    }
    const style = { ...(key ? table[String(key)] : undefined), ...extra };
    const id = JSON.stringify(style);
    let found = known.get(id);
    if (found === undefined) {
      found = next++;
      table[String(found)] = style;
      known.set(id, found);
    }
    return found;
  };

  let chars = '';
  const keys: number[] = [];
  const blocks = textBlocks(doc as NodeJson);
  blocks.forEach((block, i) => {
    let last = 0;
    for (const child of block.content ?? []) {
      if (child.type === 'text' && child.text) {
        const styleMark = child.marks?.find((m) => m.type === FIGMA_STYLE_MARK);
        const key = keyFor(Number(styleMark?.attrs?.key ?? 0), child.marks);
        chars += child.text;
        keys.push(...Array.from({ length: child.text.length }, () => key));
        last = key;
      } else if (child.type === 'hardBreak') {
        chars += LINE_BREAK;
        keys.push(Number(child.attrs?.[FIGMA_BREAK_ATTR] ?? last));
      }
    }
    if (i < blocks.length - 1) {
      chars += PARAGRAPH;
      keys.push(Number(block.attrs?.[FIGMA_BREAK_ATTR] ?? last));
    }
  });
  while (keys.length && !keys[keys.length - 1]) {
    keys.pop();
  }

  const out: FigmaNode = { ...node, characters: chars };
  if (keys.length || node.characterStyleOverrides) {
    out.characterStyleOverrides = keys;
  }
  if (Object.keys(table).length || node.styleOverrideTable) {
    out.styleOverrideTable = table;
  }
  return out;
}
