import { describe, expect, it } from 'vitest';

import {
  fromHex,
  stepBase,
  stepSize,
  toHex,
  wheelAmount,
  wheelStepper,
} from './panel-fields';

const keys = { metaKey: false, shiftKey: false, altKey: false };

describe('stepSize', () => {
  it('is 1, Shift 10, Option 0.1 and Command 100', () => {
    expect(stepSize(keys)).toBe(1);
    expect(stepSize({ ...keys, shiftKey: true })).toBe(10);
    expect(stepSize({ ...keys, altKey: true })).toBe(0.1);
    expect(stepSize({ ...keys, metaKey: true })).toBe(100);
  });

  it('takes the bigger step when several keys are held', () => {
    expect(stepSize({ metaKey: true, shiftKey: true, altKey: true })).toBe(100);
    expect(stepSize({ ...keys, shiftKey: true, altKey: true })).toBe(10);
  });
});

describe('wheelAmount', () => {
  it('uses the larger of deltaY and deltaX', () => {
    expect(wheelAmount({ deltaX: 0, deltaY: -4, deltaMode: 0 })).toBe(-4);
    expect(wheelAmount({ deltaX: 6, deltaY: 1, deltaMode: 0 })).toBe(6);
  });

  it('turns lines and pages into pixels', () => {
    expect(wheelAmount({ deltaX: 0, deltaY: 1, deltaMode: 1 })).toBe(16);
    expect(wheelAmount({ deltaX: 0, deltaY: -1, deltaMode: 2 })).toBe(-400);
  });
});

describe('wheelStepper', () => {
  it('steps once the scroll adds up to 4px, up is plus', () => {
    const next = wheelStepper();
    expect(next(-2, 0)).toBe(0);
    expect(next(-2, 100)).toBe(1);
    expect(next(4, 200)).toBe(-1);
  });

  it('takes at most one step per event', () => {
    const next = wheelStepper();
    expect(next(-100, 0)).toBe(1);
    expect(next(-3, 100)).toBe(0);
  });

  it('ignores empty events and starts over when the direction flips', () => {
    const next = wheelStepper();
    expect(next(3, 0)).toBe(0);
    expect(next(0, 10)).toBe(0);
    expect(next(3, 20)).toBe(-1);
    expect(next(3, 100)).toBe(0);
    expect(next(-3, 110)).toBe(0);
    expect(next(-3, 120)).toBe(1);
  });

  it('drops what was left over after a pause', () => {
    const next = wheelStepper();
    expect(next(3.9, 0)).toBe(0);
    expect(next(0.2, 600)).toBe(0);
  });

  it('keeps steps at least 50ms apart', () => {
    const next = wheelStepper();
    expect(next(-4, 0)).toBe(1);
    expect(next(-4, 16)).toBe(0);
    expect(next(-4, 32)).toBe(0);
    expect(next(-4, 50)).toBe(1);
  });
});

describe('stepBase', () => {
  it('steps from what was typed, else from the shown value', () => {
    expect(stepBase('250', 100)).toBe(250);
    expect(stepBase(undefined, 100)).toBe(100);
  });

  it('does not step when the typed text is not a number', () => {
    expect(stepBase('20px', 100)).toBeUndefined();
    expect(stepBase('', 100)).toBeUndefined();
  });

  it('has nothing to step from when the value is mixed and nothing is typed', () => {
    expect(stepBase(undefined, undefined)).toBeUndefined();
  });
});

describe('fromHex', () => {
  it('reads six digits with or without #', () => {
    expect(toHex(fromHex('#1E90FF', 1))).toBe('#1e90ff');
    expect(toHex(fromHex(' 1e90ff ', 1))).toBe('#1e90ff');
  });

  it('expands short codes like Figma', () => {
    expect(toHex(fromHex('f80', 1))).toBe('#ff8800');
    expect(toHex(fromHex('a', 1))).toBe('#aaaaaa');
    expect(toHex(fromHex('12', 1))).toBe('#121212');
  });

  it('rejects other lengths and keeps the alpha', () => {
    expect(fromHex('1234', 1)).toBeUndefined();
    expect(fromHex('12345g', 1)).toBeUndefined();
    expect(fromHex('fff', 0.3)?.a).toBe(0.3);
  });
});
