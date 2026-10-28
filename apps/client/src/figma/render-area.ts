import type { Snapshot } from './types';

// See apps/docs/figma-to-tldraw/tech.md §9.

export interface RenderArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

// See apps/docs/figma-to-tldraw/tech.md §9.7.
const SECTION_EXPORT_PADDING = 40;

export function renderArea(snapshot: Snapshot): RenderArea {
  const doc = snapshot.rest.document;
  const box = doc.absoluteBoundingBox;
  const render = doc.absoluteRenderBounds;
  const area =
    box && render
      ? {
          x: render.x - box.x,
          y: render.y - box.y,
          width: render.width,
          height: render.height,
        }
      : {
          x: 0,
          y: 0,
          width: snapshot.meta.width,
          height: snapshot.meta.height,
        };
  if (doc.type !== 'SECTION') {
    return area;
  }
  const p = SECTION_EXPORT_PADDING;
  return {
    x: area.x - p,
    y: area.y - p,
    width: area.width + p * 2,
    height: area.height + p * 2,
  };
}
