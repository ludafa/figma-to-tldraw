import { describe, expect, it } from 'vitest';

import {
  copyId,
  emptyStats,
  rebuildInstance,
  templateIdOf,
} from './components';
import type { FigmaNode } from './types';

function box(x: number, y: number, width = 10, height = 10) {
  return { x, y, width, height };
}

const red = [{ type: 'SOLID' as const, color: { r: 1, g: 0, b: 0, a: 1 } }];
const blue = [{ type: 'SOLID' as const, color: { r: 0, g: 0, b: 1, a: 1 } }];

const icon: FigmaNode = {
  id: '5:1',
  name: 'Icon',
  type: 'COMPONENT',
  absoluteBoundingBox: box(500, 0),
  children: [
    {
      id: '5:2',
      name: 'Shape',
      type: 'RECTANGLE',
      fills: red,
      absoluteBoundingBox: box(500, 0),
    },
  ],
};

const star: FigmaNode = {
  ...icon,
  id: '6:1',
  name: 'Star',
  children: [{ ...icon.children![0], id: '6:2', name: 'Star shape' }],
};

const button: FigmaNode = {
  id: '1:1',
  name: 'Button',
  type: 'COMPONENT',
  absoluteBoundingBox: box(0, 0, 100, 40),
  children: [
    {
      id: '1:2',
      name: 'Label',
      type: 'TEXT',
      characters: 'Buy',
      fills: red,
      absoluteBoundingBox: box(10, 10, 50, 20),
    },
    {
      id: 'I1:3',
      name: 'Icon',
      type: 'INSTANCE',
      componentId: '5:1',
      absoluteBoundingBox: box(70, 10),
      children: [
        {
          id: 'I1:3;5:2',
          name: 'Shape',
          type: 'RECTANGLE',
          fills: red,
          absoluteBoundingBox: box(70, 10),
        },
      ],
    },
  ],
};

const mains = new Map([
  ['1:1', button],
  ['5:1', icon],
  ['6:1', star],
]);

function instance(children: FigmaNode[], extra: Partial<FigmaNode> = {}) {
  return {
    id: '9:1',
    name: 'Button',
    type: 'INSTANCE',
    componentId: '1:1',
    absoluteBoundingBox: box(200, 0, 100, 40),
    children,
    ...extra,
  } as FigmaNode;
}

const label = (extra: Partial<FigmaNode> = {}): FigmaNode => ({
  ...button.children![0],
  id: 'I9:1;1:2',
  absoluteBoundingBox: box(210, 10, 50, 20),
  ...extra,
});

const iconCopy = (extra: Partial<FigmaNode> = {}, shape = {}): FigmaNode => ({
  ...button.children![1],
  id: 'I9:1;1:3',
  absoluteBoundingBox: box(270, 10),
  children: [
    {
      id: 'I9:1;1:3;5:2',
      name: 'Shape',
      type: 'RECTANGLE',
      fills: red,
      absoluteBoundingBox: box(270, 10),
      ...shape,
    },
  ],
  ...extra,
});

describe('copy ids', () => {
  it('joins the instance and the main layer', () => {
    expect(copyId('9:1', '1:2')).toBe('I9:1;1:2');
    expect(copyId('9:1', 'I1:3;5:2')).toBe('I9:1;1:3;5:2');
    expect(copyId('I9:1;1:3', '5:2')).toBe('I9:1;1:3;5:2');
  });

  it('finds the main layer again', () => {
    expect(templateIdOf('9:1', 'I9:1;1:2')).toBe('1:2');
    expect(templateIdOf('9:1', 'I9:1;1:3;5:2')).toBe('I1:3;5:2');
    expect(templateIdOf('9:1', 'I8:1;1:2')).toBeUndefined();
  });
});

describe('rebuildInstance', () => {
  it('takes untouched fields from the main', () => {
    const stats = emptyStats();
    const out = rebuildInstance(instance([label(), iconCopy()]), mains, stats);
    expect(out.children?.map((c) => c.id)).toEqual(['I9:1;1:2', 'I9:1;1:3']);
    expect(stats.inferred).toBe(0);
    expect(stats.fromMain).toBeGreaterThan(0);
    expect(out.overrides).toEqual([]);
  });

  it('keeps recorded overrides and the copy’s placement', () => {
    const stats = emptyStats();
    const out = rebuildInstance(
      instance([label({ characters: 'Sell' }), iconCopy()], {
        overrides: [{ id: 'I9:1;1:2', overriddenFields: ['characters'] }],
      }),
      mains,
      stats,
    );
    const text = out.children![0];
    expect(text.characters).toBe('Sell');
    expect(text.absoluteBoundingBox).toEqual(box(210, 10, 50, 20));
    expect(stats.fromOverrides).toBeGreaterThan(0);
    expect(stats.inferred).toBe(0);
  });

  it('adds unexplained differences to the override list', () => {
    const stats = emptyStats();
    const out = rebuildInstance(
      instance([label({ fills: blue }), iconCopy()]),
      mains,
      stats,
    );
    expect(out.children![0].fills).toEqual(blue);
    expect(stats.inferredFields).toEqual({ fills: 1 });
    expect(out.overrides).toEqual([
      { id: 'I9:1;1:2', overriddenFields: ['fills'] },
    ]);
  });

  it('rebuilds a swapped nested instance from its own main', () => {
    const stats = emptyStats();
    const swapped = iconCopy(
      { componentId: '6:1', name: 'Star' },
      { id: 'I9:1;1:3;6:2', name: 'Star shape' },
    );
    const out = rebuildInstance(instance([label(), swapped]), mains, stats);
    expect(stats.swapped).toBe(1);
    expect(stats.inferred).toBe(0);
    expect(out.children![1].children![0].id).toBe('I9:1;1:3;6:2');
  });

  it('fills in the layers of a hidden nested instance', () => {
    const stats = emptyStats();
    const hidden = { ...iconCopy({ visible: false }), children: [] };
    const out = rebuildInstance(instance([label(), hidden]), mains, stats);
    expect(stats.missing).toBe(0);
    expect(stats.filled).toBe(1);
    const shape = out.children![1].children![0];
    expect(shape.id).toBe('I9:1;1:3;5:2');
    expect(shape.absoluteBoundingBox).toEqual(box(270, 10));
  });

  it('leaves an instance of a deleted main as it is', () => {
    const stats = emptyStats();
    const shell = new Map([['1:1', { ...button, children: [] }]]);
    const inst = instance([label({ fills: blue })]);
    const out = rebuildInstance(inst, shell, stats);
    expect(stats.unlinked).toBe(1);
    expect(out.children![0].fills).toEqual(blue);
  });
});
