import { strFromU8, type Unzipped, unzip } from 'fflate';

import type { CaseIndex, Snapshot } from '../figma/types';

// See apps/docs/figma-to-tldraw/tech.md §19.1.

const INDEX = 'cases/index.json';

export interface CaseFiles {
  snapshot: Snapshot;
  expected: Blob;
  images: Map<string, Blob>;
}

let cached: { zip: Blob; data: Uint8Array } | null = null;

async function bytesOf(zip: Blob): Promise<Uint8Array> {
  if (cached?.zip !== zip) {
    cached = { zip, data: new Uint8Array(await zip.arrayBuffer()) };
  }
  return cached.data;
}

async function unzipSome(
  zip: Blob,
  keep: (name: string) => boolean,
): Promise<Unzipped> {
  const data = await bytesOf(zip);
  return new Promise((resolve, reject) => {
    unzip(data, { filter: (file) => keep(file.name) }, (err, files) => {
      if (err) {
        reject(err);
      } else {
        resolve(files);
      }
    });
  });
}

const blobOf = (bytes: Uint8Array, type: string) =>
  new Blob([bytes as Uint8Array<ArrayBuffer>], { type });

export function imageType(bytes: Uint8Array): string {
  const head = String.fromCharCode(...bytes.subarray(0, 12));
  if (head.startsWith('\x89PNG')) {
    return 'image/png';
  }
  if (head.startsWith('\xff\xd8')) {
    return 'image/jpeg';
  }
  if (head.startsWith('GIF8')) {
    return 'image/gif';
  }
  if (head.startsWith('RIFF') && head.slice(8) === 'WEBP') {
    return 'image/webp';
  }
  if (/^\s*</.test(head)) {
    return 'image/svg+xml';
  }
  return 'application/octet-stream';
}

export async function readZipIndex(zip: Blob): Promise<CaseIndex> {
  let files: Unzipped;
  try {
    files = await unzipSome(zip, (name) => name === INDEX);
  } catch (e) {
    throw new Error(`解不开这个 zip：${String(e)}`, { cause: e });
  }
  const index = files[INDEX];
  if (!index) {
    throw new Error(
      'zip 里没有 cases/index.json，不像是 Figma 插件「导出测试数据」生成的文件',
    );
  }
  return JSON.parse(strFromU8(index)) as CaseIndex;
}

export async function readZipCase(zip: Blob, dir: string): Promise<CaseFiles> {
  const prefix = `cases/${dir}/`;
  const files = await unzipSome(zip, (name) => name.startsWith(prefix));
  const snapshot = files[`${prefix}snapshot.json`];
  const expected = files[`${prefix}expected@2x.png`];
  if (!snapshot || !expected) {
    throw new Error(`zip 里缺 ${dir} 的 snapshot.json 或 expected@2x.png`);
  }
  const images = new Map<string, Blob>();
  for (const [name, bytes] of Object.entries(files)) {
    const rel = name.slice(prefix.length);
    if (rel.startsWith('images/') && bytes.length) {
      images.set(rel, blobOf(bytes, imageType(bytes)));
    }
  }
  return {
    snapshot: JSON.parse(strFromU8(snapshot)) as Snapshot,
    expected: blobOf(expected, 'image/png'),
    images,
  };
}

export interface CaseAssets {
  snapshot: Snapshot;
  expectedUrl: string;
  revoke: () => void;
}

/** Same snapshot with its image paths pointing at blob URLs (asset base ''). */
export function withBlobUrls(files: CaseFiles): CaseAssets {
  const urls: string[] = [];
  const urlOf = new Map<string, string>();
  for (const [rel, blob] of files.images) {
    const url = URL.createObjectURL(blob);
    urls.push(url);
    urlOf.set(rel, url);
  }
  const swap = (paths: Record<string, string> | undefined) =>
    paths &&
    Object.fromEntries(
      Object.entries(paths).map(([key, rel]) => [key, urlOf.get(rel) ?? rel]),
    );
  const expectedUrl = URL.createObjectURL(files.expected);
  urls.push(expectedUrl);
  const { meta } = files.snapshot;
  return {
    snapshot: {
      ...files.snapshot,
      meta: {
        ...meta,
        images: swap(meta.images) ?? {},
        filteredImages: swap(meta.filteredImages),
      },
    },
    expectedUrl,
    revoke: () => {
      for (const url of urls) {
        URL.revokeObjectURL(url);
      }
    },
  };
}
