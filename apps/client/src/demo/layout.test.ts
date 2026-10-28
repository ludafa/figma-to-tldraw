import { describe, expect, it } from 'vitest';

import { layoutWall, type WallBox, type WallInputGroup } from './layout';

const groups: WallInputGroup[] = [
  {
    key: 'fill',
    title: '填充',
    cases: Array.from({ length: 9 }, (_, i) => ({
      dir: `fill/case-${i}`,
      width: 400,
      height: 300,
    })),
  },
  {
    key: 'real/suite',
    title: '真实稿子',
    cases: [
      { dir: 'real/suite/long', width: 1920, height: 15320 },
      { dir: 'real/suite/desktop', width: 1440, height: 960 },
      { dir: 'real/suite/mobile', width: 375, height: 812 },
    ],
  },
  { key: 'empty', title: '空', cases: [] },
];

const overlaps = (a: WallBox, b: WallBox) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const inside = (a: WallBox, b: WallBox) =>
  a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

describe('layoutWall', () => {
  it('places every case once, at its own size, without overlaps', () => {
    const wall = layoutWall(groups);
    expect(wall.boards.map((b) => b.dir).sort()).toEqual(
      groups.flatMap((g) => g.cases.map((c) => c.dir)).sort(),
    );
    for (const b of wall.boards) {
      const c = groups.flatMap((g) => g.cases).find((x) => x.dir === b.dir)!;
      expect([b.w, b.h]).toEqual([c.width, c.height]);
    }
    for (const [i, a] of wall.boards.entries()) {
      for (const b of wall.boards.slice(i + 1)) {
        expect(overlaps(a, b), `${a.dir} / ${b.dir}`).toBe(false);
      }
    }
  });

  it('keeps each section around its boards and skips empty groups', () => {
    const wall = layoutWall(groups);
    expect(wall.sections.map((s) => s.key)).toEqual(['fill', 'real/suite']);
    for (const b of wall.boards) {
      const section = wall.sections.find((s) => b.dir.startsWith(`${s.key}/`))!;
      expect(inside(b, section)).toBe(true);
    }
    for (const s of wall.sections) {
      expect(s.y).toBeGreaterThanOrEqual(wall.titleBand);
      expect(inside(s, wall.bounds)).toBe(true);
    }
  });

  it('wraps small cases into rows instead of one long line', () => {
    const wall = layoutWall(groups);
    const fill = wall.boards.filter((b) => b.dir.startsWith('fill/'));
    expect(new Set(fill.map((b) => b.y)).size).toBeGreaterThan(1);
  });

  it('repeats the wall for copies with distinct id prefixes', () => {
    const one = layoutWall(groups);
    const three = layoutWall(groups, 3);
    expect(three.boards).toHaveLength(one.boards.length * 3);
    expect(new Set(three.boards.map((b) => b.idPrefix)).size).toBe(
      three.boards.length,
    );
    expect(
      three.boards.filter((b) => b.copy === 0).map((b) => b.idPrefix),
    ).toEqual(one.boards.map((b) => b.dir));
    for (const [i, a] of three.boards.entries()) {
      expect(inside(a, three.bounds)).toBe(true);
      for (const b of three.boards.slice(i + 1)) {
        expect(overlaps(a, b)).toBe(false);
      }
    }
  });
});
