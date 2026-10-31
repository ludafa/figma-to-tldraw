import { describe, expect, it } from 'vitest';

import type { FigmaPaint } from '../types';
import {
  addStop,
  colorAt,
  convertPaint,
  cropTransform,
  filterValue,
  flipGradient,
  freePosition,
  hsvToRgb,
  moveStop,
  removeStop,
  rgbToHsv,
  rotateGradient,
  rotateImage,
  setScaleMode,
  withFilter,
} from './paint-edit';

const image: FigmaPaint = {
  type: 'IMAGE',
  imageRef: 'abc',
  scaleMode: 'FILL',
  opacity: 0.5,
  blendMode: 'MULTIPLY',
};

describe('convertPaint', () => {
  it('keeps visibility, opacity and blend mode across kinds', () => {
    const solid = convertPaint(image, 'SOLID');
    expect(solid).toEqual({
      type: 'SOLID',
      opacity: 0.5,
      blendMode: 'MULTIPLY',
      color: { r: 0.85, g: 0.85, b: 0.85, a: 1 },
    });
  });

  it('turns a solid into a fade to the same color, and a gradient back into its first stop', () => {
    const red: FigmaPaint = {
      type: 'SOLID',
      color: { r: 1, g: 0, b: 0, a: 1 },
    };
    const gradient = convertPaint(red, 'GRADIENT');
    expect(gradient.type).toBe('GRADIENT_LINEAR');
    expect(gradient.gradientStops?.map((s) => s.color.a)).toEqual([1, 0]);
    expect(convertPaint(gradient, 'SOLID').color).toEqual(red.color);
  });

  it('brings back the last image, or an image paint still waiting for one', () => {
    const red: FigmaPaint = {
      type: 'SOLID',
      color: { r: 1, g: 0, b: 0, a: 1 },
    };
    expect(convertPaint(red, 'IMAGE', image)).toMatchObject({
      type: 'IMAGE',
      imageRef: 'abc',
    });
    expect(convertPaint(red, 'IMAGE')).toEqual({
      type: 'IMAGE',
      scaleMode: 'FILL',
    });
  });
});

describe('scale modes', () => {
  it('crops to the part that FILL shows, centered', () => {
    expect(
      cropTransform('FILL', { w: 100, h: 100 }, { width: 200, height: 100 }),
    ).toEqual([
      [0.5, 0, 0.25],
      [0, 1, 0],
    ]);
  });

  it('switching to crop drops rotation; switching to tile starts at 100%', () => {
    const rotated = { ...image, rotation: 90 };
    const crop = setScaleMode(
      rotated,
      'STRETCH',
      { w: 100, h: 100 },
      undefined,
    );
    expect(crop.rotation).toBeUndefined();
    expect(crop.imageTransform).toEqual([
      [1, 0, 0],
      [0, 1, 0],
    ]);
    const tile = setScaleMode(crop, 'TILE', { w: 100, h: 100 }, undefined);
    expect(tile.imageTransform).toBeUndefined();
    expect(tile.scalingFactor).toBe(1);
  });

  it('rotates by quarter turns and forgets a full turn', () => {
    expect(rotateImage(image).rotation).toBe(90);
    expect(rotateImage({ ...image, rotation: 270 })).not.toHaveProperty(
      'rotation',
    );
  });
});

describe('filters', () => {
  it('stores contrast at 0.3 of the slider and drops filters that go back to 0', () => {
    const p = withFilter(image, 'contrast', -1);
    expect(p.filters).toEqual({ contrast: -0.3 });
    expect(filterValue(p, 'contrast')).toBeCloseTo(-1);
    expect(withFilter(p, 'contrast', 0)).not.toHaveProperty('filters');
  });
});

describe('hsv', () => {
  const close = (c: { r: number; g: number; b: number }) =>
    [c.r, c.g, c.b].map((v) => Math.round(v * 255));

  it('converts the primaries and back', () => {
    expect(close(hsvToRgb({ h: 0, s: 1, v: 1 }))).toEqual([255, 0, 0]);
    expect(close(hsvToRgb({ h: 120, s: 1, v: 1 }))).toEqual([0, 255, 0]);
    expect(close(hsvToRgb({ h: 240, s: 1, v: 0.5 }))).toEqual([0, 0, 128]);
    expect(close(hsvToRgb({ h: 30, s: 0.5, v: 1 }))).toEqual([255, 191, 128]);
    const hsv = rgbToHsv({ r: 1, g: 0.75, b: 0.5, a: 1 });
    expect(hsv.h).toBeCloseTo(30);
    expect(hsv.s).toBeCloseTo(0.5);
    expect(hsv.v).toBe(1);
    expect(rgbToHsv({ r: 1, g: 0, b: 0.5, a: 1 }).h).toBeCloseTo(330);
  });

  it('keeps the hue on grays and the saturation on black', () => {
    const prev = { h: 200, s: 0.6, v: 0.8 };
    expect(rgbToHsv({ r: 0.5, g: 0.5, b: 0.5, a: 1 }, prev)).toEqual({
      h: 200,
      s: 0,
      v: 0.5,
    });
    expect(rgbToHsv({ r: 0, g: 0, b: 0, a: 1 }, prev)).toEqual({
      h: 200,
      s: 0.6,
      v: 0,
    });
  });

  it('keeps the alpha it is given', () => {
    expect(hsvToRgb({ h: 0, s: 0, v: 1 }, 0.4).a).toBe(0.4);
  });
});

describe('gradient stops', () => {
  const red = { r: 1, g: 0, b: 0, a: 1 };
  const blue = { r: 0, g: 0, b: 1, a: 0 };
  const gradient: FigmaPaint = {
    type: 'GRADIENT_LINEAR',
    gradientHandlePositions: [
      { x: 0, y: 0.5 },
      { x: 1, y: 0.5 },
      { x: 0, y: 1 },
    ],
    gradientStops: [
      { position: 0, color: red },
      { position: 1, color: blue },
    ],
  };
  const positions = (p: FigmaPaint) => p.gradientStops?.map((s) => s.position);

  it('flips the stops end to end', () => {
    const flipped = flipGradient({
      ...gradient,
      gradientStops: [
        { position: 0.2, color: red },
        { position: 1, color: blue },
      ],
    });
    expect(positions(flipped)).toEqual([0, 0.8]);
    expect(flipped.gradientStops?.[0].color).toBe(blue);
  });

  it('turns left-to-right into top-to-bottom', () => {
    const turned = rotateGradient(gradient).gradientHandlePositions;
    expect(turned).toEqual([
      { x: 0.5, y: 0 },
      { x: 0.5, y: 1 },
      { x: 0, y: 0 },
    ]);
    const full = [1, 2, 3].reduce(
      (p) => rotateGradient(p),
      rotateGradient(gradient),
    );
    expect(full.gradientHandlePositions).toEqual(
      gradient.gradientHandlePositions,
    );
  });

  it('adds a stop with the color already shown there', () => {
    expect(colorAt(gradient.gradientStops ?? [], 0.25)).toEqual({
      r: 0.75,
      g: 0,
      b: 0.25,
      a: 0.75,
    });
    const { paint, index } = addStop(gradient, 0.5);
    expect(index).toBe(1);
    expect(positions(paint)).toEqual([0, 0.5, 1]);
    expect(paint.gradientStops?.[1].color).toEqual({
      r: 0.5,
      g: 0,
      b: 0.5,
      a: 0.5,
    });
    expect(freePosition(paint.gradientStops ?? [])).toBe(0.25);
  });

  it('keeps stops sorted and follows the moved one past its neighbor', () => {
    const three = addStop(gradient, 0.5).paint;
    const { paint, index } = moveStop(three, 0, 0.7);
    expect(positions(paint)).toEqual([0.5, 0.7, 1]);
    expect(index).toBe(1);
    expect(paint.gradientStops?.[1].color).toBe(red);
    expect(positions(moveStop(three, 2, 1.4).paint)).toEqual([0, 0.5, 1]);
  });

  it('never goes below two stops', () => {
    expect(removeStop(gradient, 0)).toBe(gradient);
    expect(positions(removeStop(addStop(gradient, 0.5).paint, 1))).toEqual([
      0, 1,
    ]);
  });
});
