import { describe, expect, it } from 'vitest';

import { constrain } from './constraints';

const box = { x: 10, y: 20, w: 30, h: 40 };
const from = { w: 100, h: 100 };
const to = { w: 200, h: 150 };

describe('constrain', () => {
  it('keeps left / top children where they are', () => {
    expect(constrain(box, undefined, from, to)).toEqual(box);
    expect(
      constrain(box, { horizontal: 'LEFT', vertical: 'TOP' }, from, to),
    ).toEqual(box);
  });

  it('moves right / bottom and centre children with the frame edges', () => {
    expect(
      constrain(box, { horizontal: 'RIGHT', vertical: 'BOTTOM' }, from, to),
    ).toEqual({ x: 110, y: 70, w: 30, h: 40 });
    expect(
      constrain(box, { horizontal: 'CENTER', vertical: 'CENTER' }, from, to),
    ).toEqual({ x: 60, y: 45, w: 30, h: 40 });
  });

  it('stretches and scales', () => {
    expect(
      constrain(
        box,
        { horizontal: 'LEFT_RIGHT', vertical: 'TOP_BOTTOM' },
        from,
        to,
      ),
    ).toEqual({ x: 10, y: 20, w: 130, h: 90 });
    expect(
      constrain(box, { horizontal: 'SCALE', vertical: 'SCALE' }, from, to),
    ).toEqual({ x: 20, y: 30, w: 60, h: 60 });
  });

  it('only moves rotated children', () => {
    expect(
      constrain(
        box,
        { horizontal: 'LEFT_RIGHT', vertical: 'SCALE' },
        from,
        to,
        true,
      ),
    ).toEqual({ x: 60, y: 40, w: 30, h: 40 });
  });

  it('never makes a negative size', () => {
    expect(
      constrain(box, { horizontal: 'LEFT_RIGHT', vertical: 'TOP' }, from, {
        w: 10,
        h: 100,
      }).w,
    ).toBe(0);
  });
});
