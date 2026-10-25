import { describe, expect, it } from 'vitest';

import type { FigmaNode } from '../types';
import {
  setFills,
  setLayoutMode,
  setLineHeight,
  setRadius,
  setTextStyle,
} from './panel-ops';

const red = { type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } } as const;

function text(extra: Partial<FigmaNode> = {}): FigmaNode {
  return {
    id: '1:1',
    name: 't',
    type: 'TEXT',
    characters: 'ab',
    style: {
      fontFamily: 'Inter',
      fontSize: 10,
      lineHeightPx: 12.102,
      lineHeightUnit: 'INTRINSIC_%',
    },
    characterStyleOverrides: [0, 1],
    styleOverrideTable: {
      '1': { fontSize: 20, fontWeight: 700, lineHeightPx: 30 },
    },
    ...extra,
  };
}

describe('panel operations', () => {
  it('makes a font size uniform and scales a relative line height', () => {
    const out = setTextStyle(text(), { fontSize: 20 });
    expect(out.style?.fontSize).toBe(20);
    expect(out.style?.lineHeightPx).toBeCloseTo(24.204);
    expect(out.styleOverrideTable).toEqual({ '1': { fontWeight: 700 } });
  });

  it('keeps a pixel line height when the font size changes', () => {
    const node = setLineHeight(text(), 18);
    const out = setTextStyle(node, { fontSize: 14 });
    expect(out.style?.lineHeightPx).toBe(18);
    expect(out.style?.lineHeightUnit).toBe('PIXELS');
  });

  it('sets auto line height from the font', () => {
    const out = setLineHeight(text(), 'auto');
    expect(out.style?.lineHeightUnit).toBe('INTRINSIC_%');
    expect(out.style?.lineHeightPx).toBeCloseTo(12.102);
  });

  it('gives a text layer one fill', () => {
    const node = text({
      fills: [],
      style: { fills: [] },
      styleOverrideTable: { '1': { fills: [], fontWeight: 700 } },
    });
    const out = setFills(node, [red]);
    expect(out.fills).toEqual([red]);
    expect(out.style?.fills).toEqual([red]);
    expect(out.styleOverrideTable).toEqual({ '1': { fontWeight: 700 } });
  });

  it('replaces per-corner radii with one radius', () => {
    const out = setRadius(
      {
        id: '1',
        name: 'r',
        type: 'RECTANGLE',
        rectangleCornerRadii: [1, 2, 3, 4],
      },
      8,
    );
    expect(out.cornerRadius).toBe(8);
    expect('rectangleCornerRadii' in out).toBe(false);
  });

  it('turns auto layout on with fixed size and off without hugging', () => {
    const frame: FigmaNode = { id: '1', name: 'f', type: 'FRAME' };
    const on = setLayoutMode(frame, 'VERTICAL');
    expect(on).toMatchObject({
      layoutMode: 'VERTICAL',
      itemSpacing: 10,
      layoutSizingHorizontal: 'FIXED',
      layoutSizingVertical: 'FIXED',
    });
    const off = setLayoutMode({ ...on, layoutSizingVertical: 'HUG' }, 'NONE');
    expect(off.layoutMode).toBe('NONE');
    expect(off.layoutSizingVertical).toBe('FIXED');
  });
});
