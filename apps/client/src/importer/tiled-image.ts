// See apps/docs/figma-to-tldraw/tech.md §20.4.

const TILE = 1024;
/** Longest side of the coarsest level, which is always kept. */
const OVERVIEW = 2048;
/** Images up to this many pixels stay decoded; bigger ones re-decode tiles from the file. */
const KEEP_DECODED = 32_000_000;
/** Finer tiles kept per image (4 MB each). */
const MAX_TILES = 48;
const MAX_LOADING = 4;

interface Tile {
  bitmap?: ImageBitmap;
  used: number;
}

/** One tile's source rectangle, in full-size image pixels. */
export interface TileRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Level `k` is the image at 1/2^k; each level is cut into TILE-sized tiles. */
export class ImagePyramid {
  width = 0;
  height = 0;
  /** The coarsest level. */
  top = 0;
  readonly ready: Promise<void>;
  private decoded: ImageBitmap | null = null;
  private tiles = new Map<string, Tile>();
  private loading = 0;
  private clock = 0;
  private closed = false;
  private listeners = new Set<() => void>();

  private blob: Blob;

  constructor(blob: Blob) {
    this.blob = blob;
    this.ready = this.init();
  }

  private async init() {
    const full = await createImageBitmap(this.blob);
    this.width = full.width;
    this.height = full.height;
    const long = Math.max(full.width, full.height);
    this.top = Math.max(0, Math.ceil(Math.log2(long / OVERVIEW)));
    const top = this.top;
    await Promise.all(
      this.tilesOf(top).map(async ([c, r]) => {
        this.tiles.set(key(top, c, r), {
          bitmap: await this.make(full, top, c, r),
          used: Infinity,
        });
      }),
    );
    if (this.closed) {
      full.close();
      this.close();
    } else if (full.width * full.height > KEEP_DECODED) {
      full.close();
    } else {
      this.decoded = full;
    }
  }

  /** Calls `fn` whenever a tile finishes loading; returns the unsubscribe. */
  onLoad(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Columns and rows of level `k`'s tiles. */
  tilesOf(k: number): [number, number][] {
    const span = TILE * 2 ** k;
    const out: [number, number][] = [];
    for (let r = 0; r * span < this.height; r++) {
      for (let c = 0; c * span < this.width; c++) {
        out.push([c, r]);
      }
    }
    return out;
  }

  rect(k: number, c: number, r: number): TileRect {
    const span = TILE * 2 ** k;
    const x = c * span;
    const y = r * span;
    return {
      x,
      y,
      w: Math.min(span, this.width - x),
      h: Math.min(span, this.height - y),
    };
  }

  /** Columns and rows of level `k` covering `rect` (full-size pixels). */
  covering(k: number, rect: TileRect): [number, number][] {
    const span = TILE * 2 ** k;
    const c0 = Math.max(0, Math.floor(rect.x / span));
    const r0 = Math.max(0, Math.floor(rect.y / span));
    const c1 = Math.min(
      Math.ceil(this.width / span),
      Math.ceil((rect.x + rect.w) / span),
    );
    const r1 = Math.min(
      Math.ceil(this.height / span),
      Math.ceil((rect.y + rect.h) / span),
    );
    const out: [number, number][] = [];
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) {
        out.push([c, r]);
      }
    }
    return out;
  }

  /** The tile, or undefined while it loads (asking for it starts the load). */
  tile(k: number, c: number, r: number): ImageBitmap | undefined {
    const id = key(k, c, r);
    const hit = this.tiles.get(id);
    if (hit) {
      hit.used = Math.max(hit.used, ++this.clock);
      return hit.bitmap;
    }
    if (this.loading >= MAX_LOADING || this.closed) {
      return undefined;
    }
    const entry: Tile = { used: ++this.clock };
    this.tiles.set(id, entry);
    this.loading++;
    this.make(this.decoded ?? this.blob, k, c, r)
      .then((bitmap) => {
        if (this.closed) {
          bitmap.close();
          return;
        }
        entry.bitmap = bitmap;
        this.trim();
      })
      .catch((e: unknown) => {
        console.warn('tile decode failed', e);
      })
      .finally(() => {
        this.loading--;
        for (const fn of this.listeners) {
          fn();
        }
      });
    return undefined;
  }

  private async make(
    from: ImageBitmap | Blob,
    k: number,
    c: number,
    r: number,
  ): Promise<ImageBitmap> {
    const { x, y, w, h } = this.rect(k, c, r);
    const f = 2 ** k;
    const width = Math.max(1, Math.round(w / f));
    const height = Math.max(1, Math.round(h / f));
    const crop = await createImageBitmap(
      from,
      x,
      y,
      w,
      h,
      k > 0
        ? { resizeWidth: width, resizeHeight: height, resizeQuality: 'medium' }
        : {},
    );
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(crop, 0, 0, width, height);
    crop.close();
    return canvas.transferToImageBitmap();
  }

  private trim() {
    const finer = [...this.tiles].filter(
      ([, t]) => t.bitmap && t.used !== Infinity,
    );
    if (finer.length <= MAX_TILES) {
      return;
    }
    finer.sort((a, b) => a[1].used - b[1].used);
    for (const [id, t] of finer.slice(0, finer.length - MAX_TILES)) {
      t.bitmap?.close();
      this.tiles.delete(id);
    }
  }

  close() {
    this.closed = true;
    this.decoded?.close();
    this.decoded = null;
    for (const t of this.tiles.values()) {
      t.bitmap?.close();
    }
    this.tiles.clear();
  }
}

const key = (k: number, c: number, r: number) => `${k}/${c}/${r}`;

/** The level whose pixels are just finer than one device pixel. */
export function levelFor(pyramid: ImagePyramid, imagePerDevice: number) {
  return Math.min(
    pyramid.top,
    Math.max(0, Math.floor(Math.log2(imagePerDevice))),
  );
}
