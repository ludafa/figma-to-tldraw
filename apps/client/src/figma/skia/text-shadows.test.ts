import { describe, expect, it } from 'vitest';

import type { FigmaEffect, FigmaNode } from '../types';
import { withTextShadows } from './text';

const node = (effects: FigmaEffect[]) =>
  ({ id: '1:1', name: 'text', type: 'TEXT', effects }) as FigmaNode;

const shadow = (x: number, y: number, radius: number): FigmaEffect => ({
  type: 'DROP_SHADOW',
  visible: true,
  radius,
  offset: { x, y },
  color: { r: 0, g: 0, b: 0, a: 0.5 },
});

describe('withTextShadows', () => {
  const box = { l: 0, t: 0, r: 100, b: 20 };

  it('grows the box by the offset and three blur sigmas', () => {
    expect(withTextShadows(node([shadow(4, 6, 8)]), box)).toEqual({
      l: -8,
      t: -6,
      r: 116,
      b: 38,
    });
  });

  it('ignores hidden shadows and other effects', () => {
    const hidden = { ...shadow(50, 50, 10), visible: false };
    const blur: FigmaEffect = { type: 'LAYER_BLUR', visible: true, radius: 9 };
    expect(withTextShadows(node([hidden, blur]), box)).toEqual(box);
  });
});
