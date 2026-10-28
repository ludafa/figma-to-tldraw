import type {
  BlendMode,
  CanvasKit,
  Color,
  Image,
  Paint,
  RuntimeEffect,
  Shader,
} from 'canvaskit-wasm';

import type { Resources } from '../../engine/render/resources';
import { filteredImageKey } from '../image-filters';
import { gradientMatrix } from '../paint-math';
import type { FigmaBlendMode, FigmaColor, FigmaPaint } from '../types';

// See apps/docs/skia-engine/tech.md §7.1.

export interface PaintSource {
  w: number;
  h: number;
  images: Record<string, string>;
  imageSizes: Record<string, { width: number; height: number }>;
  /** Device pixels per local unit (`PaintContext.scale`). */
  scale?: number;
}

export interface Disposer {
  keep<T extends { delete(): void }>(obj: T): T;
}

export function visiblePaints(paints: FigmaPaint[] | undefined): FigmaPaint[] {
  return (paints ?? []).filter((p) => p.visible !== false);
}

export function color4f(ck: CanvasKit, c: FigmaColor, opacity = 1): Color {
  return ck.Color4f(c.r, c.g, c.b, c.a * opacity);
}

const BLEND: Partial<Record<FigmaBlendMode, keyof CanvasKit['BlendMode']>> = {
  DARKEN: 'Darken',
  MULTIPLY: 'Multiply',
  COLOR_BURN: 'ColorBurn',
  LIGHTEN: 'Lighten',
  SCREEN: 'Screen',
  COLOR_DODGE: 'ColorDodge',
  OVERLAY: 'Overlay',
  SOFT_LIGHT: 'SoftLight',
  HARD_LIGHT: 'HardLight',
  DIFFERENCE: 'Difference',
  EXCLUSION: 'Exclusion',
  HUE: 'Hue',
  SATURATION: 'Saturation',
  COLOR: 'Color',
  LUMINOSITY: 'Luminosity',
  LINEAR_DODGE: 'Plus',
};

export function skiaBlend(ck: CanvasKit, mode: FigmaBlendMode | undefined) {
  const key = mode ? BLEND[mode] : undefined;
  return key ? (ck.BlendMode[key] as BlendMode) : undefined;
}

function matrix3(m: [[number, number, number], [number, number, number]]) {
  return [m[0][0], m[0][1], m[0][2], m[1][0], m[1][1], m[1][2], 0, 0, 1];
}

let diamondEffect: RuntimeEffect | null | undefined;

const DIAMOND_SKSL = `
uniform shader ramp;
half4 main(float2 p) {
  return ramp.eval(float2(abs(p.x) + abs(p.y), 0.5));
}`;

function gradientShader(
  ck: CanvasKit,
  paint: FigmaPaint,
  w: number,
  h: number,
  d: Disposer,
): Shader | undefined {
  const stops = paint.gradientStops ?? [];
  if (!stops.length) {
    return undefined;
  }
  const colors = stops.map((s) => color4f(ck, s.color));
  const pos = stops.map((s) => s.position);
  const m = matrix3(gradientMatrix(paint, w, h));
  switch (paint.type) {
    case 'GRADIENT_LINEAR':
      return d.keep(
        ck.Shader.MakeLinearGradient(
          [0, 0],
          [1, 0],
          colors,
          pos,
          ck.TileMode.Clamp,
          m,
        ),
      );
    case 'GRADIENT_RADIAL':
      return d.keep(
        ck.Shader.MakeRadialGradient(
          [0, 0],
          1,
          colors,
          pos,
          ck.TileMode.Clamp,
          m,
        ),
      );
    case 'GRADIENT_ANGULAR':
      return d.keep(
        ck.Shader.MakeSweepGradient(0, 0, colors, pos, ck.TileMode.Clamp, m),
      );
    case 'GRADIENT_DIAMOND': {
      diamondEffect ??= ck.RuntimeEffect.Make(DIAMOND_SKSL);
      if (!diamondEffect) {
        return undefined;
      }
      const ramp = d.keep(
        ck.Shader.MakeLinearGradient(
          [0, 0],
          [1, 0],
          colors,
          pos,
          ck.TileMode.Clamp,
        ),
      );
      return d.keep(diamondEffect.makeShaderWithChildren([], [ramp], m));
    }
  }
  return undefined;
}

function imageShader(
  ck: CanvasKit,
  paint: FigmaPaint,
  src: PaintSource,
  res: Resources,
  d: Disposer,
): Shader | undefined {
  if (!paint.imageRef) {
    return undefined;
  }
  const key = filteredImageKey(paint.imageRef, paint.filters);
  const url = (key && src.images[key]) || src.images[paint.imageRef];
  const natural = url ? res.imageSize(url) : undefined;
  if (!url || !natural) {
    // Starts the download and marks the drawing incomplete.
    if (url) {
      res.getImage(url);
    }
    return undefined;
  }
  const iw = natural.width;
  const ih = natural.height;
  const { w, h } = src;
  let m: number[];
  let tile = ck.TileMode.Decal;
  switch (paint.scaleMode) {
    case 'FIT':
    case 'FILL':
    case undefined: {
      const s =
        paint.scaleMode === 'FIT'
          ? Math.min(w / iw, h / ih)
          : Math.max(w / iw, h / ih);
      m = [s, 0, (w - iw * s) / 2, 0, s, (h - ih * s) / 2, 0, 0, 1];
      break;
    }
    case 'TILE': {
      const size = src.imageSizes[paint.imageRef] ?? { width: iw, height: ih };
      const f = paint.scalingFactor ?? 1;
      m = [(size.width * f) / iw, 0, 0, 0, (size.height * f) / ih, 0, 0, 0, 1];
      tile = ck.TileMode.Repeat;
      break;
    }
    case 'STRETCH': {
      const t = paint.imageTransform ?? [
        [1, 0, 0],
        [0, 1, 0],
      ];
      const [[a, c, e], [b, dd, f]] = t;
      const det = a * dd - b * c;
      const inv = [
        dd / det,
        -c / det,
        (c * f - dd * e) / det,
        -b / det,
        a / det,
        (b * e - a * f) / det,
      ];
      // S(w,h) · T⁻¹ · S(1/iw, 1/ih)
      m = [
        (w * inv[0]) / iw,
        (w * inv[1]) / ih,
        w * inv[2],
        (h * inv[3]) / iw,
        (h * inv[4]) / ih,
        h * inv[5],
        0,
        0,
        1,
      ];
      break;
    }
  }
  // See apps/docs/skia-engine/tech.md §5.1.
  const perPixel = Math.max(Math.hypot(m[0], m[3]), Math.hypot(m[1], m[4]));
  const image: Image | undefined = res.getImage(
    url,
    src.scale === undefined ? undefined : src.scale * perPixel,
  );
  if (!image) {
    return undefined;
  }
  const kx = iw / image.width();
  const ky = ih / image.height();
  m = [m[0] * kx, m[1] * ky, m[2], m[3] * kx, m[4] * ky, m[5], 0, 0, 1];
  return d.keep(
    image.makeShaderOptions(
      tile,
      tile,
      ck.FilterMode.Linear,
      ck.MipmapMode.Linear,
      m,
    ),
  );
}

/** A Skia paint for one Figma paint, or undefined when it draws nothing. */
export function skiaPaint(
  ck: CanvasKit,
  paint: FigmaPaint,
  src: PaintSource,
  res: Resources,
  d: Disposer,
): Paint | undefined {
  const opacity = paint.opacity ?? 1;
  if (opacity <= 0) {
    return undefined;
  }
  const p = d.keep(new ck.Paint());
  p.setAntiAlias(true);
  if (paint.type === 'SOLID') {
    if (!paint.color) {
      return undefined;
    }
    p.setColor(color4f(ck, paint.color, opacity));
  } else if (paint.type.startsWith('GRADIENT_')) {
    const shader = gradientShader(ck, paint, src.w, src.h, d);
    if (!shader) {
      return undefined;
    }
    p.setShader(shader);
    p.setAlphaf(opacity);
  } else if (paint.type === 'IMAGE') {
    const shader = imageShader(ck, paint, src, res, d);
    if (!shader) {
      return undefined;
    }
    p.setShader(shader);
    p.setAlphaf(opacity);
  } else {
    return undefined;
  }
  const blend = skiaBlend(ck, paint.blendMode);
  if (blend) {
    p.setBlendMode(blend);
  }
  return p;
}
