import type { Editor } from './editor';
import { Box, Vec, type VecLike } from './geometry';
import { atom } from './state';
import type { TLShapeId } from './types';

// See apps/docs/skia-engine/tech.md §6.4.

export interface SnapIndicator {
  id: string;
  type: 'points';
  points: VecLike[];
}

const THRESHOLD_PX = 8;

export class SnapManager {
  private editor: Editor;
  private indicators = atom<SnapIndicator[]>('snap indicators', []);

  constructor(editor: Editor) {
    this.editor = editor;
  }

  getIndicators(): SnapIndicator[] {
    return this.indicators.get();
  }

  setIndicators(list: SnapIndicator[]) {
    this.indicators.set(list);
  }

  clearIndicators() {
    if (this.indicators.__unsafe__getWithoutCapture().length) {
      this.indicators.set([]);
    }
  }

  getSnapThreshold() {
    return THRESHOLD_PX / this.editor.getZoomLevel();
  }

  /** Siblings of the selection that are on screen. */
  getSnappableShapes(): Set<TLShapeId> {
    const editor = this.editor;
    const selected = editor.getSelectedShapes();
    const parent = selected[0]?.parentId ?? editor.getCurrentPageId();
    const skip = editor.getShapeAndDescendantIds(selected.map((s) => s.id));
    const view = editor.getViewportPageBounds();
    const out = new Set<TLShapeId>();
    for (const id of editor.getSortedChildIdsForParent(parent)) {
      if (skip.has(id)) {
        continue;
      }
      const b = editor.getShapePageBounds(id);
      if (b && view.collides(b)) {
        out.add(id);
      }
    }
    return out;
  }

  /** The nudge that snaps `moving` to the snappable shapes' edges and centres. */
  snapBox(
    moving: Box,
    axes: { x: boolean; y: boolean } = { x: true, y: true },
  ): Vec {
    const editor = this.editor;
    const threshold = this.getSnapThreshold();
    const targets: Box[] = [];
    for (const id of this.getSnappableShapes()) {
      const b = editor.getShapePageBounds(id);
      if (b) {
        targets.push(b);
      }
    }
    const best = { x: { d: Infinity, at: 0 }, y: { d: Infinity, at: 0 } };
    const mx = [moving.minX, moving.midX, moving.maxX];
    const my = [moving.minY, moving.midY, moving.maxY];
    for (const t of targets) {
      for (const tx of [t.minX, t.midX, t.maxX]) {
        for (const m of mx) {
          const d = tx - m;
          if (
            axes.x &&
            Math.abs(d) < threshold &&
            Math.abs(d) < Math.abs(best.x.d)
          ) {
            best.x = { d, at: tx };
          }
        }
      }
      for (const ty of [t.minY, t.midY, t.maxY]) {
        for (const m of my) {
          const d = ty - m;
          if (
            axes.y &&
            Math.abs(d) < threshold &&
            Math.abs(d) < Math.abs(best.y.d)
          ) {
            best.y = { d, at: ty };
          }
        }
      }
    }
    const nudge = new Vec(
      Number.isFinite(best.x.d) ? best.x.d : 0,
      Number.isFinite(best.y.d) ? best.y.d : 0,
    );
    const snapped = new Box(
      moving.x + nudge.x,
      moving.y + nudge.y,
      moving.w,
      moving.h,
    );
    const lines: SnapIndicator[] = [];
    if (Number.isFinite(best.x.d)) {
      const x = best.x.at;
      const hits = targets.filter((t) =>
        [t.minX, t.midX, t.maxX].some((v) => Math.abs(v - x) < 1e-6),
      );
      const all = Box.Common([snapped, ...hits]);
      lines.push({
        id: 'x',
        type: 'points',
        points: [
          { x, y: all.minY },
          { x, y: all.maxY },
        ],
      });
    }
    if (Number.isFinite(best.y.d)) {
      const y = best.y.at;
      const hits = targets.filter((t) =>
        [t.minY, t.midY, t.maxY].some((v) => Math.abs(v - y) < 1e-6),
      );
      const all = Box.Common([snapped, ...hits]);
      lines.push({
        id: 'y',
        type: 'points',
        points: [
          { x: all.minX, y },
          { x: all.maxX, y },
        ],
      });
    }
    this.setIndicators(lines);
    return nudge;
  }

  snapTranslateShapes(opts: {
    lockedAxis: 'x' | 'y' | null;
    initialSelectionPageBounds: Box;
    dragDelta: VecLike;
  }): { nudge: Vec } {
    const b = opts.initialSelectionPageBounds;
    const moving = new Box(
      b.x + opts.dragDelta.x,
      b.y + opts.dragDelta.y,
      b.w,
      b.h,
    );
    const nudge = this.snapBox(moving, {
      x: opts.lockedAxis !== 'y',
      y: opts.lockedAxis !== 'x',
    });
    return { nudge };
  }
}
