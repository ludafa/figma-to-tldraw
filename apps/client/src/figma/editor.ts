import { type Editor, PageRecordType, type TLPageId } from '../engine';
import { withoutFigmaEffects } from './editing/engine';
import { variableSetOf, writeVariableSet } from './editing/variables';
import type { FigmaShape } from './shape-types';
import { snapshotToShapes } from './to-shapes';
import type { Snapshot } from './types';

// See apps/docs/figma-to-tldraw/tech.md §4.

export const COMPONENTS_PAGE: TLPageId = PageRecordType.createId('components');

export interface PutOptions {
  /** Put the main components on their own page (§16.3). */
  mains?: boolean;
}

export function putSnapshot(
  editor: Editor,
  snapshot: Snapshot,
  idPrefix: string,
  assetBase: string,
  opts: PutOptions = {},
): string[] {
  const { shapes, mains, warnings } = snapshotToShapes(snapshot, {
    idPrefix,
    assetBase,
    mains: opts.mains,
  });
  withoutFigmaEffects(editor, () =>
    editor.run(
      () => {
        editor.selectNone();
        // See apps/docs/figma-to-tldraw/tech.md §16.3.
        const [design, ...others] = editor.getPages();
        editor.setCurrentPage(design.id);
        for (const page of others) {
          editor.deleteShapes([...editor.getPageShapeIds(page.id)]);
          editor.deletePage(page.id);
        }
        editor.deleteShapes([...editor.getCurrentPageShapeIds()]);
        // See apps/docs/figma-to-tldraw/tech.md §21.3.
        writeVariableSet(editor, variableSetOf(snapshot));
        editor.createShapes<FigmaShape>(shapes);
        if (mains.length) {
          editor.createPage({ id: COMPONENTS_PAGE, name: '组件' });
          editor.createShapes<FigmaShape>(
            mains.map((s) =>
              s.parentId ? s : { ...s, parentId: COMPONENTS_PAGE },
            ),
          );
        }
      },
      { history: 'ignore' },
    ),
  );
  // See apps/docs/figma-to-tldraw/tech.md §13.
  editor.clearHistory();
  return [...snapshot.meta.warnings, ...warnings];
}
