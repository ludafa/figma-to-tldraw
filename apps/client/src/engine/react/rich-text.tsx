import {
  type Extensions,
  type JSONContent,
  Editor as TipTapEditor,
} from '@tiptap/core';
import Bold from '@tiptap/extension-bold';
import Document from '@tiptap/extension-document';
import HardBreak from '@tiptap/extension-hard-break';
import History from '@tiptap/extension-history';
import Italic from '@tiptap/extension-italic';
import Paragraph from '@tiptap/extension-paragraph';
import Strike from '@tiptap/extension-strike';
import Text from '@tiptap/extension-text';
import { type CSSProperties, useLayoutEffect, useRef } from 'react';

// See apps/docs/skia-engine/tech.md §6.

export interface TLRichText {
  type: string;
  content?: unknown[];
  attrs?: Record<string, unknown>;
}

export interface TLTextOptions {
  tipTapConfig?: { extensions?: Extensions };
}

export const tipTapDefaultExtensions: Extensions = [
  Document,
  Paragraph,
  Text,
  HardBreak,
  History,
  Bold,
  Italic,
  Strike,
];

export interface RichTextAreaProps {
  richText: TLRichText;
  extensions?: Extensions;
  /** Select everything when editing starts (otherwise the caret goes to the end). */
  selectAll?: boolean;
  onChange(richText: TLRichText): void;
  /** Escape, or focus leaving the text. */
  onDone(): void;
  className?: string;
  style?: CSSProperties;
}

/** A TipTap editor over the text being edited, like tldraw's `RichTextArea`. */
export function RichTextArea(props: RichTextAreaProps) {
  const ref = useRef<HTMLDivElement>(null);
  const latest = useRef(props);
  useLayoutEffect(() => {
    latest.current = props;
  });

  useLayoutEffect(() => {
    const p = latest.current;
    const editor = new TipTapEditor({
      element: ref.current!,
      extensions: p.extensions ?? tipTapDefaultExtensions,
      content: p.richText as JSONContent,
      autofocus: p.selectAll ? 'all' : 'end',
      editorProps: {
        // See apps/docs/skia-engine/tech.md §6.7.
        attributes: { style: 'outline: none; white-space: inherit' },
        handleKeyDown: (_view, e) => {
          if (e.key === 'Escape') {
            latest.current.onDone();
            return true;
          }
          e.stopPropagation();
          return false;
        },
      },
      onUpdate: ({ editor: ed }) => {
        latest.current.onChange(ed.getJSON() as TLRichText);
      },
      onBlur: () => {
        latest.current.onDone();
      },
    });
    return () => {
      editor.destroy();
    };
  }, []);

  return (
    <div
      ref={ref}
      className={['tl-rich-text', props.className].filter(Boolean).join(' ')}
      style={props.style}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}
