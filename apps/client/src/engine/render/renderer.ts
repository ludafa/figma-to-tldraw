import type { Canvas, CanvasKit, Paint, SkPicture } from 'canvaskit-wasm';

import type { Editor } from '../editor';
import { Box, Mat } from '../geometry';
import type { ClipShape, PaintContext, ShapeUtil } from '../shape-util';
import type { RecordsDiff } from '../store';
import {
  isShapeId,
  type TLPageId,
  type TLParentId,
  type TLRecord,
  type TLShape,
  type TLShapeId,
} from '../types';
import type { Resources } from './resources';
import { blendModeOf } from './svg';

// See apps/docs/skia-engine/tech.md §5.

interface PictureEntry {
  props: unknown;
  key: unknown;
  picture: SkPicture | null;
  after: SkPicture | null;
  complete: boolean;
  version: number;
  /** `floor(log2(scale))` the drawing picked image sizes for; null when it didn't. */
  bucket: number | null;
  /** The drawing for another scale bucket. */
  alt?: PictureEntry;
}

function dropEntry(e: PictureEntry | undefined) {
  e?.picture?.delete();
  e?.after?.delete();
  e?.alt?.picture?.delete();
  e?.alt?.after?.delete();
}

interface Slide {
  /** Offset from the new position, in the parent's space, at `start`. */
  dx: number;
  dy: number;
  start: number;
  ms: number;
}

export interface SceneDrawOptions {
  /** Page-space area to draw; subtrees outside it are skipped. */
  view: Box;
  /** Device pixels per page unit, for picking image sizes. */
  scale?: number;
  /** Don't draw this shape's own content (its children still draw). */
  skipSelf?: (id: TLShapeId) => boolean;
}

export function applyClip(ck: CanvasKit, canvas: Canvas, clip: ClipShape) {
  switch (clip.kind) {
    case 'rect':
      canvas.clipRect(clip.rect, ck.ClipOp.Intersect, true);
      break;
    case 'rrect':
      canvas.clipRRect(clip.rrect, ck.ClipOp.Intersect, true);
      break;
    case 'path':
      canvas.clipPath(clip.path, ck.ClipOp.Intersect, true);
      break;
  }
}

/** Draws a page's shape tree with per-shape picture caching. */
export class SceneRenderer {
  readonly editor: Editor;
  readonly resources: Resources;
  readonly ck: CanvasKit;
  private pictures = new Map<TLShapeId, PictureEntry>();
  /** Shapes whose cached drawing waited for a resource. */
  private incomplete = new Set<TLShapeId>();
  /** Subtree render bounds in each shape's own space. */
  private localBounds = new Map<TLShapeId, Box | null>();
  /** Page-space subtree bounds from the last draw or query. */
  private pageBounds = new Map<TLShapeId, Box>();
  // See apps/docs/skia-engine/tech.md §5.10.
  private stalePageBounds = new Map<TLShapeId, Box>();
  private layerPaint: Paint;
  private stopApply: () => void;
  readonly stats = { recorded: 0, drawn: 0 };

  constructor(editor: Editor, resources: Resources, ck: CanvasKit) {
    this.editor = editor;
    this.resources = resources;
    this.ck = ck;
    this.layerPaint = new ck.Paint();
    this.stopApply = editor.store.onApply((diff) => this.invalidate(diff));
  }

  dispose() {
    this.stopApply();
    for (const e of this.pictures.values()) {
      dropEntry(e);
    }
    this.pictures.clear();
    this.incomplete.clear();
    this.layerPaint.delete();
  }

  /** Drops every cached drawing (e.g. after the GL context was lost). */
  clearPictures() {
    for (const e of this.pictures.values()) {
      dropEntry(e);
    }
    this.pictures.clear();
    this.incomplete.clear();
  }

  private forgetBounds(id: TLParentId) {
    let parent: TLParentId = id;
    while (isShapeId(parent)) {
      this.localBounds.delete(parent);
      this.dropPageBounds(parent);
      const p = this.editor.store.unsafeGetWithoutCapture<TLShape>(parent);
      if (!p) {
        break;
      }
      parent = p.parentId;
    }
  }

  private dropPageBounds(id: TLShapeId) {
    const b = this.pageBounds.get(id);
    if (b) {
      this.stalePageBounds.set(id, b);
      this.pageBounds.delete(id);
    }
  }

  private forgetPageBoundsBelow(id: TLShapeId) {
    for (const child of this.editor.store.sortedChildIds(id)) {
      this.dropPageBounds(child);
      this.forgetPageBoundsBelow(child);
    }
  }

  private hidden: TLShapeId | null = null;

  // See apps/docs/skia-engine/tech.md §6.7.
  setHidden(id: TLShapeId | null) {
    if (id === this.hidden) {
      return;
    }
    for (const changed of [this.hidden, id]) {
      if (changed) {
        this.pendingIds.add(changed);
      }
    }
    this.hidden = id;
  }

  private lifted: TLShapeId[] = [];
  private liftedSet = new Set<TLShapeId>();
  private drawingLifted = false;
  private slideMs = 0;
  private slides = new Map<TLShapeId, Slide>();
  private now = 0;
  /** Inside a sliding subtree: drawn page bounds aren't the real ones. */
  private animDepth = 0;

  // See apps/docs/skia-engine/tech.md §5.8.
  setLifted(ids: TLShapeId[]) {
    for (const id of [...this.lifted, ...ids]) {
      this.pendingIds.add(id);
    }
    this.lifted = ids;
    this.liftedSet = new Set(ids);
  }

  // See apps/docs/skia-engine/tech.md §5.8.
  setSlideMs(ms: number) {
    this.slideMs = ms;
  }

  /** Advances slide animations to `now`; true while any is still running. */
  tick(now: number): boolean {
    this.now = now;
    for (const [id, slide] of this.slides) {
      const area = this.slideArea(id, slide);
      if (area) {
        this.pendingDirty.push(area);
      }
      if (now - slide.start >= slide.ms) {
        this.slides.delete(id);
      }
    }
    return this.slides.size > 0;
  }

  private slideOffset(
    id: TLShapeId,
    at: number,
  ): { x: number; y: number } | null {
    const slide = this.slides.get(id);
    if (!slide) {
      return null;
    }
    const t = Math.min(1, Math.max(0, (at - slide.start) / slide.ms));
    const k = 1 - easeInOut(t);
    return { x: slide.dx * k, y: slide.dy * k };
  }

  /** Page area a slide sweeps: its subtree at the new position and at the start offset. */
  private slideArea(id: TLShapeId, slide: Slide): Box | null {
    const shape = this.editor.store.unsafeGetWithoutCapture<TLShape>(id);
    const local = shape && this.getSubtreeLocalBounds(id);
    if (!shape || !local) {
      return null;
    }
    const page = this.editor.getShapePageTransform(id);
    const to = Mat.applyToBounds(page, local);
    const parent = isShapeId(shape.parentId)
      ? this.editor.getShapePageTransform(shape.parentId)
      : new Mat();
    const from = Mat.applyToBounds(
      Mat.Compose(
        parent,
        Mat.Translate(slide.dx, slide.dy),
        Mat.Inverse(parent),
        page,
      ),
      local,
    );
    return Box.Common([to, from]);
  }

  private startSlide(from: TLShape, to: TLShape) {
    if (
      !this.slideMs ||
      this.liftedSet.has(to.id) ||
      from.parentId !== to.parentId ||
      from.rotation !== to.rotation ||
      (from.x === to.x && from.y === to.y)
    ) {
      return;
    }
    const now = performance.now();
    const current = this.slideOffset(to.id, now) ?? { x: 0, y: 0 };
    this.slides.set(to.id, {
      dx: current.x + from.x - to.x,
      dy: current.y + from.y - to.y,
      start: now,
      ms: this.slideMs,
    });
  }

  /** Old page bounds of every shape the diff touches, before forgetting them. */
  private pendingDirty: Box[] = [];
  private pendingIds = new Set<TLShapeId>();

  private invalidate(diff: RecordsDiff) {
    const touch = (rec: TLRecord, removed = false) => {
      if (rec.typeName !== 'shape') {
        return;
      }
      const id = rec.id as TLShapeId;
      // See apps/docs/skia-engine/tech.md §5.10.
      const old = this.pageBounds.get(id) ?? this.stalePageBounds.get(id);
      if (old) {
        this.pendingDirty.push(old);
      }
      if (!removed) {
        this.pendingIds.add(id);
      }
      this.forgetBounds(id);
      this.forgetBounds((rec as TLShape).parentId);
      this.forgetPageBoundsBelow(id);
      if (removed) {
        this.stalePageBounds.delete(id);
        dropEntry(this.pictures.get(id));
        this.pictures.delete(id);
        this.incomplete.delete(id);
      }
    };
    for (const rec of Object.values(diff.added)) {
      touch(rec);
    }
    for (const [from, to] of Object.values(diff.updated)) {
      touch(from);
      touch(to);
      if (from.typeName === 'shape') {
        this.startSlide(from as TLShape, to as TLShape);
      }
    }
    for (const rec of Object.values(diff.removed)) {
      touch(rec, true);
    }
  }

  /**
   * Page-space areas that changed since the last call: the old bounds of
   * changed shapes and their new bounds.
   */
  takeDirtyAreas(): Box[] {
    const out = this.pendingDirty;
    for (const id of this.pendingIds) {
      const b = this.getSubtreePageBounds(id);
      if (b) {
        out.push(b);
      }
    }
    this.pendingDirty = [];
    this.pendingIds.clear();
    return out;
  }

  /** Bounds of everything a shape and its descendants draw, in its own space. */
  getSubtreeLocalBounds(id: TLShapeId): Box | null {
    const hit = this.localBounds.get(id);
    if (hit !== undefined) {
      return hit;
    }
    const editor = this.editor;
    const shape = editor.store.unsafeGetWithoutCapture<TLShape>(id);
    if (!shape) {
      return null;
    }
    const util = editor.getShapeUtil(shape);
    let box = Box.From(util.getRenderBounds(shape));
    const kids = editor.store.sortedChildIds(id);
    if (kids.length) {
      const boxes: Box[] = [];
      for (const kid of kids) {
        const child = editor.store.unsafeGetWithoutCapture<TLShape>(kid);
        const b = child && this.getSubtreeLocalBounds(kid);
        if (child && b) {
          boxes.push(
            Mat.applyToBounds(editor.getShapeLocalTransform(child), b),
          );
        }
      }
      if (boxes.length) {
        let kidsBox = Box.Common(boxes);
        if (util.clipsChildren(shape)) {
          const g = editor.getShapeGeometry(shape).bounds;
          kidsBox = Box.Intersect(kidsBox, g) ?? new Box(g.x, g.y, 0, 0);
        }
        box = Box.Common([box, kidsBox]);
      }
    }
    this.localBounds.set(id, box);
    return box;
  }

  getSubtreePageBounds(id: TLShapeId): Box | null {
    const hit = this.pageBounds.get(id);
    if (hit) {
      return hit;
    }
    const local = this.getSubtreeLocalBounds(id);
    if (!local) {
      return null;
    }
    const b = Mat.applyToBounds(this.editor.getShapePageTransform(id), local);
    this.pageBounds.set(id, b);
    return b;
  }

  /** Union of the page's drawn content. */
  getPageContentBounds(pageId: TLPageId): Box | null {
    const boxes: Box[] = [];
    for (const id of this.editor.store.sortedChildIds(pageId)) {
      const b = this.getSubtreePageBounds(id as TLShapeId);
      if (b) {
        boxes.push(b);
      }
    }
    return boxes.length ? Box.Common(boxes) : null;
  }

  private record(
    shape: TLShape,
    util: ShapeUtil,
    which: 'paint' | 'paintAfterChildren',
    scale: number | undefined,
  ): SkPicture | null {
    const ck = this.ck;
    const rb = util.getRenderBounds(shape);
    const pad = Math.max(rb.w, rb.h, 10);
    const rec = new ck.PictureRecorder();
    const canvas = rec.beginRecording(
      ck.XYWHRect(rb.x - pad, rb.y - pad, rb.w + pad * 2, rb.h + pad * 2),
    );
    const trash: { delete(): void }[] = [];
    const ctx: PaintContext = {
      ck,
      canvas,
      resources: this.resources,
      scale,
      keep: (obj) => {
        trash.push(obj);
        return obj;
      },
    };
    try {
      if (which === 'paint') {
        util.paint(shape, ctx);
      } else {
        util.paintAfterChildren?.(shape, ctx);
      }
    } catch (e) {
      console.error(`painting ${shape.id} failed`, e);
    }
    const picture = rec.finishRecordingAsPicture();
    rec.delete();
    for (const t of trash) {
      t.delete();
    }
    this.stats.recorded++;
    return picture;
  }

  // See apps/docs/skia-engine/tech.md §5.1.
  private entry(
    shape: TLShape,
    util: ShapeUtil,
    scale: number | undefined,
  ): PictureEntry {
    const key = util.getPaintKey?.(shape);
    const version = this.resources.version.__unsafe__getWithoutCapture();
    const bucket = scale === undefined ? null : Math.floor(Math.log2(scale));
    const same = (e: PictureEntry) =>
      e.props === shape.props &&
      Object.is(e.key, key) &&
      (e.complete || e.version === version);
    const fits = (e: PictureEntry) =>
      same(e) && (e.bucket === null || e.bucket === bucket);
    const e = this.pictures.get(shape.id);
    if (e && fits(e)) {
      return e;
    }
    const prevAlt = e?.alt;
    if (e && prevAlt && fits(prevAlt)) {
      e.alt = undefined;
      prevAlt.alt = e;
      this.pictures.set(shape.id, prevAlt);
      this.noteComplete(shape.id, prevAlt.complete && e.complete);
      return prevAlt;
    }
    const drawScale = bucket === null ? undefined : 2 ** (bucket + 1);
    let after: SkPicture | null = null;
    const {
      value: picture,
      complete,
      scaled,
    } = this.resources.track(() => {
      const p = this.record(shape, util, 'paint', drawScale);
      if (util.paintAfterChildren) {
        after = this.record(shape, util, 'paintAfterChildren', drawScale);
      }
      return p;
    });
    const next: PictureEntry = {
      props: shape.props,
      key,
      picture,
      after,
      complete,
      version,
      bucket: scaled ? bucket : null,
    };
    for (const old of [e, prevAlt]) {
      if (!old) {
        continue;
      }
      old.alt = undefined;
      const keep =
        !next.alt &&
        next.bucket !== null &&
        old.bucket !== null &&
        old.bucket !== next.bucket &&
        old.complete &&
        same(old);
      if (keep) {
        next.alt = old;
      } else {
        old.picture?.delete();
        old.after?.delete();
      }
    }
    this.pictures.set(shape.id, next);
    this.noteComplete(shape.id, complete);
    return next;
  }

  private noteComplete(id: TLShapeId, complete: boolean) {
    if (complete) {
      this.incomplete.delete(id);
    } else {
      this.incomplete.add(id);
    }
  }

  // See apps/docs/skia-engine/tech.md §5.
  /** Drops drawings that waited for a resource and marks their areas changed. */
  markIncompleteDirty() {
    for (const id of this.incomplete) {
      const b = this.getSubtreePageBounds(id);
      if (b) {
        this.pendingDirty.push(b);
      }
      dropEntry(this.pictures.get(id));
      this.pictures.delete(id);
    }
    this.incomplete.clear();
  }

  /** Whether some cached drawing is waiting for a resource. */
  hasIncomplete(): boolean {
    return this.incomplete.size > 0;
  }

  drawPage(canvas: Canvas, pageId: TLPageId, opts: SceneDrawOptions) {
    const root = new Mat();
    for (const id of this.editor.store.sortedChildIds(pageId)) {
      this.drawShape(canvas, id as TLShapeId, root, opts);
    }
    if (this.lifted.length) {
      this.drawingLifted = true;
      for (const id of this.lifted) {
        const shape = this.editor.store.unsafeGetWithoutCapture<TLShape>(id);
        if (shape && !this.liftedSet.has(shape.parentId as TLShapeId)) {
          this.drawLifted(canvas, shape, opts);
        }
      }
      this.drawingLifted = false;
    }
  }

  /** Draws a lifted shape on top, inside its ancestors' transforms, clips and opacity. */
  private drawLifted(canvas: Canvas, shape: TLShape, opts: SceneDrawOptions) {
    const editor = this.editor;
    const ck = this.ck;
    const chain: TLShape[] = [];
    for (let id = shape.parentId; isShapeId(id);) {
      const p = editor.store.unsafeGetWithoutCapture<TLShape>(id);
      if (!p) {
        break;
      }
      chain.unshift(p);
      id = p.parentId;
    }
    const saved = canvas.getSaveCount();
    const depth = this.animDepth;
    canvas.save();
    let mat = new Mat();
    let alpha = 1;
    for (const a of chain) {
      if (editor.getShapeVisibility(a) === 'hidden') {
        this.animDepth = depth;
        canvas.restoreToCount(saved);
        return;
      }
      const local = this.localTransform(a);
      mat = Mat.Multiply(mat, local);
      canvas.concat(local.toSkia());
      alpha *= a.opacity;
      const util = editor.getShapeUtil(a);
      const clip = util.clipsChildren(a) ? util.getClip?.(a, ck) : undefined;
      if (clip) {
        applyClip(ck, canvas, clip);
      }
    }
    if (alpha < 1) {
      this.layerPaint.setAlphaf(alpha);
      this.layerPaint.setBlendMode(ck.BlendMode.SrcOver);
      this.layerPaint.setImageFilter(null);
      canvas.saveLayer(this.layerPaint);
    }
    this.drawShape(canvas, shape.id, mat, opts);
    this.animDepth = depth;
    canvas.restoreToCount(saved);
  }

  /** The shape's local transform, moved by its slide offset if it's sliding. */
  private localTransform(shape: TLShape): Mat {
    const local = this.editor.getShapeLocalTransform(shape);
    const offset = this.slides.size
      ? this.slideOffset(shape.id, this.now)
      : null;
    if (!offset) {
      return local;
    }
    this.animDepth++;
    return Mat.Multiply(Mat.Translate(offset.x, offset.y), local);
  }

  /** Draws one shape and its subtree; `parent` is its parent's page transform. */
  drawShape(
    canvas: Canvas,
    id: TLShapeId,
    parent: Mat,
    opts: SceneDrawOptions,
  ) {
    const editor = this.editor;
    const ck = this.ck;
    const shape = editor.store.unsafeGetWithoutCapture<TLShape>(id);
    if (
      !shape ||
      editor.getShapeVisibility(shape) === 'hidden' ||
      (!this.drawingLifted && this.liftedSet.has(id))
    ) {
      return;
    }
    const util = editor.getShapeUtil(shape);
    const lb = this.getSubtreeLocalBounds(id);
    if (!lb) {
      return;
    }
    const depth = this.animDepth;
    const local = this.localTransform(shape);
    const mat = Mat.Multiply(parent, local);
    const pb = Mat.applyToBounds(mat, lb);
    if (!this.animDepth) {
      this.pageBounds.set(id, pb);
    }
    if (!opts.view.collides(pb)) {
      this.animDepth = depth;
      return;
    }
    const saved = canvas.getSaveCount();
    canvas.save();
    canvas.concat(local.toSkia());
    const sub = util.getSubtreeClip?.(shape, ck);
    if (sub) {
      applyClip(ck, canvas, sub);
    }
    const style = util.getLayerStyle?.(shape);
    const blend = style?.blendMode
      ? blendModeOf(ck, style.blendMode)
      : undefined;
    if (shape.opacity < 1 || blend || style?.blur || style?.isolate) {
      const p = this.layerPaint;
      p.setAlphaf(shape.opacity);
      p.setBlendMode(blend ?? ck.BlendMode.SrcOver);
      const filter = style?.blur
        ? ck.ImageFilter.MakeBlur(
            style.blur,
            style.blur,
            ck.TileMode.Decal,
            null,
          )
        : null;
      p.setImageFilter(filter);
      canvas.saveLayer(p);
      p.setImageFilter(null);
      filter?.delete();
    }
    const scale =
      opts.scale === undefined
        ? undefined
        : opts.scale * Math.sqrt(Math.abs(mat.a * mat.d - mat.b * mat.c));
    const e = this.entry(shape, util, scale);
    const skip = id === this.hidden || !!opts.skipSelf?.(id);
    if (e.picture && !skip) {
      canvas.drawPicture(e.picture);
      this.stats.drawn++;
    }
    const kids = editor.store.sortedChildIds(id);
    if (kids.length) {
      const clip = util.clipsChildren(shape)
        ? util.getClip?.(shape, ck)
        : undefined;
      if (clip) {
        canvas.save();
        applyClip(ck, canvas, clip);
      }
      for (const kid of kids) {
        this.drawShape(canvas, kid, mat, opts);
      }
      if (clip) {
        canvas.restore();
      }
    }
    if (e.after && !skip) {
      canvas.drawPicture(e.after);
    }
    canvas.restoreToCount(saved);
    this.animDepth = depth;
  }
}

/** CSS `ease-in-out`, i.e. `cubic-bezier(0.42, 0, 0.58, 1)`. */
export function easeInOut(t: number): number {
  if (t <= 0 || t >= 1) {
    return t <= 0 ? 0 : 1;
  }
  const bx = (u: number) =>
    3 * 0.42 * u * (1 - u) ** 2 + 3 * 0.58 * u ** 2 * (1 - u) + u ** 3;
  const by = (u: number) => 3 * u ** 2 * (1 - u) + u ** 3;
  let lo = 0;
  let hi = 1;
  let u = t;
  for (let i = 0; i < 30; i++) {
    const x = bx(u);
    if (Math.abs(x - t) < 1e-6) {
      break;
    }
    if (x < t) {
      lo = u;
    } else {
      hi = u;
    }
    u = (lo + hi) / 2;
  }
  return by(u);
}
