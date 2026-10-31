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
import { filteredImageKey, lutLayers } from '../image-filters';
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

/** cos and sin of a whole number of clockwise quarter turns. */
function quarterTurn(degrees = 0): [number, number] {
  const q = ((Math.round(degrees / 90) % 4) + 4) % 4;
  return q === 1 ? [0, 1] : q === 2 ? [-1, 0] : q === 3 ? [0, -1] : [1, 0];
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
  const baked = key ? src.images[key] : undefined;
  const url = baked || src.images[paint.imageRef];
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
  // See apps/docs/figma-to-tldraw/tech.md §22.2.
  const [cos, sin] = quarterTurn(paint.rotation);
  let m: number[];
  let tile = ck.TileMode.Decal;
  switch (paint.scaleMode) {
    case 'FIT':
    case 'FILL':
    case undefined: {
      const [rw, rh] = sin ? [ih, iw] : [iw, ih];
      const s =
        paint.scaleMode === 'FIT'
          ? Math.min(w / rw, h / rh)
          : Math.max(w / rw, h / rh);
      m = [
        s * cos,
        -s * sin,
        w / 2 - s * ((cos * iw) / 2 - (sin * ih) / 2),
        s * sin,
        s * cos,
        h / 2 - s * ((sin * iw) / 2 + (cos * ih) / 2),
        0,
        0,
        1,
      ];
      break;
    }
    case 'TILE': {
      const size = src.imageSizes[paint.imageRef] ?? { width: iw, height: ih };
      const f = paint.scalingFactor ?? 1;
      const sx = (size.width * f) / iw;
      const sy = (size.height * f) / ih;
      m = [sx * cos, -sy * sin, 0, sx * sin, sy * cos, 0, 0, 0, 1];
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
  const shader = d.keep(
    image.makeShaderOptions(
      tile,
      tile,
      ck.FilterMode.Linear,
      ck.MipmapMode.Linear,
      m,
    ),
  );
  return key && !baked ? liveFilters(ck, shader, paint, res, d) : shader;
}

let filterEffect: RuntimeEffect | null | undefined;

// See apps/docs/figma-to-tldraw/tech.md §22.3.
const FILTER_SKSL = `
uniform shader src;
uniform shader lo;
uniform shader hi;
uniform float t;

float2 cell(float b, float2 rg) {
  return float2(mod(b, 8.0), floor(b / 8.0)) * 64.0 + rg;
}

half4 main(float2 p) {
  half4 c = src.eval(p);
  if (c.a <= 0.0) {
    return c;
  }
  float3 v = clamp(float3(c.rgb) / float(c.a), 0.0, 1.0) * 63.0;
  float b0 = floor(v.b);
  float b1 = min(b0 + 1.0, 63.0);
  float f = v.b - b0;
  float2 rg = v.rg + 0.5;
  float2 p0 = cell(b0, rg);
  float2 p1 = cell(b1, rg);
  float3 a = mix(float3(lo.eval(p0).rgb), float3(lo.eval(p1).rgb), f);
  float3 b = mix(float3(hi.eval(p0).rgb), float3(hi.eval(p1).rgb), f);
  return half4(half3(mix(a, b, t)) * c.a, c.a);
}`;

/** The image with its filters applied through measured color tables. */
function liveFilters(
  ck: CanvasKit,
  input: Shader,
  paint: FigmaPaint,
  res: Resources,
  d: Disposer,
): Shader {
  filterEffect ??= ck.RuntimeEffect.Make(FILTER_SKSL);
  if (!filterEffect) {
    return input;
  }
  const table = (url: string) => {
    const image = res.getImage(url);
    return image
      ? d.keep(
          image.makeShaderOptions(
            ck.TileMode.Clamp,
            ck.TileMode.Clamp,
            ck.FilterMode.Linear,
            ck.MipmapMode.None,
          ),
        )
      : undefined;
  };
  let out = input;
  for (const layer of lutLayers(paint.filters)) {
    if (res.imageFailed(layer.lo) || res.imageFailed(layer.hi)) {
      continue;
    }
    const lo = table(layer.lo);
    const hi = table(layer.hi);
    if (!lo || !hi) {
      return input;
    }
    out = d.keep(filterEffect.makeShaderWithChildren([layer.t], [out, lo, hi]));
  }
  return out;
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
