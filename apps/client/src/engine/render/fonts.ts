import type {
  CanvasKit,
  FontCollection,
  Typeface,
  TypefaceFontProvider,
} from 'canvaskit-wasm';

import { atom } from '../state';

// See apps/docs/skia-engine/tech.md §5.2.

export interface FontFaceSource {
  family: string;
  weight: [number, number];
  /** 'normal', 'italic', or 'oblique' (with an angle range). */
  style: 'normal' | 'italic' | 'oblique';
  url: string;
  /** Inclusive code point ranges; null = everything. */
  ranges: [number, number][] | null;
  alias: string;
}

export interface FontRequest {
  family: string;
  weight: number;
  italic: boolean;
}

type LoadState = 'loading' | 'loaded' | 'failed';

function parseRanges(value: string): [number, number][] | null {
  const text = value.trim();
  if (!text) {
    return null;
  }
  const out: [number, number][] = [];
  for (const part of text.split(',')) {
    const m = /U\+([0-9a-f?]+)(?:-([0-9a-f]+))?/i.exec(part.trim());
    if (!m) {
      continue;
    }
    if (m[1].includes('?')) {
      out.push([
        parseInt(m[1].replaceAll('?', '0'), 16),
        parseInt(m[1].replaceAll('?', 'f'), 16),
      ]);
    } else {
      const a = parseInt(m[1], 16);
      out.push([a, m[2] ? parseInt(m[2], 16) : a]);
    }
  }
  return out;
}

function parseWeight(value: string): [number, number] {
  const parts = value
    .trim()
    .split(/\s+/)
    .map((v) => (v === 'bold' ? 700 : v === 'normal' ? 400 : Number(v)))
    .filter((v) => Number.isFinite(v));
  if (!parts.length) {
    return [400, 400];
  }
  return [parts[0], parts[1] ?? parts[0]];
}

function parseStyle(value: string): FontFaceSource['style'] {
  const v = value.trim();
  if (v.startsWith('italic')) {
    return 'italic';
  }
  if (v.startsWith('oblique')) {
    return 'oblique';
  }
  return 'normal';
}

function firstUrl(src: string, base: string): string | undefined {
  const urls = [...src.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)].map(
    (m) => m[2],
  );
  const pick = urls.find((u) => /\.woff2(\?|#|$)/.test(u)) ?? urls[0];
  if (!pick) {
    return undefined;
  }
  try {
    return new URL(pick, base).href;
  } catch {
    return pick;
  }
}

function covers(face: FontFaceSource, text: string): boolean {
  if (!face.ranges) {
    return true;
  }
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    for (const [a, b] of face.ranges) {
      if (cp >= a && cp <= b) {
        return true;
      }
    }
  }
  return false;
}

/** CSS Fonts 4 weight matching over the faces of one style. */
function pickWeight(faces: FontFaceSource[], want: number): number | undefined {
  if (!faces.length) {
    return undefined;
  }
  const clamp = (f: FontFaceSource) =>
    Math.min(f.weight[1], Math.max(f.weight[0], want));
  const exact = faces.find((f) => clamp(f) === want);
  if (exact) {
    return want;
  }
  const weights = [...new Set(faces.map(clamp))];
  const up = weights.filter((w) => w > want).sort((a, b) => a - b);
  const down = weights.filter((w) => w < want).sort((a, b) => b - a);
  if (want >= 400 && want <= 500) {
    const near = up.filter((w) => w <= 500);
    return near[0] ?? down[0] ?? up[0];
  }
  return want < 400 ? (down[0] ?? up[0]) : (up[0] ?? down[0]);
}

export class FontRegistry {
  readonly faces: FontFaceSource[] = [];
  private byFamily = new Map<string, FontFaceSource[]>();
  private states = new Map<string, LoadState>();
  private typefaces = new Map<string, Typeface>();
  private waiting = new Set<Promise<void>>();
  private provider: TypefaceFontProvider | undefined;
  private collection: FontCollection | undefined;
  private ck: CanvasKit | undefined;
  private scannedSheets = new WeakSet<CSSStyleSheet>();
  /** Bumps whenever a font finishes loading. */
  readonly version = atom('font version', 0);
  onLoad: (() => void) | undefined;

  attach(ck: CanvasKit) {
    if (this.ck) {
      return;
    }
    this.ck = ck;
    this.provider = ck.TypefaceFontProvider.Make();
  }

  getProvider(): TypefaceFontProvider {
    if (!this.provider) {
      throw new Error('FontRegistry is not attached to CanvasKit');
    }
    return this.provider;
  }

  // See apps/docs/skia-engine/tech.md §5.2.
  /** One font collection for every paragraph, rebuilt when a font is added. */
  getCollection(): FontCollection {
    if (!this.collection) {
      const fc = this.ck!.FontCollection.Make();
      fc.setDefaultFontManager(this.getProvider());
      fc.enableFontFallback();
      this.collection = fc;
    }
    return this.collection;
  }

  addFace(face: Omit<FontFaceSource, 'alias'>) {
    const key = face.family.toLowerCase();
    const list = this.byFamily.get(key) ?? [];
    if (
      list.some(
        (f) =>
          f.url === face.url &&
          f.style === face.style &&
          f.weight[0] === face.weight[0],
      )
    ) {
      return;
    }
    const full = { ...face, alias: `f${this.faces.length}` };
    this.faces.push(full);
    list.push(full);
    this.byFamily.set(key, list);
  }

  /** Reads every @font-face rule of the document's stylesheets. */
  scanDocument(doc: Document = document) {
    for (const sheet of Array.from(doc.styleSheets)) {
      this.scanSheet(sheet);
    }
  }

  private scanSheet(sheet: CSSStyleSheet) {
    if (this.scannedSheets.has(sheet)) {
      return;
    }
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      return;
    }
    this.scannedSheets.add(sheet);
    const base = sheet.href ?? document.baseURI;
    const visit = (list: CSSRuleList) => {
      for (const rule of Array.from(list)) {
        if (rule instanceof CSSFontFaceRule) {
          const s = rule.style;
          const family = s
            .getPropertyValue('font-family')
            .trim()
            .replace(/^['"]|['"]$/g, '');
          const url = firstUrl(s.getPropertyValue('src'), base);
          if (!family || !url) {
            continue;
          }
          this.addFace({
            family,
            url,
            weight: parseWeight(s.getPropertyValue('font-weight') || '400'),
            style: parseStyle(s.getPropertyValue('font-style') || 'normal'),
            ranges: parseRanges(s.getPropertyValue('unicode-range')),
          });
        } else if (rule instanceof CSSImportRule && rule.styleSheet) {
          this.scanSheet(rule.styleSheet);
        } else if ('cssRules' in rule) {
          visit((rule as CSSGroupingRule).cssRules);
        }
      }
    };
    visit(rules);
  }

  hasFamily(family: string): boolean {
    return this.byFamily.has(family.toLowerCase());
  }

  /** The faces CSS matching would pick for `req`, all unicode-range subsets. */
  match(req: FontRequest): FontFaceSource[] {
    const all = this.byFamily.get(req.family.toLowerCase()) ?? [];
    const order: FontFaceSource['style'][] = req.italic
      ? ['italic', 'oblique', 'normal']
      : ['normal', 'oblique', 'italic'];
    for (const style of order) {
      const faces = all.filter((f) => f.style === style);
      const weight = pickWeight(faces, req.weight);
      if (weight === undefined) {
        continue;
      }
      return faces.filter(
        (f) => f.weight[0] <= weight && weight <= f.weight[1],
      );
    }
    return [];
  }

  /**
   * Aliases to put in a paragraph's font list for `text`, in fallback order.
   * Starts loading what is missing; `ready` is false until all of it loaded.
   */
  aliasesFor(
    stack: FontRequest[],
    text: string,
  ): { aliases: string[]; ready: boolean } {
    const aliases: string[] = [];
    let ready = true;
    for (const req of stack) {
      for (const face of this.match(req)) {
        if (!covers(face, text)) {
          continue;
        }
        const state = this.states.get(face.url);
        if (state === 'loaded') {
          aliases.push(face.alias);
        } else if (state !== 'failed') {
          ready = false;
          this.load(face);
        }
      }
    }
    return { aliases, ready };
  }

  private load(face: FontFaceSource) {
    if (this.states.has(face.url)) {
      return;
    }
    this.states.set(face.url, 'loading');
    const p = fetch(face.url)
      .then((r) => {
        if (!r.ok) {
          throw new Error(`${r.status} ${face.url}`);
        }
        return r.arrayBuffer();
      })
      .then((buf) => {
        const provider = this.getProvider();
        const typeface = this.ck!.Typeface.MakeTypefaceFromData(buf);
        for (const f of this.faces) {
          if (f.url === face.url) {
            provider.registerFont(buf, f.alias);
            if (typeface) {
              this.typefaces.set(f.alias, typeface);
            }
          }
        }
        this.states.set(face.url, 'loaded');
        this.collection?.delete();
        this.collection = undefined;
      })
      .catch((e: unknown) => {
        console.warn('font load failed', e);
        this.states.set(face.url, 'failed');
      })
      .finally(() => {
        this.waiting.delete(p);
        this.version.update((v) => v + 1);
        this.onLoad?.();
      });
    this.waiting.add(p);
  }

  /** The loaded typeface behind an alias (for font metrics). */
  typeface(alias: string): Typeface | undefined {
    return this.typefaces.get(alias);
  }

  /** Resolves once nothing is loading. */
  async whenIdle(): Promise<void> {
    while (this.waiting.size) {
      await Promise.all(this.waiting);
    }
  }

  isLoading(): boolean {
    return this.waiting.size > 0;
  }
}
