import { type Editor, react } from 'tldraw';

// See apps/docs/figma-to-tldraw/tech.md §13.6.

const SLIDE_MS = 150;

export interface DragStyle {
  /** Call while a layer is dragged inside auto layout. */
  show(): void;
  dispose(): void;
}

export function installDragStyle(editor: Editor): DragStyle {
  let style: HTMLStyleElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const remove = () => {
    style?.remove();
    style = undefined;
  };
  const stop = react('figma drag style', () => {
    if (!editor.isIn('select.translating') && style) {
      clearTimeout(timer);
      timer = setTimeout(remove, SLIDE_MS);
    }
  });
  return {
    show() {
      if (style) {
        return;
      }
      clearTimeout(timer);
      const lifted = editor.getShapeAndDescendantIds(
        editor.getSelectedShapeIds(),
      );
      const order = editor
        .getCurrentPageShapesSorted()
        .filter((s) => lifted.has(s.id));
      style = document.createElement('style');
      style.textContent = [
        `.tl-shape { transition: transform ${SLIDE_MS}ms ease-in-out; }`,
        ...order.map(
          (s, i) =>
            `.tl-shape[data-shape-id="${s.id}"] { transition: none; z-index: ${1_000_000 + i} !important; }`,
        ),
      ].join('\n');
      editor.getContainer().append(style);
    },
    dispose() {
      stop();
      clearTimeout(timer);
      remove();
    },
  };
}
