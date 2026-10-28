import { type Editor, getCanvasController, react } from '../../engine';

// See apps/docs/figma-to-tldraw/tech.md §13.6.
// See apps/docs/skia-engine/tech.md §5.8.

const SLIDE_MS = 150;

export interface DragStyle {
  /** Call while a layer is dragged inside auto layout. */
  show(): void;
  dispose(): void;
}

export function installDragStyle(editor: Editor): DragStyle {
  let active = false;
  let ending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const remove = () => {
    active = false;
    ending = false;
    const scene = getCanvasController(editor)?.scene;
    scene?.setLifted([]);
    scene?.setSlideMs(0);
    getCanvasController(editor)?.requestFrame();
  };
  const stop = react('figma drag style', () => {
    if (!editor.isIn('select.translating') && active) {
      clearTimeout(timer);
      ending = true;
      timer = setTimeout(remove, SLIDE_MS);
    }
  });
  return {
    show() {
      if (active && !ending) {
        return;
      }
      clearTimeout(timer);
      active = true;
      ending = false;
      const lifted = editor.getShapeAndDescendantIds(
        editor.getSelectedShapeIds(),
      );
      const scene = getCanvasController(editor)?.scene;
      scene?.setLifted(
        editor
          .getCurrentPageShapesSorted()
          .filter((s) => lifted.has(s.id))
          .map((s) => s.id),
      );
      scene?.setSlideMs(SLIDE_MS);
    },
    dispose() {
      stop();
      clearTimeout(timer);
      if (active) {
        remove();
      }
    },
  };
}
