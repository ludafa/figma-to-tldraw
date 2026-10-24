import type { Snapshot } from './types';

// See apps/docs/figma-to-tldraw/tech.md §9.

export interface RenderArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function renderArea(snapshot: Snapshot): RenderArea {
  const doc = snapshot.rest.document;
  const box = doc.absoluteBoundingBox;
  const render = doc.absoluteRenderBounds;
  if (!box || !render) {
    return {
      x: 0,
      y: 0,
      width: snapshot.meta.width,
      height: snapshot.meta.height,
    };
  }
  return {
    x: render.x - box.x,
    y: render.y - box.y,
    width: render.width,
    height: render.height,
  };
}
