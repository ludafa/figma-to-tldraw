import { fontShorthand, primaryFontShorthand } from './fonts';
import type { CaseIndex, FigmaNode, Snapshot } from './types';

// See apps/docs/figma-to-tldraw/tech.md §1.1 and §7.

export function caseUrl(dir: string, file = ''): string {
  return `/cases/${dir.split('/').map(encodeURIComponent).join('/')}/${file}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`读取 ${url} 失败：${res.status}`);
  }
  return (await res.json()) as T;
}

export function loadCaseIndex(): Promise<CaseIndex> {
  return fetchJson<CaseIndex>('/cases/index.json');
}

export function loadCase(dir: string): Promise<Snapshot> {
  return fetchJson<Snapshot>(caseUrl(dir, 'snapshot.json'));
}

function collectTexts(node: FigmaNode, out: FigmaNode[]) {
  if (node.visible === false) {
    return;
  }
  if (node.type === 'TEXT') {
    out.push(node);
  }
  for (const child of node.children ?? []) {
    collectTexts(child, out);
  }
}

function fontSpecs(
  snapshot: Snapshot,
): { font: string; primary: string; family: string; text: string }[] {
  const texts: FigmaNode[] = [];
  collectTexts(snapshot.rest.document, texts);
  const specs: {
    font: string;
    primary: string;
    family: string;
    text: string;
  }[] = [];
  for (const node of texts) {
    const base = node.style ?? {};
    const styles = [
      base,
      ...Object.values(node.styleOverrideTable ?? {}).map((o) => ({
        ...base,
        ...o,
      })),
    ];
    for (const s of styles) {
      if (!s.fontFamily) {
        continue;
      }
      specs.push({
        font: fontShorthand(s),
        primary: primaryFontShorthand(s),
        family: `${s.fontFamily} ${s.fontWeight ?? 400}${s.italic ? ' italic' : ''}`,
        text: node.characters ?? '',
      });
    }
  }
  return specs;
}

function loadImage(src: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      img
        .decode()
        .catch(() => undefined)
        .then(() => resolve());
    };
    img.onerror = () => resolve();
    img.src = src;
  });
}

const nextFrame = () =>
  new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

// See apps/docs/figma-to-tldraw/tech.md §9.
export async function waitForAssets(
  snapshot: Snapshot,
  assetBase: string,
): Promise<string[]> {
  const specs = fontSpecs(snapshot);
  const [faces] = await Promise.all([
    Promise.all(
      specs.map((s) =>
        Promise.all([
          document.fonts.load(s.font, s.text),
          document.fonts.load(s.primary, s.text),
        ])
          .then(([, primary]) => primary)
          .catch(() => []),
      ),
    ),
    ...Object.values(snapshot.meta.images).map((rel) =>
      loadImage(assetBase + rel),
    ),
  ]);
  await nextFrame();
  await document.fonts.ready;
  await nextFrame();
  await nextFrame();
  const missing = new Set(
    specs.filter((_, i) => faces[i].length === 0).map((s) => s.family),
  );
  return [...missing].map((f) => `缺字体：${f}（没有对应的网页字体）`);
}
