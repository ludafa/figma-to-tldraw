import { domToForeignObjectSvg } from 'modern-screenshot';

// See apps/docs/figma-to-tldraw/tech.md §19.2.

const SVG_NS = 'http://www.w3.org/2000/svg';
const SETTLE_MS = 50;
const SETTLE_STABLE = 3;
const SETTLE_MAX = 60;
const PROBE_WIDTH = 320;

const fontData = new Map<string, Promise<string>>();

function dataUrlOf(url: string): Promise<string> {
  let data = fontData.get(url);
  if (!data) {
    data = fetch(url)
      .then((res) => res.blob())
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          }),
      );
    fontData.set(url, data);
  }
  return data;
}

const familyName = (family: string) =>
  family.replace(/["']/g, '').trim().toLowerCase();

export function inUnicodeRange(range: string, chars: Set<number>): boolean {
  if (!range.trim()) {
    return true;
  }
  return range.split(',').some((part) => {
    const spec = part.trim().replace(/^u\+/i, '');
    let lo: number;
    let hi: number;
    if (spec.includes('?')) {
      lo = parseInt(spec.replace(/\?/g, '0'), 16);
      hi = parseInt(spec.replace(/\?/g, 'F'), 16);
    } else if (spec.includes('-')) {
      const [a, b] = spec.split('-');
      lo = parseInt(a, 16);
      hi = parseInt(b, 16);
    } else {
      lo = hi = parseInt(spec, 16);
    }
    for (const c of chars) {
      if (c >= lo && c <= hi) {
        return true;
      }
    }
    return false;
  });
}

function usedText(root: Element): {
  families: Set<string>;
  chars: Set<number>;
} {
  const families = new Set<string>();
  const chars = new Set<number>();
  for (const el of root.querySelectorAll('*')) {
    const texts = [...el.childNodes].filter(
      (n): n is Text => n instanceof Text && /\S/.test(n.data),
    );
    if (!texts.length) {
      continue;
    }
    for (const f of getComputedStyle(el).fontFamily.split(',')) {
      families.add(familyName(f));
    }
    for (const t of texts) {
      for (const ch of t.data + t.data.toUpperCase() + t.data.toLowerCase()) {
        chars.add(ch.codePointAt(0) ?? 0);
      }
    }
  }
  return { families, chars };
}

function fontFaceRules(): { rule: CSSFontFaceRule; base: string }[] {
  const out: { rule: CSSFontFaceRule; base: string }[] = [];
  const walk = (rules: CSSRuleList, base: string) => {
    for (const rule of rules) {
      if (rule instanceof CSSFontFaceRule) {
        out.push({ rule, base });
      } else if (rule instanceof CSSGroupingRule) {
        walk(rule.cssRules, base);
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      walk(sheet.cssRules, sheet.href ?? location.href);
    } catch {
      continue;
    }
  }
  return out;
}

/** The page's @font-face rules the text under `root` needs, fonts inlined. */
export async function fontFaceCss(root: Element): Promise<string> {
  const { families, chars } = usedText(root);
  const picked = fontFaceRules().filter(
    ({ rule }) =>
      families.has(familyName(rule.style.getPropertyValue('font-family'))) &&
      inUnicodeRange(rule.style.getPropertyValue('unicode-range'), chars),
  );
  const css = await Promise.all(
    picked.map(async ({ rule, base }) => {
      let text = rule.cssText;
      for (const [raw, , url] of text.matchAll(/url\((["']?)([^"')]+)\1\)/g)) {
        if (!url.startsWith('data:')) {
          const data = await dataUrlOf(new URL(url, base).href).catch(
            () => url,
          );
          text = text.replace(raw, `url("${data}")`);
        }
      }
      return text;
    }),
  );
  return css.join('\n');
}

let props: string[] | null = null;

function styleProperties(): string[] {
  props ??= [...getComputedStyle(document.documentElement)].filter(
    (name) => !name.startsWith('--'),
  );
  return props;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('浏览器画不出截图用的 SVG'));
    img.src = src;
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function settle(img: HTMLImageElement) {
  const probe = document.createElement('canvas');
  probe.width = PROBE_WIDTH;
  probe.height = Math.max(
    1,
    Math.round((PROBE_WIDTH * img.naturalHeight) / img.naturalWidth),
  );
  const ctx = probe.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return;
  }
  const signature = () => {
    ctx.clearRect(0, 0, probe.width, probe.height);
    ctx.drawImage(img, 0, 0, probe.width, probe.height);
    const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
    let hash = 0;
    for (let i = 0; i < data.length; i += 3) {
      hash = (hash * 31 + data[i]) | 0;
    }
    return hash;
  };
  let last = signature();
  let stable = 0;
  for (let i = 0; i < SETTLE_MAX && stable < SETTLE_STABLE; i++) {
    await wait(SETTLE_MS);
    const next = signature();
    stable = next === last ? stable + 1 : 0;
    last = next;
  }
}

// oxlint-disable-next-line no-control-regex -- same cleanup modern-screenshot does before encoding the SVG.
const CONTROL_CHARS = /[\u0000-\u0008\v\f\u000E-\u001F\uD800-\uDFFF￾￿]/gu;

/** Renders `root` (live DOM) into a canvas `scale` times its CSS size. */
export async function captureElement(
  root: HTMLElement,
  scale: number,
): Promise<HTMLCanvasElement> {
  const fonts = await fontFaceCss(root);
  const svg = await domToForeignObjectSvg(root, {
    font: false,
    includeStyleProperties: styleProperties(),
    onCreateForeignObjectSvg: (el) => {
      const style = document.createElementNS(SVG_NS, 'style');
      style.textContent = fonts;
      el.insertBefore(style, el.firstChild);
    },
  });
  const xml = new XMLSerializer()
    .serializeToString(svg)
    .replace(CONTROL_CHARS, '');
  const img = await loadImage(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`,
  );
  await img.decode().catch(() => undefined);
  await settle(img);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}
