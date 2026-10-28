// See apps/docs/skia-engine/tech.md §5.1.

export interface ImageSize {
  width: number;
  height: number;
}

/** Pixel size from a PNG, JPEG, WebP or GIF header; null for anything else. */
export function encodedImageSize(bytes: Uint8Array): ImageSize | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (at: number, n: number) =>
    String.fromCharCode(...bytes.subarray(at, at + n));
  if (bytes.length >= 24 && bytes[0] === 0x89 && ascii(1, 3) === 'PNG') {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1];
      if (marker === 0xff) {
        i++;
        continue;
      }
      const isFrame =
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc;
      if (isFrame) {
        return { width: view.getUint16(i + 7), height: view.getUint16(i + 5) };
      }
      i += 2 + view.getUint16(i + 2);
    }
    return null;
  }
  if (bytes.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
    const chunk = ascii(12, 4);
    const u24 = (at: number) =>
      bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
    if (chunk === 'VP8X') {
      return { width: 1 + u24(24), height: 1 + u24(27) };
    }
    if (chunk === 'VP8 ') {
      return {
        width: view.getUint16(26, true) & 0x3fff,
        height: view.getUint16(28, true) & 0x3fff,
      };
    }
    if (chunk === 'VP8L') {
      const b = view.getUint32(21, true);
      return { width: 1 + (b & 0x3fff), height: 1 + ((b >> 14) & 0x3fff) };
    }
    return null;
  }
  if (bytes.length >= 10 && ascii(0, 3) === 'GIF') {
    return {
      width: view.getUint16(6, true),
      height: view.getUint16(8, true),
    };
  }
  return null;
}

/**
 * Which power-of-two reduction of a `size` image to decode when one image
 * pixel covers `scale` device pixels (0 = full size).
 */
export function imageLevel(size: ImageSize, scale: number | undefined) {
  const longest = Math.max(size.width, size.height);
  if (scale === undefined || scale >= 1 || !hasLevels(size)) {
    return 0;
  }
  const wanted = Math.floor(Math.log2(1 / Math.max(scale, 1e-6)));
  const deepest = Math.floor(Math.log2(longest / LOD_MIN_PX));
  return Math.max(0, Math.min(wanted, deepest));
}

/** Whether the image is big enough to be decoded at reduced sizes. */
export function hasLevels(size: ImageSize) {
  return Math.max(size.width, size.height) > LOD_MIN_PX * 2;
}

/** Reduced images are never smaller than this on their longest side. */
export const LOD_MIN_PX = 256;

/**
 * Levels to let go of so at most `kept` stay loaded: the least recently used
 * ones, given as `[level, lastUsed]`.
 */
export function levelsToDrop(
  loaded: readonly (readonly [number, number])[],
  kept: number,
): number[] {
  const byUse = [...loaded].sort((a, b) => a[1] - b[1]);
  return byUse.slice(0, Math.max(0, byUse.length - kept)).map(([k]) => k);
}
