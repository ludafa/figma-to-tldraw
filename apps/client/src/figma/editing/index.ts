import type { Editor } from 'tldraw';

import { enableFigmaEditing } from './engine';
import { installFigmaSelection } from './selection';
import { installFigmaSnapping } from './snapping';
import { measureText } from './text-measure';

// See apps/docs/figma-to-tldraw/tech.md §13.

export { isFigmaEditing, relayoutAll, withoutFigmaEffects } from './engine';
export { FigmaStylePanel } from './panel';
export { figmaTextOptions } from './rich-text';

/** Turns on resizing, constraints, auto layout, Figma-style selection and snapping. */
export function startFigmaEditing(editor: Editor): () => void {
  const stopEngine = enableFigmaEditing(editor, measureText);
  const stopSelection = installFigmaSelection(editor);
  const stopSnapping = installFigmaSnapping(editor);
  return () => {
    stopSnapping();
    stopSelection();
    stopEngine();
  };
}
