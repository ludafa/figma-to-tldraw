import type { Editor } from '../engine';
import { withoutFigmaEffects } from '../figma/editing';
import { caseUrl, loadCase } from '../figma/load';
import type { FigmaShape } from '../figma/shape-types';
import { snapshotToShapes } from '../figma/to-shapes';
import type { Wall, WallBoard } from './layout';

// See apps/docs/skia-engine/tech.md §10.4.

export interface WallProgress {
  /** Cases fetched so far (each counts once, however many copies). */
  loaded: number;
  total: number;
  shapes: number;
  failed: string[];
}

export interface LoadWallOptions {
  concurrency?: number;
  isCancelled?: () => boolean;
  onProgress?: (progress: WallProgress) => void;
}

function placeCase(
  editor: Editor,
  boards: WallBoard[],
  snapshot: Awaited<ReturnType<typeof loadCase>>,
): number {
  let count = 0;
  for (const board of boards) {
    const { shapes } = snapshotToShapes(snapshot, {
      idPrefix: board.idPrefix,
      assetBase: caseUrl(board.dir),
      mains: false,
    });
    for (const s of shapes) {
      if (!s.parentId) {
        s.x = (s.x ?? 0) + board.x;
        s.y = (s.y ?? 0) + board.y;
      }
    }
    withoutFigmaEffects(editor, () =>
      editor.run(() => editor.createShapes<FigmaShape>(shapes), {
        history: 'ignore',
      }),
    );
    count += shapes.length;
  }
  return count;
}

/** Fetches every case of the wall, smallest first, and puts its shapes in place. */
export async function loadWall(
  editor: Editor,
  wall: Wall,
  opts: LoadWallOptions = {},
): Promise<WallProgress> {
  const byDir = new Map<string, WallBoard[]>();
  for (const b of wall.boards) {
    byDir.set(b.dir, [...(byDir.get(b.dir) ?? []), b]);
  }
  const queue = [...byDir.keys()].sort((a, b) => {
    const [x] = byDir.get(a)!;
    const [y] = byDir.get(b)!;
    return x.w * x.h - y.w * y.h;
  });
  const progress: WallProgress = {
    loaded: 0,
    total: queue.length,
    shapes: 0,
    failed: [],
  };
  opts.onProgress?.({ ...progress });

  const worker = async () => {
    for (let dir = queue.shift(); dir; dir = queue.shift()) {
      if (opts.isCancelled?.()) {
        return;
      }
      try {
        const snapshot = await loadCase(dir);
        if (opts.isCancelled?.()) {
          return;
        }
        progress.shapes += placeCase(editor, byDir.get(dir)!, snapshot);
      } catch (e) {
        console.error(e);
        progress.failed.push(dir);
      }
      progress.loaded++;
      opts.onProgress?.({ ...progress });
    }
  };
  await Promise.all(
    Array.from({ length: opts.concurrency ?? 4 }, () => worker()),
  );
  if (!opts.isCancelled?.()) {
    editor.clearHistory();
  }
  return progress;
}
