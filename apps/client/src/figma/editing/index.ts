import type { Editor } from 'tldraw';

import { enableFigmaEditing } from './engine';
import { installFigmaSelection } from './selection';
import { measureText } from './text-measure';

// See apps/docs/figma-to-tldraw/tech.md §13.

export { isFigmaEditing, relayoutAll, withoutFigmaEffects } from './engine';
export { figmaTextOptions } from './rich-text';

/** Turns on resizing, constraints, auto layout, text editing and Figma-style selection. */
export function startFigmaEditing(editor: Editor): () => void {
  const stopEngine = enableFigmaEditing(editor, measureText);
  const stopSelection = installFigmaSelection(editor);
  return () => {
    stopSelection();
    stopEngine();
  };
}
