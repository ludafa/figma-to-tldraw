import '../figma/figma.css';

import { useEffect, useState } from 'react';

import { type Editor, Tldraw } from '../engine';
import { putSnapshot } from '../figma/editor';
import { caseUrl } from '../figma/load';
import type { RenderArea } from '../figma/render-area';
import { figmaShapeUtils } from '../figma/shapes';
import type { Snapshot } from '../figma/types';

// See apps/docs/figma-to-tldraw/tech.md §10.4.

export function CaseCanvas({
  dir,
  snapshot,
  area,
  scale,
  pad,
  resetKey,
}: {
  dir: string;
  snapshot: Snapshot;
  area: RenderArea;
  scale: number;
  pad: number;
  resetKey: number;
}) {
  const [editor, setEditor] = useState<Editor | null>(null);

  useEffect(() => {
    if (!editor) {
      return;
    }
    putSnapshot(editor, snapshot, dir, caseUrl(dir));
    editor.setCurrentTool('hand');
  }, [editor, snapshot, dir, resetKey]);

  useEffect(() => {
    editor?.setCamera({
      x: pad / scale - area.x,
      y: pad / scale - area.y,
      z: scale,
    });
  }, [editor, area, scale, pad, resetKey]);

  return (
    <div className="figma-shot absolute inset-0">
      <Tldraw
        shapeUtils={figmaShapeUtils}
        hideUi
        autoFocus={false}
        onMount={setEditor}
      />
    </div>
  );
}
