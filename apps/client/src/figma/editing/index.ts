import type { Editor, TLShape } from 'tldraw';

import { isFigmaShape } from '../clip';
import { enableFigmaEditing } from './engine';
import { installComponentColors } from './instances';
import { installFigmaSelection } from './selection';
import { installFigmaSnapping } from './snapping';
import { measureText } from './text-measure';

// See apps/docs/figma-to-tldraw/tech.md §13.

export { isFigmaEditing, relayoutAll, withoutFigmaEffects } from './engine';
export { LayerTree } from './layers';
export { FigmaStylePanel } from './panel';
export { figmaTextOptions } from './rich-text';
export { FigmaToolbar, figmaTools, figmaUiOverrides } from './tools';

/** Turns on resizing, constraints, auto layout, Figma-style selection and snapping. */
export function startFigmaEditing(editor: Editor): () => void {
  const stopEngine = enableFigmaEditing(editor, measureText);
  const stopSelection = installFigmaSelection(editor);
  const stopSnapping = installFigmaSnapping(editor);
  const stopColors = installComponentColors(editor);
  return () => {
    stopColors();
    stopSnapping();
    stopSelection();
    stopEngine();
  };
}

// See apps/docs/figma-to-tldraw/tech.md §14.2.
export function figmaShapeVisibility(shape: TLShape): 'hidden' | 'inherit' {
  return isFigmaShape(shape) && shape.props.node.visible === false
    ? 'hidden'
    : 'inherit';
}
