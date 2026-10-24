import { describe, expect, it } from 'vitest';

import { gradientImageCss } from './paint';
import type { FigmaPaint } from './types';

const stops = [
  { position: 0, color: { r: 0, g: 0, b: 1, a: 1 } },
  { position: 1, color: { r: 1, g: 0, b: 0, a: 1 } },
];

describe('gradientImageCss', () => {
  it('maps a linear gradient onto the node box as an SVG image', () => {
    const paint: FigmaPaint = {
      type: 'GRADIENT_LINEAR',
      gradientStops: stops,
      gradientHandlePositions: [
        { x: 0, y: 0.5 },
        { x: 0.5, y: 0.5 },
        { x: 0, y: 1 },
      ],
    };
    const css = gradientImageCss(paint, 200, 100);
    const svg = decodeURIComponent(css!.slice(css!.indexOf(',') + 1, -2));
    expect(svg).toContain('width="200" height="100"');
    expect(svg).toContain('<linearGradient');
    expect(svg).toContain('gradientTransform="matrix(100 0 0 50 0 50)"');
    expect(svg).toContain('stop-color="rgba(0, 0, 255, 1)"');
  });

  it('skips gradients it cannot draw as an image', () => {
    const paint: FigmaPaint = {
      type: 'GRADIENT_ANGULAR',
      gradientStops: stops,
    };
    expect(gradientImageCss(paint, 200, 100)).toBeUndefined();
  });
});
