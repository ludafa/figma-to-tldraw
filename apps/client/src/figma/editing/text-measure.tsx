import { renderToStaticMarkup } from 'react-dom/server';
import type { Editor } from 'tldraw';

import { TextInner } from '../shapes/figma-text';
import type { FigmaNode } from '../types';

// See apps/docs/figma-to-tldraw/tech.md §13.3.

const HOSTS = new WeakMap<Editor, HTMLDivElement>();

function hostFor(editor: Editor): HTMLDivElement {
  let host = HOSTS.get(editor);
  if (!host || !host.isConnected) {
    host = document.createElement('div');
    host.style.cssText =
      'position:absolute;left:0;top:0;visibility:hidden;pointer-events:none;contain:layout style';
    editor.getContainer().appendChild(host);
    HOSTS.set(editor, host);
  }
  return host;
}

/** Lays the text out the way it is drawn; `width` undefined means auto width. */
export function measureText(
  editor: Editor,
  node: FigmaNode,
  width: number | undefined,
  h: number,
): { w: number; h: number } {
  const host = hostFor(editor);
  host.innerHTML = renderToStaticMarkup(
    <TextInner node={node} w={width ?? 0} h={h} />,
  );
  const el = host.firstElementChild as HTMLElement;
  el.style.position = 'absolute';
  el.style.left = '0';
  el.style.top = '0';
  el.style.width = width === undefined ? 'max-content' : `${width}px`;
  const rect = el.getBoundingClientRect();
  host.innerHTML = '';
  return { w: rect.width, h: rect.height };
}
