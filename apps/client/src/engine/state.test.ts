import { describe, expect, it } from 'vitest';

import {
  atom,
  computed,
  react,
  transact,
  unsafe__withoutCapture,
} from './state';

describe('signals', () => {
  it('recomputes a computed only when a parent changed', () => {
    const a = atom('a', 1);
    let runs = 0;
    const double = computed('double', () => {
      runs++;
      return a.get() * 2;
    });
    expect(double.get()).toBe(2);
    expect(double.get()).toBe(2);
    expect(runs).toBe(1);
    a.set(3);
    expect(double.get()).toBe(6);
    expect(runs).toBe(2);
  });

  it('re-runs a reaction on change and stops after dispose', () => {
    const a = atom('a', 0);
    const seen: number[] = [];
    const stop = react('log', () => {
      seen.push(a.get());
    });
    a.set(1);
    a.set(2);
    stop();
    a.set(3);
    expect(seen).toEqual([0, 1, 2]);
  });

  it('batches reactions inside a transaction', () => {
    const a = atom('a', 0);
    const b = atom('b', 0);
    const seen: number[] = [];
    react('sum', () => {
      seen.push(a.get() + b.get());
    });
    transact(() => {
      a.set(1);
      b.set(2);
    });
    expect(seen).toEqual([0, 3]);
  });

  it('skips notifications when isEqual says nothing changed', () => {
    const a = atom('a', { x: 1 }, { isEqual: (p, n) => p.x === n.x });
    let runs = 0;
    react('watch', () => {
      a.get();
      runs++;
    });
    a.set({ x: 1 });
    expect(runs).toBe(1);
  });

  it('does not track reads inside unsafe__withoutCapture', () => {
    const a = atom('a', 0);
    let runs = 0;
    react('untracked', () => {
      unsafe__withoutCapture(() => a.get());
      runs++;
    });
    a.set(1);
    expect(runs).toBe(1);
  });
});
