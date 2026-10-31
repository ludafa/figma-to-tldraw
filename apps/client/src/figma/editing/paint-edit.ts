import { sliderValue, STORED_SCALE } from '../image-filters';
import type {
  FigmaBlendMode,
  FigmaColor,
  FigmaColorStop,
  FigmaImageFilters,
  FigmaPaint,
  FigmaTransform,
} from '../types';

// See apps/docs/figma-to-tldraw/tech.md §22.

export type PaintKind = 'SOLID' | 'GRADIENT' | 'IMAGE';

export const GRADIENT_TYPES = [
  'GRADIENT_LINEAR',
  'GRADIENT_RADIAL',
  'GRADIENT_ANGULAR',
  'GRADIENT_DIAMOND',
] as const;

export function paintKind(paint: FigmaPaint): PaintKind | undefined {
  if (paint.type === 'SOLID' || paint.type === 'IMAGE') {
    return paint.type;
  }
  return paint.type.startsWith('GRADIENT_') ? 'GRADIENT' : undefined;
}

const GRAY: FigmaColor = { r: 0.85, g: 0.85, b: 0.85, a: 1 };

export const DEFAULT_HANDLES = [
  { x: 0, y: 0.5 },
  { x: 1, y: 0.5 },
  { x: 0, y: 1 },
];

function base(paint: FigmaPaint): FigmaPaint {
  const out: FigmaPaint = { type: paint.type };
  for (const key of ['visible', 'opacity', 'blendMode'] as const) {
    if (paint[key] !== undefined) {
      Object.assign(out, { [key]: paint[key] });
    }
  }
  return out;
}

/** The paint switched to another kind; an image paint may still lack its image. */
export function convertPaint(
  paint: FigmaPaint,
  kind: PaintKind,
  lastImage?: FigmaPaint,
): FigmaPaint {
  if (paintKind(paint) === kind) {
    return paint;
  }
  const color = paint.color ?? paint.gradientStops?.[0]?.color ?? GRAY;
  if (kind === 'SOLID') {
    return { ...base(paint), type: 'SOLID', color: { ...color, a: 1 } };
  }
  if (kind === 'GRADIENT') {
    return {
      ...base(paint),
      type: 'GRADIENT_LINEAR',
      gradientHandlePositions: DEFAULT_HANDLES,
      gradientStops: [
        { position: 0, color: { ...color, a: 1 } },
        { position: 1, color: { ...color, a: 0 } },
      ],
    };
  }
  return {
    ...lastImage,
    ...base(paint),
    type: 'IMAGE',
    scaleMode: lastImage?.scaleMode ?? 'FILL',
  };
}

function without<K extends keyof FigmaPaint>(
  paint: FigmaPaint,
  ...keys: K[]
): FigmaPaint {
  const out = { ...paint };
  for (const k of keys) {
    delete out[k];
  }
  return out;
}

/** Figma's crop (`STRETCH`) transform that shows what FILL / FIT shows now. */
export function cropTransform(
  mode: FigmaPaint['scaleMode'],
  node: { w: number; h: number },
  image: { width: number; height: number },
): FigmaTransform {
  const s =
    mode === 'FIT'
      ? Math.min(node.w / image.width, node.h / image.height)
      : Math.max(node.w / image.width, node.h / image.height);
  const fw = node.w / (s * image.width);
  const fh = node.h / (s * image.height);
  return [
    [fw, 0, (1 - fw) / 2],
    [0, fh, (1 - fh) / 2],
  ];
}

export function setScaleMode(
  paint: FigmaPaint,
  mode: NonNullable<FigmaPaint['scaleMode']>,
  node: { w: number; h: number },
  image: { width: number; height: number } | undefined,
): FigmaPaint {
  if (mode === 'STRETCH') {
    return {
      ...without(paint, 'rotation', 'scalingFactor'),
      scaleMode: 'STRETCH',
      imageTransform: image
        ? cropTransform(paint.scaleMode, node, image)
        : [
            [1, 0, 0],
            [0, 1, 0],
          ],
    };
  }
  if (mode === 'TILE') {
    return {
      ...without(paint, 'imageTransform'),
      scaleMode: 'TILE',
      scalingFactor: paint.scalingFactor ?? 1,
    };
  }
  return {
    ...without(paint, 'imageTransform', 'scalingFactor'),
    scaleMode: mode,
  };
}

export function rotateImage(paint: FigmaPaint): FigmaPaint {
  const rotation = ((paint.rotation ?? 0) + 90) % 360;
  return rotation ? { ...paint, rotation } : without(paint, 'rotation');
}

export const FILTERS: [keyof FigmaImageFilters, string][] = [
  ['exposure', '曝光'],
  ['contrast', '对比度'],
  ['saturation', '饱和度'],
  ['temperature', '色温'],
  ['tint', '色调'],
  ['highlights', '高光'],
  ['shadows', '阴影'],
];

/** A filter as the slider shows it, -1 to 1. */
export function filterValue(
  paint: FigmaPaint,
  key: keyof FigmaImageFilters,
): number {
  return sliderValue(paint.filters, key);
}

export function withFilter(
  paint: FigmaPaint,
  key: keyof FigmaImageFilters,
  value: number,
): FigmaPaint {
  const stored = Math.round(value * (STORED_SCALE[key] ?? 1) * 1000) / 1000;
  const filters: FigmaImageFilters = { ...paint.filters };
  if (stored) {
    filters[key] = stored;
  } else {
    delete filters[key];
  }
  return Object.keys(filters).length
    ? { ...paint, filters }
    : without(paint, 'filters');
}

export const BLEND_MODES: [FigmaBlendMode, string][] = [
  ['NORMAL', '正常'],
  ['DARKEN', '变暗'],
  ['MULTIPLY', '正片叠底'],
  ['LINEAR_BURN', '线性加深'],
  ['COLOR_BURN', '颜色加深'],
  ['LIGHTEN', '变亮'],
  ['SCREEN', '滤色'],
  ['LINEAR_DODGE', '线性减淡'],
  ['COLOR_DODGE', '颜色减淡'],
  ['OVERLAY', '叠加'],
  ['SOFT_LIGHT', '柔光'],
  ['HARD_LIGHT', '强光'],
  ['DIFFERENCE', '差值'],
  ['EXCLUSION', '排除'],
  ['HUE', '色相'],
  ['SATURATION', '饱和度'],
  ['COLOR', '颜色'],
  ['LUMINOSITY', '明度'],
];

export interface LocalImage {
  ref: string;
  url: string;
  size: { width: number; height: number };
}

/** A picked file, keyed like Figma keys images: the SHA-1 of its bytes. */
export async function readImageFile(file: File): Promise<LocalImage> {
  const digest = await crypto.subtle.digest('SHA-1', await file.arrayBuffer());
  const ref = [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const bitmap = await createImageBitmap(file);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return { ref, url: URL.createObjectURL(file), size };
}

/** Hue in degrees, saturation and value 0–1. */
export interface Hsv {
  h: number;
  s: number;
  v: number;
}

export function hsvToRgb({ h, s, v }: Hsv, a = 1): FigmaColor {
  const channel = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return { r: channel(5), g: channel(3), b: channel(1), a };
}

// See apps/docs/figma-to-tldraw/tech.md §22.4.
export function rgbToHsv(c: FigmaColor, prev?: Hsv): Hsv {
  const max = Math.max(c.r, c.g, c.b);
  const d = max - Math.min(c.r, c.g, c.b);
  let h = prev?.h ?? 0;
  if (d > 0) {
    if (max === c.r) {
      h = 60 * ((c.g - c.b) / d);
    } else if (max === c.g) {
      h = 60 * ((c.b - c.r) / d + 2);
    } else {
      h = 60 * ((c.r - c.g) / d + 4);
    }
    h = (h + 360) % 360;
  }
  return { h, s: max > 0 ? d / max : (prev?.s ?? 0), v: max };
}

export function sameRgb(a: FigmaColor, b: FigmaColor): boolean {
  return (
    Math.abs(a.r - b.r) < 1e-4 &&
    Math.abs(a.g - b.g) < 1e-4 &&
    Math.abs(a.b - b.b) < 1e-4
  );
}

// See apps/docs/figma-to-tldraw/tech.md §22.5.
export function flipGradient(paint: FigmaPaint): FigmaPaint {
  const stops = paint.gradientStops ?? [];
  return {
    ...paint,
    gradientStops: stops
      .map((s) => ({ ...s, position: 1 - s.position }))
      .reverse(),
  };
}

/** Turns the handles 90° clockwise around the middle of the layer. */
export function rotateGradient(paint: FigmaPaint): FigmaPaint {
  const handles = paint.gradientHandlePositions ?? DEFAULT_HANDLES;
  return {
    ...paint,
    gradientHandlePositions: handles.map(({ x, y }) => ({
      x: 0.5 - (y - 0.5),
      y: 0.5 + (x - 0.5),
    })),
  };
}

export function colorAt(stops: FigmaColorStop[], position: number): FigmaColor {
  if (!stops.length) {
    return { ...GRAY };
  }
  const after = stops.findIndex((s) => s.position >= position);
  if (after <= 0) {
    return { ...stops[after < 0 ? stops.length - 1 : 0].color };
  }
  const a = stops[after - 1];
  const b = stops[after];
  const t = (position - a.position) / (b.position - a.position || 1);
  const mix = (x: number, y: number) => x + (y - x) * t;
  return {
    r: mix(a.color.r, b.color.r),
    g: mix(a.color.g, b.color.g),
    b: mix(a.color.b, b.color.b),
    a: mix(a.color.a ?? 1, b.color.a ?? 1),
  };
}

/** Stops sorted by position, and where stop `index` ended up. */
function sorted(
  paint: FigmaPaint,
  stops: FigmaColorStop[],
  moved: FigmaColorStop,
): { paint: FigmaPaint; index: number } {
  const next = [...stops].sort((a, b) => a.position - b.position);
  return {
    paint: { ...paint, gradientStops: next },
    index: next.indexOf(moved),
  };
}

export function addStop(
  paint: FigmaPaint,
  position: number,
): { paint: FigmaPaint; index: number } {
  const stops = paint.gradientStops ?? [];
  const p = Math.min(1, Math.max(0, position));
  const stop = { position: p, color: colorAt(stops, p) };
  return sorted(paint, [...stops, stop], stop);
}

/** The middle of the widest gap, where the + button puts a new stop. */
export function freePosition(stops: FigmaColorStop[]): number {
  const edges = [0, ...stops.map((s) => s.position).sort((a, b) => a - b), 1];
  let best = 0.5;
  let gap = -1;
  for (let i = 1; i < edges.length; i++) {
    if (edges[i] - edges[i - 1] > gap) {
      gap = edges[i] - edges[i - 1];
      best = (edges[i] + edges[i - 1]) / 2;
    }
  }
  return best;
}

export function moveStop(
  paint: FigmaPaint,
  index: number,
  position: number,
): { paint: FigmaPaint; index: number } {
  const stops = paint.gradientStops ?? [];
  const moved = {
    ...stops[index],
    position: Math.min(1, Math.max(0, position)),
  };
  return sorted(
    paint,
    stops.map((s, i) => (i === index ? moved : s)),
    moved,
  );
}

export const MIN_STOPS = 2;

export function removeStop(paint: FigmaPaint, index: number): FigmaPaint {
  const stops = paint.gradientStops ?? [];
  if (stops.length <= MIN_STOPS) {
    return paint;
  }
  return { ...paint, gradientStops: stops.filter((_, i) => i !== index) };
}

export function setStopColor(
  paint: FigmaPaint,
  index: number,
  color: FigmaColor,
): FigmaPaint {
  return {
    ...paint,
    gradientStops: (paint.gradientStops ?? []).map((s, i) =>
      i === index ? { ...s, color } : s,
    ),
  };
}
