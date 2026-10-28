import { describe, expect, it } from 'vitest';

import { encodedImageSize, imageLevel, levelsToDrop } from './image-size';

function png(width: number, height: number) {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  const v = new DataView(b.buffer);
  v.setUint32(8, 13);
  b.set([0x49, 0x48, 0x44, 0x52], 12);
  v.setUint32(16, width);
  v.setUint32(20, height);
  return b;
}

function jpeg(width: number, height: number) {
  // SOI, an APP0 segment, then a baseline SOF0 frame header.
  const b = new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x04,
    0x00,
    0x00,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    0x03,
    0,
    0,
    0,
    0,
    0,
    0,
  ]);
  return b;
}

function gif(width: number, height: number) {
  const b = new Uint8Array(13);
  b.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
  const v = new DataView(b.buffer);
  v.setUint16(6, width, true);
  v.setUint16(8, height, true);
  return b;
}

function webpLossless(width: number, height: number) {
  const b = new Uint8Array(30);
  b.set(new TextEncoder().encode('RIFF'), 0);
  b.set(new TextEncoder().encode('WEBPVP8L'), 8);
  const v = new DataView(b.buffer);
  v.setUint32(21, (width - 1) | ((height - 1) << 14), true);
  return b;
}

describe('encodedImageSize', () => {
  it('reads PNG, JPEG, GIF and WebP headers', () => {
    expect(encodedImageSize(png(4096, 3921))).toEqual({
      width: 4096,
      height: 3921,
    });
    expect(encodedImageSize(jpeg(2160, 2880))).toEqual({
      width: 2160,
      height: 2880,
    });
    expect(encodedImageSize(gif(320, 200))).toEqual({
      width: 320,
      height: 200,
    });
    expect(encodedImageSize(webpLossless(1000, 750))).toEqual({
      width: 1000,
      height: 750,
    });
  });

  it('returns null for anything else', () => {
    expect(encodedImageSize(new TextEncoder().encode('<svg></svg>'))).toBe(
      null,
    );
    expect(encodedImageSize(new Uint8Array([0xff, 0xd8]))).toBe(null);
  });
});

describe('imageLevel', () => {
  const big = { width: 4096, height: 3921 };

  it('keeps full size without a scale, at 1:1 and for small images', () => {
    expect(imageLevel(big, undefined)).toBe(0);
    expect(imageLevel(big, 1)).toBe(0);
    expect(imageLevel(big, 4)).toBe(0);
    expect(imageLevel({ width: 512, height: 300 }, 0.01)).toBe(0);
  });

  it('halves while the reduction still covers the scale', () => {
    expect(imageLevel(big, 0.6)).toBe(0);
    expect(imageLevel(big, 0.5)).toBe(1);
    expect(imageLevel(big, 0.3)).toBe(1);
    expect(imageLevel(big, 0.25)).toBe(2);
  });

  it('stops at 256px on the longest side', () => {
    expect(imageLevel(big, 0.001)).toBe(4);
    expect(imageLevel({ width: 1200, height: 800 }, 0.001)).toBe(2);
  });
});

describe('levelsToDrop', () => {
  it('keeps everything while there are no more than `kept` levels', () => {
    expect(levelsToDrop([], 3)).toEqual([]);
    expect(
      levelsToDrop(
        [
          [1, 5],
          [0, 2],
        ],
        3,
      ),
    ).toEqual([]);
  });

  it('drops the least recently used beyond `kept`', () => {
    expect(
      levelsToDrop(
        [
          [0, 9],
          [1, 3],
          [2, 7],
          [3, 1],
        ],
        3,
      ),
    ).toEqual([3]);
    expect(
      levelsToDrop(
        [
          [0, 9],
          [1, 3],
          [2, 7],
          [3, 1],
          [4, 8],
        ],
        3,
      ),
    ).toEqual([3, 1]);
  });
});
