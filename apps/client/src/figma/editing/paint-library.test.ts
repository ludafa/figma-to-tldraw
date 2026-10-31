import { describe, expect, it } from 'vitest';

import type { FigmaPaint, FigmaVariable } from '../types';
import type { FigmaVariableSet } from '../variables';
import { bindColor, colorVariables, scopeAllows } from './paint-library';

const color = (
  id: string,
  name: string,
  values: FigmaVariable['valuesByMode'],
  scopes?: string[],
  collection = 'C:theme',
): FigmaVariable => ({
  id,
  name,
  variableCollectionId: collection,
  resolvedType: 'COLOR',
  valuesByMode: values,
  scopes,
});

const set: FigmaVariableSet = {
  collections: {
    'C:theme': {
      id: 'C:theme',
      name: 'Theme',
      modes: [
        { modeId: 'light', name: 'Light' },
        { modeId: 'dark', name: 'Dark' },
      ],
      defaultModeId: 'light',
    },
    'C:palette': {
      id: 'C:palette',
      name: 'Palette',
      modes: [{ modeId: 'v', name: 'Value' }],
      defaultModeId: 'v',
      remote: true,
    },
  },
  variables: {
    blue: color(
      'blue',
      'blue/500',
      { v: { r: 0, g: 0, b: 1, a: 1 } },
      undefined,
      'C:palette',
    ),
    bg: color('bg', 'surface/bg', {
      light: { r: 1, g: 1, b: 1 },
      dark: { type: 'VARIABLE_ALIAS', id: 'blue' },
    }),
    stroke: color('stroke', 'line', { light: { r: 0, g: 0, b: 0, a: 0.2 } }, [
      'STROKE_COLOR',
    ]),
    hidden: color('hidden', 'unused', { light: { r: 1, g: 0, b: 0 } }, []),
    pad: {
      id: 'pad',
      name: 'pad',
      variableCollectionId: 'C:theme',
      resolvedType: 'FLOAT',
      valuesByMode: { light: 8 },
    },
  },
};

const names = (groups: ReturnType<typeof colorVariables>) =>
  groups.map((g) => [
    g.collection?.name,
    g.entries.map((e) => e.variable.name),
  ]);

describe('scopeAllows', () => {
  it('follows Figma scopes for fills and strokes', () => {
    expect(scopeAllows(undefined, 'fill', 'RECTANGLE')).toBe(true);
    expect(scopeAllows(['ALL_SCOPES'], 'stroke', 'TEXT')).toBe(true);
    expect(scopeAllows([], 'fill', 'RECTANGLE')).toBe(false);
    expect(scopeAllows(['ALL_FILLS'], 'fill', 'TEXT')).toBe(true);
    expect(scopeAllows(['ALL_FILLS'], 'stroke', 'TEXT')).toBe(false);
    expect(scopeAllows(['FRAME_FILL'], 'fill', 'INSTANCE')).toBe(true);
    expect(scopeAllows(['FRAME_FILL'], 'fill', 'RECTANGLE')).toBe(false);
    expect(scopeAllows(['SHAPE_FILL'], 'fill', 'ELLIPSE')).toBe(true);
    expect(scopeAllows(['TEXT_FILL'], 'fill', 'TEXT')).toBe(true);
    expect(scopeAllows(['STROKE_COLOR'], 'stroke', 'FRAME')).toBe(true);
  });
});

describe('colorVariables', () => {
  it('lists usable color variables by collection with values for the modes', () => {
    const fill = colorVariables(
      set,
      {},
      { query: '', target: 'fill', nodeType: 'RECTANGLE' },
    );
    expect(names(fill)).toEqual([
      ['Palette', ['blue/500']],
      ['Theme', ['surface/bg']],
    ]);
    expect(fill[1].entries[0].color).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    const dark = colorVariables(
      set,
      { 'C:theme': 'dark' },
      { query: '', target: 'fill', nodeType: 'RECTANGLE' },
    );
    expect(dark[1].entries[0].color).toEqual({ r: 0, g: 0, b: 1, a: 1 });
    const stroke = colorVariables(
      set,
      {},
      { query: '', target: 'stroke', nodeType: 'RECTANGLE' },
    );
    expect(names(stroke)).toEqual([
      ['Palette', ['blue/500']],
      ['Theme', ['surface/bg', 'line']],
    ]);
  });

  it('searches names and collection names', () => {
    const search = (query: string) =>
      names(
        colorVariables(
          set,
          {},
          { query, target: 'fill', nodeType: 'RECTANGLE' },
        ),
      );
    expect(search(' BG ')).toEqual([['Theme', ['surface/bg']]]);
    expect(search('palette')).toEqual([['Palette', ['blue/500']]]);
    expect(search('nothing')).toEqual([]);
  });
});

describe('bindColor', () => {
  it('binds a solid paint and turns other paints into one', () => {
    const solid: FigmaPaint = {
      type: 'SOLID',
      opacity: 0.5,
      color: { r: 1, g: 0, b: 0, a: 1 },
    };
    const blue = { r: 0, g: 0, b: 1, a: 1 };
    expect(bindColor(solid, 'blue', blue)).toEqual({
      type: 'SOLID',
      opacity: 0.5,
      color: blue,
      boundVariables: { color: { type: 'VARIABLE_ALIAS', id: 'blue' } },
    });
    const gradient: FigmaPaint = {
      type: 'GRADIENT_LINEAR',
      blendMode: 'MULTIPLY',
      gradientStops: [{ position: 0, color: blue }],
    };
    const bound = bindColor(gradient, 'bg', blue);
    expect(bound.type).toBe('SOLID');
    expect(bound.blendMode).toBe('MULTIPLY');
    expect(bound.gradientStops).toBeUndefined();
    expect(bound.boundVariables?.color?.id).toBe('bg');
  });
});
