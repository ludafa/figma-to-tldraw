import type { Editor } from 'tldraw';

import { enableFigmaEditing } from './engine';
import { installFigmaSelection } from './selection';

// See apps/docs/figma-to-tldraw/tech.md §13.

export { isFigmaEditing, relayoutAll, withoutFigmaEffects } from './engine';

/** Turns on resizing, constraints, auto layout and Figma-style selection. */
export function startFigmaEditing(editor: Editor): () => void {
  const stopEngine = enableFigmaEditing(editor);
  const stopSelection = installFigmaSelection(editor);
  return () => {
    stopSelection();
    stopEngine();
  };
}
