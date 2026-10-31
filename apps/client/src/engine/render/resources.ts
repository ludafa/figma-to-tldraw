import type { CanvasKit, Image } from 'canvaskit-wasm';

import { atom } from '../state';
import { FontRegistry } from './fonts';
import {
  encodedImageSize,
  hasLevels,
  imageLevel,
  type ImageSize,
  levelsToDrop,
} from './image-size';
import { recordSvg, type SvgPicture } from './svg';

// See apps/docs/skia-engine/tech.md §5.1.

interface ImageLevel {
  state: 'loading' | 'loaded' | 'failed';
  image?: Image;
  used: number;
}

/** One encoded image and the reductions of it decoded so far. */
interface ImageSource {
  blob: Blob;
  size: ImageSize;
  levels: Map<number, ImageLevel>;
}

interface ImageEntry {
  state: 'loading' | 'loaded' | 'failed';
  /** Decoded in wasm (no `createImageBitmap`, or a `data:` URL). */
  image?: Image;
  source?: ImageSource;
}

const SVG_CACHE_LIMIT = 20_000;
/** Reductions of one image kept decoded at a time. */
const LEVELS_KEPT = 3;

export class Resources {
  readonly fonts = new FontRegistry();
  /** Bumps whenever an image or font finishes loading. */
  readonly version = atom('resource version', 0);
  private images = new Map<string, ImageEntry>();
  /** Sources by content digest, shared by every URL serving the same bytes. */
  private byContent = new Map<string, Promise<ImageSource>>();
  private waiting = new Set<Promise<void>>();
  private svgs = new Map<string, SvgPicture | null>();
  private incomplete = false;
  private scaled = false;
  private clock = 0;
  private _ck: CanvasKit | undefined;

  constructor() {
    this.fonts.onLoad = () => this.bump();
  }

  attach(ck: CanvasKit) {
    this._ck = ck;
    this.fonts.attach(ck);
  }

  get ck(): CanvasKit {
    if (!this._ck) {
      throw new Error('Resources are not attached to CanvasKit');
    }
    return this._ck;
  }

  private bump() {
    this.version.update((v) => v + 1);
  }

  /**
   * Runs `fn` and reports whether every resource it asked for was ready, and
   * whether it picked an image reduction for the drawing scale.
   */
  track<T>(fn: () => T): { value: T; complete: boolean; scaled: boolean } {
    const outer = [this.incomplete, this.scaled];
    this.incomplete = false;
    this.scaled = false;
    try {
      const value = fn();
      return { value, complete: !this.incomplete, scaled: this.scaled };
    } finally {
      this.incomplete = outer[0] || this.incomplete;
      this.scaled = outer[1] || this.scaled;
    }
  }

  markIncomplete() {
    this.incomplete = true;
  }

  /** Full pixel size of the image at `url`, once its header has been read. */
  imageSize(url: string): ImageSize | undefined {
    const entry = this.images.get(url);
    if (entry?.source) {
      return entry.source.size;
    }
    return entry?.image
      ? { width: entry.image.width(), height: entry.image.height() }
      : undefined;
  }

  /** Whether loading or decoding the image at `url` gave up. */
  imageFailed(url: string): boolean {
    return this.images.get(url)?.state === 'failed';
  }

  /**
   * The image at `url`. With `scale` (device pixels per image pixel) it may be
   * a reduced copy, so map it by its own `width()` / `height()`.
   */
  getImage(url: string, scale?: number): Image | undefined {
    const entry = this.images.get(url);
    if (entry?.state === 'loaded') {
      return entry.source ? this.getLevel(entry.source, scale) : entry.image;
    }
    if (entry?.state === 'failed') {
      return undefined;
    }
    this.incomplete = true;
    if (!entry) {
      this.loadImage(url);
    }
    return undefined;
  }

  // See apps/docs/skia-engine/tech.md §5.1.
  private getLevel(src: ImageSource, scale: number | undefined) {
    if (scale !== undefined && hasLevels(src.size)) {
      this.scaled = true;
    }
    const k = imageLevel(src.size, scale);
    const used = ++this.clock;
    const exact = src.levels.get(k);
    if (exact?.state === 'loaded') {
      exact.used = used;
      return exact.image;
    }
    if (!exact) {
      this.loadLevel(src, k);
    } else if (exact.state === 'failed' && !src.levels.has(0)) {
      this.loadLevel(src, 0);
    }
    let finer: [number, ImageLevel] | undefined;
    let coarser: [number, ImageLevel] | undefined;
    for (const [j, l] of src.levels) {
      if (l.state !== 'loaded') {
        continue;
      }
      if (j < k && (!finer || j > finer[0])) {
        finer = [j, l];
      } else if (j > k && (!coarser || j < coarser[0])) {
        coarser = [j, l];
      }
    }
    if ([...src.levels.values()].some((l) => l.state === 'loading')) {
      this.incomplete = true;
    }
    const pick = finer ?? coarser;
    if (pick) {
      pick[1].used = used;
    }
    return pick?.[1].image;
  }

  private loadLevel(src: ImageSource, k: number) {
    const level: ImageLevel = { state: 'loading', used: this.clock };
    src.levels.set(k, level);
    const ck = this.ck;
    const width = Math.max(1, Math.round(src.size.width / 2 ** k));
    const height = Math.max(1, Math.round(src.size.height / 2 ** k));
    const p = createImageBitmap(src.blob, {
      premultiplyAlpha: 'premultiply',
      ...(k > 0
        ? { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' }
        : {}),
    })
      .then((bitmap) => {
        level.image = ck.MakeLazyImageFromTextureSource(
          bitmap,
          {
            width: bitmap.width,
            height: bitmap.height,
            colorType: ck.ColorType.RGBA_8888,
            alphaType: ck.AlphaType.Premul,
            colorSpace: ck.ColorSpace.SRGB,
          },
          true,
        );
        level.state = 'loaded';
        level.used = ++this.clock;
        this.trimLevels(src);
      })
      .catch((e: unknown) => {
        console.warn('image decode failed', e);
        level.state = 'failed';
      })
      .finally(() => {
        this.waiting.delete(p);
        this.bump();
      });
    this.waiting.add(p);
  }

  /** Lets go of the least recently used reductions; pictures keep theirs alive. */
  private trimLevels(src: ImageSource) {
    const loaded = [...src.levels]
      .filter(([, l]) => l.state === 'loaded')
      .map(([k, l]) => [k, l.used] as const);
    for (const k of levelsToDrop(loaded, LEVELS_KEPT)) {
      src.levels.get(k)?.image?.delete();
      src.levels.delete(k);
    }
  }

  /** Decodes a `data:` URL synchronously (images embedded in SVGs). */
  getDataImage(url: string): Image | undefined {
    const cached = this.images.get(url);
    if (cached) {
      return cached.image;
    }
    const comma = url.indexOf(',');
    let image: Image | undefined;
    if (comma > 0 && url.slice(0, comma).endsWith(';base64')) {
      const bin = atob(url.slice(comma + 1));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        bytes[i] = bin.charCodeAt(i);
      }
      image = this.ck.MakeImageFromEncoded(bytes) ?? undefined;
    }
    this.images.set(url, { state: image ? 'loaded' : 'failed', image });
    return image;
  }

  /** Starts loading `url` if needed; resolves when it settled. */
  preloadImage(url: string): Promise<void> {
    if (!this.images.has(url)) {
      this.loadImage(url);
    }
    return this.whenIdle();
  }

  private loadImage(url: string) {
    const entry: ImageEntry = { state: 'loading' };
    this.images.set(url, entry);
    const p = fetch(url)
      .then((r) => {
        if (!r.ok) {
          throw new Error(`${r.status} ${url}`);
        }
        return r.arrayBuffer();
      })
      .then(async (buf) => {
        if (typeof createImageBitmap === 'function') {
          entry.source = await this.sourceFor(buf);
        } else {
          entry.image = this.decodeInWasm(buf, url);
        }
        entry.state = 'loaded';
      })
      .catch((e: unknown) => {
        console.warn('image load failed', e);
        entry.state = 'failed';
      })
      .finally(() => {
        this.waiting.delete(p);
        this.bump();
      });
    this.waiting.add(p);
  }

  private decodeInWasm(buf: ArrayBuffer, url: string): Image {
    const image = this.ck.MakeImageFromEncoded(new Uint8Array(buf));
    if (!image) {
      throw new Error(`cannot decode ${url}`);
    }
    return image;
  }

  private async sourceFor(buf: ArrayBuffer): Promise<ImageSource> {
    const digest = await crypto.subtle.digest('SHA-1', buf);
    const key = String.fromCharCode(...new Uint8Array(digest));
    let source = this.byContent.get(key);
    if (!source) {
      source = (async () => {
        const blob = new Blob([buf]);
        const size =
          encodedImageSize(new Uint8Array(buf)) ?? (await decodedSize(blob));
        return { blob, size, levels: new Map() };
      })();
      this.byContent.set(key, source);
    }
    return source;
  }

  /** The SVG as a picture in its own viewBox space; null when it is empty. */
  svgPicture(svg: string): SvgPicture | null {
    const hit = this.svgs.get(svg);
    if (hit !== undefined) {
      return hit;
    }
    const picture = recordSvg(this.ck, svg, this);
    if (this.svgs.size >= SVG_CACHE_LIMIT) {
      const first = this.svgs.keys().next().value!;
      this.svgs.get(first)?.picture.delete();
      this.svgs.delete(first);
    }
    this.svgs.set(svg, picture);
    return picture;
  }

  async whenIdle(): Promise<void> {
    while (this.waiting.size || this.fonts.isLoading()) {
      await Promise.all([...this.waiting, this.fonts.whenIdle()]);
    }
  }

  isLoading(): boolean {
    return this.waiting.size > 0 || this.fonts.isLoading();
  }
}

/** Pixel size of an image the header parser doesn't know, by decoding it once. */
async function decodedSize(blob: Blob): Promise<ImageSize> {
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

let shared: Resources | undefined;

/** One cache of fonts and images for every canvas on the page. */
export function getSharedResources(ck: CanvasKit): Resources {
  if (!shared) {
    shared = new Resources();
    shared.attach(ck);
  }
  return shared;
}
