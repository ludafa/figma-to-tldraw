import { describe, expect, it } from 'vitest';

import { parseColor, parseTransform, parseXml } from './svg';

describe('parseXml', () => {
  it('builds the element tree and decodes entities', () => {
    const root = parseXml(
      '<?xml version="1.0"?><!-- c --><svg width="10"><g id="a"><path d="M0 0" fill="#F59E0B"/></g><text>a &amp; b</text></svg>',
    );
    expect(root?.tag).toBe('svg');
    expect(root?.attrs.width).toBe('10');
    expect(root?.children.map((c) => c.tag)).toEqual(['g', 'text']);
    expect(root?.children[0].children[0].attrs.fill).toBe('#F59E0B');
  });

  it('decodes entities inside attributes', () => {
    const root = parseXml('<svg><a title="x &lt; y &#x41;"/></svg>');
    expect(root?.children[0].attrs.title).toBe('x < y A');
  });
});

describe('parseColor', () => {
  it('reads hex, rgb() and named colours', () => {
    expect(parseColor('#fff')).toEqual([1, 1, 1, 1]);
    expect(parseColor('#00000080')?.[3]).toBeCloseTo(128 / 255);
    expect(parseColor('rgba(255, 0, 0, 0.5)')).toEqual([1, 0, 0, 0.5]);
    expect(parseColor('black')).toEqual([0, 0, 0, 1]);
  });

  it('treats none and url() as no colour, transparent as clear', () => {
    expect(parseColor('none')).toBeUndefined();
    expect(parseColor('url(#paint0)')).toBeUndefined();
    expect(parseColor('transparent')).toEqual([0, 0, 0, 0]);
  });
});

describe('parseTransform', () => {
  it('composes transforms left to right', () => {
    const m = parseTransform('translate(10 20) scale(2)');
    expect(m).toEqual([2, 0, 10, 0, 2, 20, 0, 0, 1]);
  });

  it('reads matrix() in SVG order', () => {
    expect(parseTransform('matrix(1 2 3 4 5 6)')).toEqual([
      1, 3, 5, 2, 4, 6, 0, 0, 1,
    ]);
  });
});
