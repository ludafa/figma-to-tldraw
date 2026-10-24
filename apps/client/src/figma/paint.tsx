import { type CSSProperties, type ReactNode, useId } from 'react';

import {
  borderRadiusCss,
  clampRadii,
  type Radii,
  rgba,
  roundedRectPath,
} from './geometry';
import { multiply, toCss, toSvg } from './matrix';
import type { FigmaNode, FigmaPaint, Matrix2x3 } from './types';

// See apps/docs/figma-to-tldraw/tech.md §6.1 and §6.2.

export interface PaintContext {
  w: number;
  h: number;
  images: Record<string, string>;
  imageSizes: Record<string, { width: number; height: number }>;
}

const BLEND_CSS: Partial<Record<string, CSSProperties['mixBlendMode']>> = {
  DARKEN: 'darken',
  MULTIPLY: 'multiply',
  COLOR_BURN: 'color-burn',
  LIGHTEN: 'lighten',
  SCREEN: 'screen',
  COLOR_DODGE: 'color-dodge',
  OVERLAY: 'overlay',
  SOFT_LIGHT: 'soft-light',
  HARD_LIGHT: 'hard-light',
  DIFFERENCE: 'difference',
  EXCLUSION: 'exclusion',
  HUE: 'hue',
  SATURATION: 'saturation',
  COLOR: 'color',
  LUMINOSITY: 'luminosity',
};

export function useSvgId(): string {
  return useId().replace(/[^a-zA-Z0-9_-]/g, '');
}

export function blendCss(mode: string | undefined) {
  return mode ? BLEND_CSS[mode] : undefined;
}

export function visiblePaints(paints: FigmaPaint[] | undefined): FigmaPaint[] {
  return (paints ?? []).filter((p) => p.visible !== false);
}

// See apps/docs/figma-to-tldraw/tech.md §6.1.
export function gradientMatrix(paint: FigmaPaint, w: number, h: number) {
  const [p0, p1, p2] = paint.gradientHandlePositions ?? [
    { x: 0, y: 0.5 },
    { x: 1, y: 0.5 },
    { x: 0, y: 1 },
  ];
  return [
    [(p1.x - p0.x) * w, (p2.x - p0.x) * w, p0.x * w],
    [(p1.y - p0.y) * h, (p2.y - p0.y) * h, p0.y * h],
  ] satisfies Matrix2x3;
}

function stopsSvg(paint: FigmaPaint) {
  return (paint.gradientStops ?? []).map((s, i) => (
    <stop key={i} offset={s.position} stopColor={rgba(s.color)} />
  ));
}

export function SvgGradientDef({
  id,
  paint,
  w,
  h,
}: {
  id: string;
  paint: FigmaPaint;
  w: number;
  h: number;
}) {
  const m = toSvg(gradientMatrix(paint, w, h));
  if (paint.type === 'GRADIENT_LINEAR') {
    return (
      <linearGradient
        id={id}
        gradientUnits="userSpaceOnUse"
        x1={0}
        y1={0}
        x2={1}
        y2={0}
        gradientTransform={m}
      >
        {stopsSvg(paint)}
      </linearGradient>
    );
  }
  return (
    <radialGradient
      id={id}
      gradientUnits="userSpaceOnUse"
      cx={0}
      cy={0}
      r={1}
      gradientTransform={m}
    >
      {stopsSvg(paint)}
    </radialGradient>
  );
}

function cssStops(paint: FigmaPaint, scale: number, unit: string) {
  return (paint.gradientStops ?? [])
    .map((s) => `${rgba(s.color)} ${s.position * scale}${unit}`)
    .join(', ');
}

// See apps/docs/figma-to-tldraw/tech.md §6.1.
const EXTENT = 8;
const UNIT_PX = 100;

function TransformedGradient({
  paint,
  w,
  h,
}: {
  paint: FigmaPaint;
  w: number;
  h: number;
}) {
  const g = gradientMatrix(paint, w, h);
  const s = 1 / UNIT_PX;
  const box = EXTENT * UNIT_PX;
  const m = multiply(g, [
    [s, 0, -EXTENT],
    [0, s, -EXTENT],
  ]);
  const base: CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: box * 2,
    height: box * 2,
    transformOrigin: '0 0',
    transform: toCss(m),
  };
  if (paint.type === 'GRADIENT_ANGULAR') {
    return (
      <div
        style={{
          ...base,
          background: `conic-gradient(from 90deg at 50% 50%, ${cssStops(paint, 360, 'deg')})`,
        }}
      />
    );
  }
  const last = paint.gradientStops?.at(-1);
  const quadrant = (
    left: number,
    top: number,
    angle: number,
  ): CSSProperties => ({
    position: 'absolute',
    left,
    top,
    width: box,
    height: box,
    background: `linear-gradient(${angle}deg, ${cssStops(paint, 100 / (2 * EXTENT), '%')}${last ? `, ${rgba(last.color)} 100%` : ''})`,
  });
  return (
    <div style={base}>
      <div style={quadrant(box, box, 135)} />
      <div style={quadrant(0, box, 225)} />
      <div style={quadrant(0, 0, 315)} />
      <div style={quadrant(box, 0, 45)} />
    </div>
  );
}

function ImageLayer({ paint, ctx }: { paint: FigmaPaint; ctx: PaintContext }) {
  const url = paint.imageRef ? ctx.images[paint.imageRef] : undefined;
  if (!url) {
    return null;
  }
  const style: CSSProperties = {
    position: 'absolute',
    inset: 0,
    backgroundImage: `url("${url}")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'center',
  };
  switch (paint.scaleMode) {
    case 'FIT':
      style.backgroundSize = 'contain';
      break;
    case 'TILE': {
      const size = paint.imageRef ? ctx.imageSizes[paint.imageRef] : undefined;
      const f = paint.scalingFactor ?? 1;
      style.backgroundRepeat = 'repeat';
      style.backgroundPosition = '0 0';
      style.backgroundSize = size
        ? `${size.width * f}px ${size.height * f}px`
        : 'auto';
      break;
    }
    case 'STRETCH': {
      const t = paint.imageTransform;
      if (t) {
        const [[a, c, e], [b, d, f]] = t;
        const det = a * d - b * c;
        const inv: Matrix2x3 = [
          [d / det, -c / det, (c * f - d * e) / det],
          [-b / det, a / det, (b * e - a * f) / det],
        ];
        const m = multiply(
          multiply(
            [
              [ctx.w, 0, 0],
              [0, ctx.h, 0],
            ],
            inv,
          ),
          [
            [1 / ctx.w, 0, 0],
            [0, 1 / ctx.h, 0],
          ],
        );
        return (
          <div
            style={{
              ...style,
              inset: undefined,
              left: 0,
              top: 0,
              width: ctx.w,
              height: ctx.h,
              backgroundSize: '100% 100%',
              transformOrigin: '0 0',
              transform: toCss(m),
            }}
          />
        );
      }
      style.backgroundSize = '100% 100%';
      break;
    }
    default:
      style.backgroundSize = 'cover';
  }
  return <div style={style} />;
}

function PaintLayer({ paint, ctx }: { paint: FigmaPaint; ctx: PaintContext }) {
  const id = useSvgId();
  const layer: CSSProperties = {
    position: 'absolute',
    inset: 0,
    overflow: 'hidden',
    opacity: paint.opacity ?? 1,
    mixBlendMode: blendCss(paint.blendMode),
  };
  let content: ReactNode = null;
  switch (paint.type) {
    case 'SOLID':
      layer.background = paint.color ? rgba(paint.color) : undefined;
      break;
    case 'GRADIENT_LINEAR':
    case 'GRADIENT_RADIAL':
      content = (
        <svg
          width={ctx.w}
          height={ctx.h}
          style={{ position: 'absolute', left: 0, top: 0, display: 'block' }}
        >
          <defs>
            <SvgGradientDef id={id} paint={paint} w={ctx.w} h={ctx.h} />
          </defs>
          <rect width={ctx.w} height={ctx.h} fill={`url(#${id})`} />
        </svg>
      );
      break;
    case 'GRADIENT_ANGULAR':
    case 'GRADIENT_DIAMOND':
      content = <TransformedGradient paint={paint} w={ctx.w} h={ctx.h} />;
      break;
    case 'IMAGE':
      content = <ImageLayer paint={paint} ctx={ctx} />;
      break;
    default:
      return null;
  }
  return <div style={layer}>{content}</div>;
}

export function Fills({
  paints,
  ctx,
}: {
  paints: FigmaPaint[] | undefined;
  ctx: PaintContext;
}) {
  return (
    <>
      {visiblePaints(paints).map((p, i) => (
        <PaintLayer key={i} paint={p} ctx={ctx} />
      ))}
    </>
  );
}

function strokePaintAttr(
  paint: FigmaPaint,
  gradientId: string,
): { stroke: string; strokeOpacity: number } | undefined {
  if (paint.type === 'SOLID' && paint.color) {
    return { stroke: rgba(paint.color), strokeOpacity: paint.opacity ?? 1 };
  }
  if (paint.type === 'GRADIENT_LINEAR' || paint.type === 'GRADIENT_RADIAL') {
    return { stroke: `url(#${gradientId})`, strokeOpacity: paint.opacity ?? 1 };
  }
  const first = paint.gradientStops?.[0];
  if (first) {
    return { stroke: rgba(first.color), strokeOpacity: paint.opacity ?? 1 };
  }
  return undefined;
}

export function Strokes({
  node,
  w,
  h,
  shape,
  radii,
}: {
  node: FigmaNode;
  w: number;
  h: number;
  shape: 'rect' | 'ellipse';
  radii: Radii;
}) {
  const baseId = useSvgId();
  const paints = visiblePaints(node.strokes);
  const weight = node.strokeWeight ?? 0;
  if (!paints.length) {
    return null;
  }
  const align = node.strokeAlign ?? 'INSIDE';

  const iw = node.individualStrokeWeights;
  if (iw && shape === 'rect') {
    const side = (v: number) =>
      align === 'INSIDE' ? 0 : align === 'CENTER' ? -v / 2 : -v;
    const color = paints[0].color ? rgba(paints[0].color) : 'transparent';
    return (
      <div
        style={{
          position: 'absolute',
          top: side(iw.top),
          right: side(iw.right),
          bottom: side(iw.bottom),
          left: side(iw.left),
          borderStyle: 'solid',
          borderColor: color,
          borderWidth: `${iw.top}px ${iw.right}px ${iw.bottom}px ${iw.left}px`,
          borderRadius: borderRadiusCss(clampRadii(radii, w, h)),
          opacity: paints[0].opacity ?? 1,
        }}
      />
    );
  }
  if (weight <= 0) {
    return null;
  }

  const offset =
    align === 'INSIDE' ? weight / 2 : align === 'CENTER' ? 0 : -weight / 2;
  const x = offset;
  const y = offset;
  const sw = w - offset * 2;
  const sh = h - offset * 2;
  const clamped = clampRadii(radii, w, h);
  const r = clamped.map((v) => Math.max(0, v - offset)) as Radii;
  const dash = node.strokeDashes?.length
    ? node.strokeDashes.join(' ')
    : undefined;

  return (
    <svg
      width={w}
      height={h}
      overflow="visible"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        overflow: 'visible',
        display: 'block',
      }}
    >
      <defs>
        {paints.map((p, i) =>
          p.type === 'GRADIENT_LINEAR' || p.type === 'GRADIENT_RADIAL' ? (
            <SvgGradientDef
              key={i}
              id={`${baseId}-${i}`}
              paint={p}
              w={w}
              h={h}
            />
          ) : null,
        )}
      </defs>
      {paints.map((p, i) => {
        const attr = strokePaintAttr(p, `${baseId}-${i}`);
        if (!attr) {
          return null;
        }
        const common = {
          fill: 'none',
          strokeWidth: weight,
          strokeDasharray: dash,
          ...attr,
        };
        return shape === 'ellipse' ? (
          <ellipse
            key={i}
            cx={w / 2}
            cy={h / 2}
            rx={sw / 2}
            ry={sh / 2}
            {...common}
          />
        ) : (
          <path key={i} d={roundedRectPath(x, y, sw, sh, r)} {...common} />
        );
      })}
    </svg>
  );
}
