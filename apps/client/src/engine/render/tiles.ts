import type { Canvas, CanvasKit, Image, Surface } from 'canvaskit-wasm';

import { Box } from '../geometry';
import type { TLPageId } from '../types';
import type { SceneRenderer } from './renderer';

// See apps/docs/skia-engine/tech.md §5.5.

const TILE = 512;
/** Tiles and the overview are drawn this many pixels square at a time. */
const PIECE = 128;
const OVERVIEW_PIECE = 512;
const ZOOM_SETTLE_MS = 120;
/** Share of the frame budget spent on new tiles while the zoom is changing. */
const ZOOMING_BUDGET = 0.4;
const OVERVIEW_PX = 2048;

interface Tile {
  i: number;
  j: number;
  surface: Surface;
  image: Image | null;
  /** Whether the whole tile has been drawn once. */
  valid: boolean;
  /** Level-space rects (integer pixels) to redraw. */
  dirty: Box[];
  used: number;
}

interface Level {
  scale: number;
  tiles: Map<string, Tile>;
}

interface Overview {
  scale: number;
  /** Page-space origin of the overview image. */
  x: number;
  y: number;
  w: number;
  h: number;
  surface: Surface;
  image: Image | null;
  dirty: Box[];
}

export interface TileView {
  camera: { x: number; y: number; z: number };
  /** Viewport size in CSS pixels. */
  width: number;
  height: number;
  dpr: number;
}

export interface TileDrawResult {
  /** More tiles are waiting; draw another frame. */
  pending: boolean;
}

/**
 * Adds `r` to the rects still to draw, merged per `cell`-sized grid square so
 * many small changes cost at most one redraw per square.
 */
function addDirty(dirty: Box[], r: Box, cell: number) {
  const i0 = Math.floor(r.x / cell);
  const i1 = Math.floor((r.x + r.w - 1e-6) / cell);
  const j0 = Math.floor(r.y / cell);
  const j1 = Math.floor((r.y + r.h - 1e-6) / cell);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const part = Box.Intersect(r, new Box(i * cell, j * cell, cell, cell));
      if (!part || part.w <= 0 || part.h <= 0) {
        continue;
      }
      const same = dirty.find(
        (d) => Math.floor(d.x / cell) === i && Math.floor(d.y / cell) === j,
      );
      if (same) {
        const x = Math.min(same.x, part.x);
        const y = Math.min(same.y, part.y);
        same.w = Math.max(same.x + same.w, part.x + part.w) - x;
        same.h = Math.max(same.y + same.h, part.y + part.h) - y;
        same.x = x;
        same.y = y;
      } else {
        dirty.push(part);
      }
    }
  }
}

function quantize(scale: number) {
  return 2 ** (Math.round(Math.log2(scale) * 4) / 4);
}

/** Caches the scene in device-pixel tiles per zoom level. */
export class TileCache {
  readonly ck: CanvasKit;
  readonly renderer: SceneRenderer;
  background: Float32Array;
  private levels = new Map<number, Level>();
  private overview: Overview | null = null;
  private pageId: TLPageId | null = null;
  private lastScale = 0;
  private lastScaleChange = 0;
  private frame = 0;
  readonly stats = { rendered: 0, partial: 0 };

  constructor(
    ck: CanvasKit,
    renderer: SceneRenderer,
    background: Float32Array,
  ) {
    this.ck = ck;
    this.renderer = renderer;
    this.background = background;
  }

  dispose() {
    this.clear();
  }

  /** Throws away every tile (page switch, context loss, background change). */
  clear() {
    for (const level of this.levels.values()) {
      for (const t of level.tiles.values()) {
        this.dropTile(t);
      }
    }
    this.levels.clear();
    if (this.overview) {
      this.overview.image?.delete();
      this.overview.surface.delete();
      this.overview = null;
    }
  }

  private dropTile(t: Tile) {
    t.image?.delete();
    t.surface.delete();
  }

  /** Marks page-space areas as changed. */
  invalidate(areas: Box[], currentScale: number) {
    if (!areas.length) {
      return;
    }
    for (const level of this.levels.values()) {
      for (const area of areas) {
        const s = level.scale;
        const r = new Box(
          Math.floor(area.x * s) - 1,
          Math.floor(area.y * s) - 1,
          0,
          0,
        );
        r.w = Math.ceil((area.x + area.w) * s) + 1 - r.x;
        r.h = Math.ceil((area.y + area.h) * s) + 1 - r.y;
        const i0 = Math.floor(r.x / TILE);
        const i1 = Math.floor((r.x + r.w) / TILE);
        const j0 = Math.floor(r.y / TILE);
        const j1 = Math.floor((r.y + r.h) / TILE);
        for (let i = i0; i <= i1; i++) {
          for (let j = j0; j <= j1; j++) {
            const t = level.tiles.get(`${i},${j}`);
            if (!t) {
              continue;
            }
            if (level.scale !== currentScale) {
              this.dropTile(t);
              level.tiles.delete(`${i},${j}`);
            } else {
              const clip = Box.Intersect(
                r,
                new Box(i * TILE, j * TILE, TILE, TILE),
              );
              if (clip) {
                addDirty(t.dirty, clip, PIECE);
              }
            }
          }
        }
      }
    }
    const o = this.overview;
    if (o) {
      const bounds = new Box(0, 0, o.w, o.h);
      for (const area of areas) {
        const r = Box.Intersect(
          bounds,
          new Box(
            Math.floor((area.x - o.x) * o.scale) - 1,
            Math.floor((area.y - o.y) * o.scale) - 1,
            Math.ceil(area.w * o.scale) + 3,
            Math.ceil(area.h * o.scale) + 3,
          ),
        );
        if (r) {
          addDirty(o.dirty, r, OVERVIEW_PIECE);
        }
      }
    }
  }

  private level(scale: number): Level {
    let l = this.levels.get(scale);
    if (!l) {
      l = { scale, tiles: new Map() };
      this.levels.set(scale, l);
    }
    return l;
  }

  /** Draws the scene into `target` (device pixels) with `scale` and offset. */
  private paintScene(
    canvas: Canvas,
    scale: number,
    originX: number,
    originY: number,
    rect: Box,
  ) {
    const ck = this.ck;
    canvas.save();
    canvas.clipRect(
      ck.XYWHRect(rect.x - originX, rect.y - originY, rect.w, rect.h),
      ck.ClipOp.Intersect,
      false,
    );
    canvas.clear(this.background);
    canvas.translate(-originX, -originY);
    canvas.scale(scale, scale);
    const view = new Box(
      rect.x / scale,
      rect.y / scale,
      rect.w / scale,
      rect.h / scale,
    );
    if (this.pageId) {
      this.renderer.drawPage(canvas, this.pageId, { view, scale });
    }
    canvas.restore();
  }

  // See apps/docs/skia-engine/tech.md §5.5.
  /**
   * Draws the tile's pending rects until `deadline` (at least one with `force`).
   * Returns false while some are left; the tile shows only once complete.
   */
  private renderTile(
    level: Level,
    t: Tile,
    deadline: number,
    force: boolean,
  ): boolean {
    const canvas = t.surface.getCanvas();
    let drew = false;
    while (
      t.dirty.length &&
      ((force && !drew) || performance.now() < deadline)
    ) {
      const r = t.dirty.shift()!;
      this.paintScene(canvas, level.scale, t.i * TILE, t.j * TILE, r);
      t.surface.flush();
      drew = true;
    }
    if (t.dirty.length) {
      return false;
    }
    t.image?.delete();
    t.image = t.surface.makeImageSnapshot();
    if (t.valid) {
      this.stats.partial++;
    } else {
      t.valid = true;
      this.stats.rendered++;
    }
    return true;
  }

  private makeSurface(main: Surface, w: number, h: number): Surface | null {
    return main.makeSurface({
      width: w,
      height: h,
      colorType: this.ck.ColorType.RGBA_8888,
      alphaType: this.ck.AlphaType.Premul,
      colorSpace: this.ck.ColorSpace.SRGB,
    });
  }

  private ensureOverview(main: Surface) {
    if (this.overview || !this.pageId) {
      return;
    }
    const content = this.renderer.getPageContentBounds(this.pageId);
    if (!content || content.w <= 0 || content.h <= 0) {
      return;
    }
    const scale = Math.min(1, OVERVIEW_PX / Math.max(content.w, content.h));
    const w = Math.max(1, Math.ceil(content.w * scale));
    const h = Math.max(1, Math.ceil(content.h * scale));
    const surface = this.makeSurface(main, w, h);
    if (!surface) {
      return;
    }
    const dirty: Box[] = [];
    addDirty(dirty, new Box(0, 0, w, h), OVERVIEW_PIECE);
    this.overview = {
      scale,
      x: content.x,
      y: content.y,
      w,
      h,
      surface,
      image: null,
      dirty,
    };
  }

  /** Like `renderTile`; the previous overview stays up until the new one is complete. */
  private renderOverview(deadline: number) {
    const o = this.overview;
    if (!o?.dirty.length) {
      return;
    }
    const canvas = o.surface.getCanvas();
    const ox = o.x * o.scale;
    const oy = o.y * o.scale;
    let drew = false;
    while (o.dirty.length && (!drew || performance.now() < deadline)) {
      const r = o.dirty.shift()!;
      this.paintScene(
        canvas,
        o.scale,
        ox,
        oy,
        new Box(r.x + ox, r.y + oy, r.w, r.h),
      );
      o.surface.flush();
      drew = true;
    }
    if (!o.dirty.length) {
      o.image?.delete();
      o.image = o.surface.makeImageSnapshot();
    }
  }

  /** Draws the visible area of `pageId` onto `main`. */
  draw(
    main: Surface,
    pageId: TLPageId,
    view: TileView,
    budgetMs = 8,
  ): TileDrawResult {
    const ck = this.ck;
    if (pageId !== this.pageId) {
      this.clear();
      this.pageId = pageId;
    }
    this.frame++;
    const now = performance.now();
    const { camera, dpr } = view;
    const exact = camera.z * dpr;
    if (exact !== this.lastScale) {
      this.lastScale = exact;
      this.lastScaleChange = now;
    }
    const settled = now - this.lastScaleChange >= ZOOM_SETTLE_MS;
    const scale = settled || this.levels.has(exact) ? exact : quantize(exact);
    const level = this.level(scale);
    let pending = !settled;

    const dw = Math.ceil(view.width * dpr);
    const dh = Math.ceil(view.height * dpr);
    // Device offset of level space: device = level · (exact / scale) + cam · exact.
    const ratio = exact / scale;
    const ox = camera.x * exact;
    const oy = camera.y * exact;
    const toLevel = (d: number, o: number) => (d - o) / ratio;
    const i0 = Math.floor(toLevel(0, ox) / TILE);
    const i1 = Math.floor(toLevel(dw, ox) / TILE);
    const j0 = Math.floor(toLevel(0, oy) / TILE);
    const j1 = Math.floor(toLevel(dh, oy) / TILE);

    const deadline = now + (settled ? budgetMs : budgetMs * ZOOMING_BUDGET);
    this.ensureOverview(main);
    if (this.overview?.dirty.length && (!this.overview.image || settled)) {
      this.renderOverview(deadline);
      pending ||= this.overview.dirty.length > 0;
    }

    const visible: Tile[] = [];
    const stale: Tile[] = [];
    const missing: Tile[] = [];
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const key = `${i},${j}`;
        let t = level.tiles.get(key);
        if (!t) {
          const surface = this.makeSurface(main, TILE, TILE);
          if (!surface) {
            continue;
          }
          t = { i, j, surface, image: null, valid: false, dirty: [], used: 0 };
          addDirty(t.dirty, new Box(i * TILE, j * TILE, TILE, TILE), PIECE);
          level.tiles.set(key, t);
        }
        t.used = this.frame;
        visible.push(t);
        if (!t.valid) {
          missing.push(t);
        } else if (t.dirty.length) {
          stale.push(t);
        }
      }
    }
    const cx = (i0 + i1) / 2;
    const cy = (j0 + j1) / 2;
    missing.sort(
      (a, b) =>
        (a.i - cx) ** 2 + (a.j - cy) ** 2 - ((b.i - cx) ** 2 + (b.j - cy) ** 2),
    );
    for (const [n, t] of [...stale, ...missing].entries()) {
      const force = n === 0 && settled;
      if (!force && performance.now() >= deadline) {
        pending = true;
        break;
      }
      pending = !this.renderTile(level, t, deadline, force) || pending;
    }

    const canvas = main.getCanvas();
    canvas.clear(this.background);
    const o = this.overview;
    if (o?.image) {
      canvas.save();
      canvas.translate(ox, oy);
      canvas.scale(exact, exact);
      canvas.translate(o.x, o.y);
      canvas.scale(1 / o.scale, 1 / o.scale);
      canvas.drawImageOptions(
        o.image,
        0,
        0,
        ck.FilterMode.Linear,
        ck.MipmapMode.None,
        null,
      );
      canvas.restore();
    }
    for (const other of this.levels.values()) {
      if (other === level) {
        continue;
      }
      this.drawLevel(canvas, other, exact, ox, oy, dw, dh, false);
    }
    this.drawLevel(canvas, level, exact, ox, oy, dw, dh, ratio === 1);
    this.evict(level, visible.length);
    return { pending };
  }

  private drawLevel(
    canvas: Canvas,
    level: Level,
    exact: number,
    ox: number,
    oy: number,
    dw: number,
    dh: number,
    crisp: boolean,
  ) {
    const ck = this.ck;
    const ratio = exact / level.scale;
    const size = TILE * ratio;
    for (const t of level.tiles.values()) {
      if (!t.valid || !t.image) {
        continue;
      }
      const x = t.i * size + ox;
      const y = t.j * size + oy;
      if (x > dw || y > dh || x + size < 0 || y + size < 0) {
        continue;
      }
      if (crisp) {
        canvas.drawImageOptions(
          t.image,
          Math.round(x),
          Math.round(y),
          ck.FilterMode.Nearest,
          ck.MipmapMode.None,
          null,
        );
      } else {
        canvas.drawImageRectOptions(
          t.image,
          ck.XYWHRect(0, 0, TILE, TILE),
          ck.XYWHRect(x, y, size, size),
          ck.FilterMode.Linear,
          ck.MipmapMode.None,
          null,
        );
      }
    }
  }

  /** Keeps the GPU memory bounded: one fallback level, then least recently used tiles. */
  private evict(current: Level, visibleCount: number) {
    const others = [...this.levels.values()]
      .filter((l) => l !== current)
      .map((l) => {
        let used = 0;
        for (const t of l.tiles.values()) {
          used = Math.max(used, t.used);
        }
        return { l, used };
      })
      .sort((a, b) => b.used - a.used);
    for (const { l } of others.slice(1)) {
      for (const t of l.tiles.values()) {
        this.dropTile(t);
      }
      this.levels.delete(l.scale);
    }
    const max = visibleCount * 2 + 32;
    let total = 0;
    for (const l of this.levels.values()) {
      total += l.tiles.size;
    }
    if (total <= max) {
      return;
    }
    const all: [Level, string, Tile][] = [];
    for (const l of this.levels.values()) {
      for (const [k, t] of l.tiles) {
        if (t.used !== this.frame) {
          all.push([l, k, t]);
        }
      }
    }
    all.sort((a, b) => a[2].used - b[2].used);
    for (const [l, k, t] of all.slice(0, total - max)) {
      this.dropTile(t);
      l.tiles.delete(k);
    }
  }

  /** Whether the overview still has stale areas to redraw. */
  hasIdleWork() {
    return !!this.overview?.dirty.length;
  }
}
