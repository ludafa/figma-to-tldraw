import type { CanvasKit } from 'canvaskit-wasm';
import { describe, expect, it } from 'vitest';

import { parseCssColor } from './overlay';

const ck = {
  Color4f: (r: number, g: number, b: number, a: number) =>
    Float32Array.of(r, g, b, a),
} as unknown as CanvasKit;

const rgba = (css: string) =>
  [...(parseCssColor(ck, css) ?? [])].map((v) => Math.round(v * 1000) / 1000);

describe('parseCssColor', () => {
  it('reads the space syntax with a percentage alpha', () => {
    expect(rgba('rgb(151 71 255 / 16%)')).toEqual([0.592, 0.278, 1, 0.16]);
  });

  it('reads the comma syntax', () => {
    expect(rgba('rgba(13, 153, 255, 0.08)')).toEqual([0.051, 0.6, 1, 0.08]);
    expect(rgba('rgb(0,0,0)')).toEqual([0, 0, 0, 1]);
  });

  it('leaves other formats to CanvasKit', () => {
    expect(parseCssColor(ck, '#0D99FF')).toBeNull();
    expect(parseCssColor(ck, 'red')).toBeNull();
  });
});
