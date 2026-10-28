import { type Editor, getCanvasKit, getSharedResources } from '../../engine';
import { disposeLayout, layoutText } from '../skia/text';
import type { FigmaNode } from '../types';

// See apps/docs/skia-engine/tech.md §7.2.

/** Lays the text out the way it is drawn; `width` undefined means auto width. */
export function measureText(
  _editor: Editor,
  node: FigmaNode,
  width: number | undefined,
  h: number,
): { w: number; h: number } {
  const ck = getCanvasKit();
  const res = getSharedResources(ck);
  const auto = width === undefined;
  const measured: FigmaNode = {
    ...node,
    style: {
      ...node.style,
      textAutoResize: auto ? 'WIDTH_AND_HEIGHT' : 'HEIGHT',
      textTruncation: 'DISABLED',
    },
  };
  const layout = layoutText(ck, res, measured, width ?? 0, h);
  const out = {
    w: auto ? layout.contentWidth : width,
    h: layout.contentHeight,
  };
  disposeLayout(layout);
  return out;
}
