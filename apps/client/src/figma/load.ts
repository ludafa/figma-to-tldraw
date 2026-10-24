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

function fontSpecs(snapshot: Snapshot): { font: string; text: string }[] {
  const texts: FigmaNode[] = [];
  collectTexts(snapshot.rest.document, texts);
  const specs: { font: string; text: string }[] = [];
  for (const node of texts) {
    const styles = [
      node.style,
      ...Object.values(node.styleOverrideTable ?? {}),
    ];
    for (const s of styles) {
      if (!s?.fontFamily) {
        continue;
      }
      const italic = s.italic ? 'italic ' : '';
      specs.push({
        font: `${italic}${s.fontWeight ?? 400} 16px "${s.fontFamily}"`,
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

export async function waitForAssets(
  snapshot: Snapshot,
  assetBase: string,
): Promise<void> {
  await Promise.all([
    ...fontSpecs(snapshot).map((s) =>
      document.fonts.load(s.font, s.text).catch(() => []),
    ),
    ...Object.values(snapshot.meta.images).map((rel) =>
      loadImage(assetBase + rel),
    ),
  ]);
  await nextFrame();
  await document.fonts.ready;
  await nextFrame();
  await nextFrame();
}
