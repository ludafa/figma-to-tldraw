import type { CanvasKit, GrDirectContext, Surface } from 'canvaskit-wasm';

import type { Editor } from '../editor';
import { Box } from '../geometry';
import { react } from '../state';
import { OverlayRenderer, readOverlayColors } from './overlay';
import { SceneRenderer } from './renderer';
import type { Resources } from './resources';
import { TileCache } from './tiles';

// See apps/docs/skia-engine/tech.md §5.

export type RenderMode = 'tiles' | 'direct';

export interface CanvasControllerOptions {
  mode: RenderMode;
  background: string;
  /** Called after each frame with the viewport-space camera layer transform. */
  onFrame?: () => void;
}

const controllers = new WeakMap<Editor, CanvasController>();

/** The controller drawing `editor`, once its canvas is up. */
export function getCanvasController(
  editor: Editor,
): CanvasController | undefined {
  return controllers.get(editor);
}

/** Owns the WebGL surface and draws a frame whenever something visible changes. */
export class CanvasController {
  readonly editor: Editor;
  readonly ck: CanvasKit;
  readonly resources: Resources;
  readonly scene: SceneRenderer;
  readonly overlay: OverlayRenderer;
  readonly tiles: TileCache;
  readonly canvas: HTMLCanvasElement;
  private opts: CanvasControllerOptions;
  private gl: GrDirectContext | null = null;
  private glHandle = 0;
  private surface: Surface | null = null;
  private size = { w: 0, h: 0, dpr: 1 };
  private raf = 0;
  private disposers: (() => void)[] = [];
  private idleWaiters: (() => void)[] = [];
  private lastVersion = -1;
  private disposed = false;
  readonly stats = { frames: 0, lastFrameMs: 0 };

  constructor(
    editor: Editor,
    ck: CanvasKit,
    resources: Resources,
    canvas: HTMLCanvasElement,
    opts: CanvasControllerOptions,
  ) {
    this.editor = editor;
    this.ck = ck;
    this.resources = resources;
    this.canvas = canvas;
    this.opts = opts;
    this.scene = new SceneRenderer(editor, resources, ck);
    this.overlay = new OverlayRenderer(editor, ck);
    this.tiles = new TileCache(ck, this.scene, this.parseBackground());
    this.initGl();
    controllers.set(editor, this);

    this.disposers.push(
      editor.store.listen(() => this.requestFrame()),
      react('skia canvas redraw', () => {
        editor.getCamera();
        editor.getCurrentPageId();
        editor.getSelectedShapeIds();
        editor.getHoveredShapeId();
        editor.getEditingShapeId();
        editor.getInstanceState();
        editor.getViewportScreenBounds();
        editor.snaps.getIndicators();
        editor.getPath();
        this.resources.version.get();
        this.requestFrame();
      }),
    );
    const lost = (e: Event) => {
      e.preventDefault();
    };
    const restored = () => {
      this.scene.clearPictures();
      this.tiles.clear();
      this.surface?.delete();
      this.surface = null;
      this.gl?.delete();
      this.gl = null;
      this.initGl();
      this.requestFrame();
    };
    canvas.addEventListener('webglcontextlost', lost);
    canvas.addEventListener('webglcontextrestored', restored);
    this.disposers.push(() => {
      canvas.removeEventListener('webglcontextlost', lost);
      canvas.removeEventListener('webglcontextrestored', restored);
    });
  }

  private parseBackground() {
    return this.ck.parseColorString(this.opts.background);
  }

  setOptions(opts: Partial<CanvasControllerOptions>) {
    const prevBg = this.opts.background;
    this.opts = { ...this.opts, ...opts };
    if (opts.background && opts.background !== prevBg) {
      this.tiles.background = this.parseBackground();
      this.tiles.clear();
    }
    this.requestFrame();
  }

  private initGl() {
    const ck = this.ck;
    // See apps/docs/skia-engine/tech.md §5.
    this.glHandle = ck.GetWebGLContext(this.canvas, {
      antialias: 0,
      alpha: 1,
      depth: 0,
      stencil: 0,
      preserveDrawingBuffer: this.opts.mode === 'direct' ? 1 : 0,
    });
    this.gl = ck.MakeWebGLContext(this.glHandle);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const d of this.disposers) {
      d();
    }
    this.tiles.dispose();
    this.scene.dispose();
    this.overlay.dispose();
    this.surface?.delete();
    this.gl?.delete();
    controllers.delete(this.editor);
    for (const w of this.idleWaiters) {
      w();
    }
  }

  /** Sizes the backing store to the element (CSS pixels × device pixel ratio). */
  resize(w: number, h: number, dpr: number) {
    if (w === this.size.w && h === this.size.h && dpr === this.size.dpr) {
      return;
    }
    this.size = { w, h, dpr };
    this.canvas.width = Math.max(1, Math.round(w * dpr));
    this.canvas.height = Math.max(1, Math.round(h * dpr));
    this.surface?.delete();
    this.surface = null;
    this.requestFrame();
  }

  requestFrame() {
    if (!this.raf && !this.disposed) {
      this.raf = requestAnimationFrame(() => {
        this.raf = 0;
        this.frame();
      });
    }
  }

  /** Resolves after a frame where every image and font it needed was ready. */
  whenIdle(): Promise<void> {
    return new Promise((resolve) => {
      this.idleWaiters.push(resolve);
      this.requestFrame();
    });
  }

  private ensureSurface(): Surface | null {
    if (this.surface) {
      return this.surface;
    }
    if (!this.gl) {
      return null;
    }
    const ck = this.ck;
    this.surface = ck.MakeOnScreenGLSurface(
      this.gl,
      this.canvas.width,
      this.canvas.height,
      ck.ColorSpace.SRGB,
    );
    return this.surface;
  }

  // See apps/docs/skia-engine/tech.md §5.7.
  readArea(
    area: { x: number; y: number; w: number; h: number },
    scale: number,
    background = '#ffffff',
  ): Uint8Array | null {
    const ck = this.ck;
    const main = this.ensureSurface();
    const w = Math.max(1, Math.round(area.w * scale));
    const h = Math.max(1, Math.round(area.h * scale));
    const off = main?.makeSurface({
      width: w,
      height: h,
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Premul,
      colorSpace: ck.ColorSpace.SRGB,
    });
    if (!off) {
      return null;
    }
    const canvas = off.getCanvas();
    canvas.clear(ck.parseColorString(background));
    canvas.save();
    canvas.scale(scale, scale);
    canvas.translate(-area.x, -area.y);
    this.scene.drawPage(canvas, this.editor.getCurrentPageId(), {
      view: new Box(area.x, area.y, area.w, area.h),
      scale,
    });
    canvas.restore();
    off.flush();
    const image = off.makeImageSnapshot();
    const pixels = image.readPixels(0, 0, {
      width: w,
      height: h,
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Unpremul,
      colorSpace: ck.ColorSpace.SRGB,
    });
    image.delete();
    off.delete();
    return pixels instanceof Uint8Array ? pixels : null;
  }

  /** `readArea` once every image and font the area needs has loaded. */
  async exportArea(
    area: { x: number; y: number; w: number; h: number },
    scale: number,
    background = '#ffffff',
  ): Promise<Uint8Array | null> {
    for (let attempt = 0; ; attempt++) {
      const pixels = this.readArea(area, scale, background);
      const loading = this.resources.isLoading() || this.scene.hasIncomplete();
      if (!loading || attempt >= 10) {
        return pixels;
      }
      await this.resources.whenIdle();
      this.scene.markIncompleteDirty();
    }
  }

  /** Draws one frame now. */
  frame() {
    if (this.disposed) {
      return;
    }
    const start = performance.now();
    const surface = this.ensureSurface();
    if (!surface) {
      return;
    }
    const editor = this.editor;
    const pageId = editor.getCurrentPageId();
    const camera = editor.getCamera();
    const { w, h, dpr } = this.size;
    const scale = camera.z * dpr;

    const version = this.resources.version.__unsafe__getWithoutCapture();
    if (version !== this.lastVersion) {
      this.lastVersion = version;
      this.scene.markIncompleteDirty();
    }
    const editingId = editor.getEditingShapeId();
    const editing = editingId ? editor.getShape(editingId) : undefined;
    this.scene.setHidden(
      editing && editor.getShapeUtil(editing).editingComponent
        ? editing.id
        : null,
    );
    const animating = this.scene.tick(start);
    const dirty = this.scene.takeDirtyAreas();

    const canvas = surface.getCanvas();
    let pending = false;
    if (this.opts.mode === 'direct') {
      canvas.clear(this.tiles.background);
      canvas.save();
      canvas.scale(scale, scale);
      canvas.translate(camera.x, camera.y);
      this.scene.drawPage(canvas, pageId, {
        view: new Box(-camera.x, -camera.y, w / camera.z, h / camera.z),
        scale,
      });
      canvas.restore();
    } else {
      this.tiles.invalidate(dirty, scale);
      pending = this.tiles.draw(surface, pageId, {
        camera,
        width: w,
        height: h,
        dpr,
      }).pending;
    }

    canvas.save();
    canvas.scale(dpr, dpr);
    this.overlay.draw(canvas, readOverlayColors(editor.getContainer()));
    canvas.restore();
    surface.flush();

    this.opts.onFrame?.();
    this.stats.frames++;
    this.stats.lastFrameMs = performance.now() - start;

    const loading = this.resources.isLoading() || this.scene.hasIncomplete();
    if (pending || animating) {
      this.requestFrame();
    }
    if (!loading && !pending && !animating && this.idleWaiters.length) {
      const waiters = this.idleWaiters;
      this.idleWaiters = [];
      for (const w of waiters) {
        w();
      }
    } else if (loading && this.idleWaiters.length) {
      void this.resources.whenIdle().then(() => this.requestFrame());
    }
  }
}
