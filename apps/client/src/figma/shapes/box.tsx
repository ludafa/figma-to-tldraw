import type { CSSProperties } from 'react';

import { backgroundBlurCss, boxShadowCss, layerBlurCss } from '../effects';
import {
  borderRadiusCss,
  clampRadii,
  cornerRadii,
  ellipsePath,
  type Radii,
  rgba,
  roundedRectPath,
} from '../geometry';
import { translation } from '../matrix';
import { Fills, Strokes, useSvgId, visiblePaints } from '../paint';
import type { FigmaShape } from '../shape-types';
import type { FigmaEffect } from '../types';

// See apps/docs/figma-to-tldraw/tech.md §6.

function boxRadii(shape: FigmaShape): { radii: Radii; radius: string } {
  const { w, h, node } = shape.props;
  if (node.type === 'ELLIPSE') {
    return { radii: [0, 0, 0, 0], radius: '50%' };
  }
  const radii = cornerRadii(node);
  return { radii, radius: borderRadiusCss(clampRadii(radii, w, h)) };
}

// See apps/docs/figma-to-tldraw/tech.md §6.3.
export function BackdropBlur({
  shape,
  clipPath,
}: {
  shape: FigmaShape;
  clipPath: string | undefined;
}) {
  const filter = backgroundBlurCss(shape.props.node.effects);
  if (!filter || shape.props.node.isMask) {
    return null;
  }
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: boxRadii(shape).radius,
        backdropFilter: filter,
        clipPath,
      }}
    />
  );
}

// See apps/docs/figma-to-tldraw/tech.md §12.4.
function StrokeShadow({
  shape,
  shadows,
}: {
  shape: FigmaShape;
  shadows: FigmaEffect[];
}) {
  const id = useSvgId();
  const { w, h, node } = shape.props;
  const weight = node.strokeWeight ?? 0;
  const align = node.strokeAlign ?? 'INSIDE';
  const inset =
    align === 'INSIDE' ? weight / 2 : align === 'CENTER' ? 0 : -weight / 2;
  const isEllipse = node.type === 'ELLIPSE';
  const radii = clampRadii(cornerRadii(node), w, h);
  const ring = isEllipse
    ? ellipsePath(w - inset * 2, h - inset * 2, translation(inset, inset))
    : roundedRectPath(
        inset,
        inset,
        w - inset * 2,
        h - inset * 2,
        radii.map((r) => Math.max(0, r - inset)) as Radii,
      );
  const outline = isEllipse
    ? ellipsePath(w, h)
    : roundedRectPath(0, 0, w, h, radii);
  const pad =
    Math.max(
      ...shadows.map(
        (e) =>
          e.radius * 2 +
          Math.abs(e.offset?.x ?? 0) +
          Math.abs(e.offset?.y ?? 0) +
          (e.spread ?? 0),
      ),
    ) + weight;
  const area = { x: -pad, y: -pad, width: w + pad * 2, height: h + pad * 2 };
  const behind = shadows.some((e) => e.showShadowBehindNode);
  return (
    <svg
      width={w}
      height={h}
      overflow="visible"
      style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible' }}
    >
      <defs>
        {!behind && (
          <mask id={`${id}-m`} maskUnits="userSpaceOnUse" {...area}>
            <rect {...area} fill="#fff" />
            <path d={outline} fill="#000" />
          </mask>
        )}
        {shadows.map((e, i) => (
          <filter
            key={i}
            id={`${id}-f${i}`}
            filterUnits="userSpaceOnUse"
            {...area}
          >
            <feGaussianBlur stdDeviation={e.radius / 2} />
          </filter>
        ))}
      </defs>
      <g mask={behind ? undefined : `url(#${id}-m)`}>
        {[...shadows].reverse().map((e, i) => (
          <path
            key={i}
            d={ring}
            fill="none"
            stroke={e.color ? rgba(e.color) : 'rgba(0, 0, 0, 0.25)'}
            strokeWidth={weight + (e.spread ?? 0) * 2}
            transform={`translate(${e.offset?.x ?? 0} ${e.offset?.y ?? 0})`}
            filter={`url(#${id}-f${shadows.length - 1 - i})`}
          />
        ))}
      </g>
    </svg>
  );
}

export function BoxContent({ shape }: { shape: FigmaShape }) {
  const { w, h, node, images, imageSizes } = shape.props;
  if (node.isMask) {
    return null;
  }
  const isEllipse = node.type === 'ELLIPSE';
  const { radii, radius } = boxRadii(shape);
  const effects = node.effects;
  const shadows = (effects ?? []).filter(
    (e) => e.type === 'DROP_SHADOW' && e.visible !== false,
  );
  // See apps/docs/figma-to-tldraw/tech.md §12.4.
  const strokeOnly =
    shadows.length > 0 &&
    visiblePaints(node.fills).length === 0 &&
    visiblePaints(node.strokes).length > 0 &&
    (node.strokeWeight ?? 0) > 0 &&
    !node.individualStrokeWeights;
  const dropShadows = strokeOnly ? undefined : boxShadowCss(shadows);
  const innerShadows = boxShadowCss(
    effects?.filter((e) => e.type === 'INNER_SHADOW'),
  );
  const layer: CSSProperties = {
    position: 'absolute',
    inset: 0,
    borderRadius: radius,
  };

  return (
    <div
      style={{ position: 'absolute', inset: 0, filter: layerBlurCss(effects) }}
    >
      {dropShadows && <div style={{ ...layer, boxShadow: dropShadows }} />}
      {strokeOnly && <StrokeShadow shape={shape} shadows={shadows} />}
      <div style={{ ...layer, overflow: 'hidden' }}>
        <Fills paints={node.fills} ctx={{ w, h, images, imageSizes }} />
      </div>
      {innerShadows && <div style={{ ...layer, boxShadow: innerShadows }} />}
      <Strokes
        node={node}
        w={w}
        h={h}
        shape={isEllipse ? 'ellipse' : 'rect'}
        radii={radii}
      />
    </div>
  );
}
