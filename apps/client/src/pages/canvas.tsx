import 'tldraw/tldraw.css';
import '../figma/figma.css';

import { type Editor, Tldraw } from 'tldraw';

import hello from '../figma/fixtures/hello.json';
import type { FigmaShape } from '../figma/shape-types';
import { figmaShapeUtils } from '../figma/shapes';
import { snapshotToShapes } from '../figma/to-shapes';
import type { Snapshot } from '../figma/types';

declare global {
  interface Window {
    editor?: Editor;
  }
}

function showSnapshot(editor: Editor, snapshot: Snapshot, id: string) {
  const { shapes, warnings } = snapshotToShapes(snapshot, {
    idPrefix: id,
    assetBase: '',
  });
  for (const w of warnings) {
    console.warn(w);
  }
  editor.run(() => {
    editor.deleteShapes([...editor.getCurrentPageShapeIds()]);
    editor.createShapes<FigmaShape>(shapes);
  });
  editor.setCamera({ x: 40, y: 40, z: 1 });
}

export function CanvasPage() {
  function handleMount(editor: Editor) {
    if (import.meta.env.DEV) {
      window.editor = editor;
    }
    showSnapshot(editor, hello as unknown as Snapshot, 'fixture/hello');
  }

  return (
    <div className="fixed inset-0">
      <Tldraw shapeUtils={figmaShapeUtils} onMount={handleMount} />
    </div>
  );
}
