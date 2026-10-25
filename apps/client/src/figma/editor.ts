import type { Editor } from 'tldraw';

import { withoutFigmaEffects } from './editing/engine';
import type { FigmaShape } from './shape-types';
import { snapshotToShapes } from './to-shapes';
import type { Snapshot } from './types';

// See apps/docs/figma-to-tldraw/tech.md §4.

export function putSnapshot(
  editor: Editor,
  snapshot: Snapshot,
  idPrefix: string,
  assetBase: string,
): string[] {
  const { shapes, warnings } = snapshotToShapes(snapshot, {
    idPrefix,
    assetBase,
  });
  withoutFigmaEffects(editor, () =>
    editor.run(() => {
      editor.selectNone();
      editor.deleteShapes([...editor.getCurrentPageShapeIds()]);
      editor.createShapes<FigmaShape>(shapes);
    }),
  );
  return [...snapshot.meta.warnings, ...warnings];
}
