import type { Editor, TLShape, TLShapeId, TLShapePartial } from 'tldraw';

import { isFigmaShape } from '../clip';
import type { FigmaShape } from '../shape-types';
import { isFigmaEditing } from './engine';
import { figmaChildren, figmaParent } from './host';

// See apps/docs/figma-to-tldraw/tech.md §13.1.

/**
 * tldraw asks this which layer a click selects. For Figma layers it is the
 * outermost one inside the frames the current selection already sits in.
 */
export function installFigmaSelection(editor: Editor): () => void {
  const original = editor.getOutermostSelectableShape.bind(editor);
  editor.getOutermostSelectableShape = (
    shape: TLShape | TLShapeId,
    filter?: (shape: TLShape) => boolean,
  ): TLShape => {
    const match = original(shape, filter);
    if (!isFigmaShape(match)) {
      return match;
    }
    const open = new Set<TLShapeId>();
    for (const id of editor.getSelectedShapeIds()) {
      for (const ancestor of editor.getShapeAncestors(id)) {
        open.add(ancestor.id);
      }
    }
    const chain = [...editor.getShapeAncestors(match), match];
    return chain.find((s, i) => i > 0 && !open.has(s.id)) ?? match;
  };
  // See apps/docs/figma-to-tldraw/tech.md §13.1.
  const onKeyDown = (e: KeyboardEvent) => {
    if (
      (e.key !== 'Escape' && e.key !== 'Enter') ||
      e.metaKey ||
      e.ctrlKey ||
      e.altKey ||
      !editor.getInstanceState().isFocused ||
      !editor.isIn('select.idle') ||
      (e.target as HTMLElement | null)?.closest?.(
        'input, textarea, select, [contenteditable="true"]',
      )
    ) {
      return;
    }
    const selected = editor.getSelectedShapes();
    if (!selected.length || !selected.every(isFigmaShape)) {
      return;
    }
    let next: TLShapeId[] = [];
    if (e.key === 'Escape' || e.shiftKey) {
      next = [
        ...new Set(selected.flatMap((s) => figmaParent(editor, s)?.id ?? [])),
      ];
    } else if (selected.every((s) => s.type === 'figma-frame')) {
      next = selected.flatMap((s) =>
        figmaChildren(editor, s.id).map((c) => c.id),
      );
    }
    if (!next.length) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    editor.markHistoryStoppingPoint('select parent or children');
    editor.select(...next);
  };
  window.addEventListener('keydown', onKeyDown, true);
  return () => {
    window.removeEventListener('keydown', onKeyDown, true);
    editor.getOutermostSelectableShape = original;
  };
}

/** Double click: select one level deeper. */
export function figmaDoubleClick(
  editor: Editor,
  shape: FigmaShape,
): TLShapePartial<FigmaShape> | undefined {
  const noop = { id: shape.id, type: shape.type };
  if (!isFigmaEditing(editor)) {
    return noop;
  }
  const selected = editor.getOnlySelectedShape();
  const hit = editor.getShapeAtPoint(editor.inputs.currentPagePoint, {
    hitInside: true,
    renderingOnly: true,
  });
  if (!selected || !hit) {
    return noop;
  }
  const chain = [...editor.getShapeAncestors(hit), hit];
  const at = chain.findIndex((s) => s.id === selected.id);
  const inner = at >= 0 ? chain[at + 1] : undefined;
  if (inner) {
    editor.markHistoryStoppingPoint('select inner layer');
    editor.select(inner.id);
  }
  return noop;
}
