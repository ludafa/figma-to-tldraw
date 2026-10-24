import type { CSSProperties } from 'react';

import { backgroundBlurCss, boxShadowCss, layerBlurCss } from '../effects';
import {
  borderRadiusCss,
  clampRadii,
  cornerRadii,
  type Radii,
} from '../geometry';
import { Fills, Strokes } from '../paint';
import type { FigmaShape } from '../shape-types';

// See apps/docs/figma-to-tldraw/tech.md §6.

export function BoxContent({ shape }: { shape: FigmaShape }) {
  const { w, h, node, images, imageSizes } = shape.props;
  if (node.isMask) {
    return null;
  }
  const isEllipse = node.type === 'ELLIPSE';
  const radii: Radii = isEllipse ? [0, 0, 0, 0] : cornerRadii(node);
  const radius = isEllipse ? '50%' : borderRadiusCss(clampRadii(radii, w, h));
  const effects = node.effects;
  const dropShadows = boxShadowCss(
    effects?.filter((e) => e.type === 'DROP_SHADOW'),
  );
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
      <div
        style={{
          ...layer,
          overflow: 'hidden',
          backdropFilter: backgroundBlurCss(effects),
        }}
      >
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
