import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import type { Snapshot } from '../figma/types';
import { imageType, readZipCase, readZipIndex, withBlobUrls } from './zip';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);

const snapshot = {
  meta: {
    name: 'Home',
    images: { abc: 'images/abc.png' },
    filteredImages: { 'abc-1': 'images/abc-filtered-1.png' },
  },
} as unknown as Snapshot;

function makeZip(files: Record<string, Uint8Array>): Blob {
  return new Blob([zipSync(files) as Uint8Array<ArrayBuffer>]);
}

describe('zip import', () => {
  const zip = makeZip({
    'cases/index.json': strToU8(
      JSON.stringify({ figmaFile: 'Shop', cases: [{ dir: 'real/shop/home' }] }),
    ),
    'cases/real/shop/home/snapshot.json': strToU8(JSON.stringify(snapshot)),
    'cases/real/shop/home/expected@2x.png': PNG,
    'cases/real/shop/home/images/abc.png': JPEG,
    'cases/real/shop/home/images/abc-filtered-1.png': PNG,
    'cases/real/shop/home-2/snapshot.json': strToU8('{}'),
  });

  it('reads the case index', async () => {
    const index = await readZipIndex(zip);
    expect(index.figmaFile).toBe('Shop');
    expect(index.cases.map((c) => c.dir)).toEqual(['real/shop/home']);
  });

  it('reads one case and only that case', async () => {
    const files = await readZipCase(zip, 'real/shop/home');
    expect(files.snapshot.meta.name).toBe('Home');
    expect(files.expected.type).toBe('image/png');
    expect([...files.images.keys()].sort()).toEqual([
      'images/abc-filtered-1.png',
      'images/abc.png',
    ]);
    expect(files.images.get('images/abc.png')?.type).toBe('image/jpeg');
  });

  it('points image paths at blob URLs', async () => {
    const assets = withBlobUrls(await readZipCase(zip, 'real/shop/home'));
    expect(assets.snapshot.meta.images.abc).toMatch(/^blob:/);
    expect(assets.snapshot.meta.filteredImages?.['abc-1']).toMatch(/^blob:/);
    expect(assets.expectedUrl).toMatch(/^blob:/);
    expect(snapshot.meta.images.abc).toBe('images/abc.png');
    assets.revoke();
  });

  it('rejects a zip that is not a plugin export', async () => {
    await expect(
      readZipIndex(makeZip({ 'hello.txt': strToU8('hi') })),
    ).rejects.toThrow('cases/index.json');
  });

  it('sniffs image types from their bytes', () => {
    expect(imageType(PNG)).toBe('image/png');
    expect(imageType(JPEG)).toBe('image/jpeg');
    expect(imageType(strToU8('GIF89a'))).toBe('image/gif');
    expect(imageType(strToU8('RIFF....WEBP'))).toBe('image/webp');
    expect(imageType(strToU8('<svg xmlns'))).toBe('image/svg+xml');
  });
});
