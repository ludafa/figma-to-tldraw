/// <reference types="node" />

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { apply, invert, multiply, translation } from '../matrix';
import type { CaseIndex, FigmaNode, Matrix2x3, Snapshot } from '../types';
import {
  type Box,
  layoutFrame,
  type LayoutHost,
  relayout,
} from './auto-layout';

function child(
  id: string,
  w: number,
  h: number,
  extra: Partial<FigmaNode> = {},
) {
  return {
    id,
    node: { id, name: id, type: 'FRAME', ...extra } as FigmaNode,
    box: { x: 0, y: 0, w, h },
  };
}

function row(extra: Partial<FigmaNode> = {}): FigmaNode {
  return {
    id: 'f',
    name: 'f',
    type: 'FRAME',
    layoutMode: 'HORIZONTAL',
    paddingLeft: 10,
    paddingRight: 10,
    paddingTop: 5,
    paddingBottom: 5,
    itemSpacing: 8,
    ...extra,
  };
}

describe('layoutFrame', () => {
  it('hugs its children on both axes', () => {
    const r = layoutFrame(
      row(),
      { w: 0, h: 0 },
      [child('a', 20, 10), child('b', 30, 16)],
      undefined,
    )!;
    expect([r.w, r.h]).toEqual([10 + 20 + 8 + 30 + 10, 5 + 16 + 5]);
    expect(r.boxes.get('a')).toEqual({ x: 10, y: 5, w: 20, h: 10 });
    expect(r.boxes.get('b')).toEqual({ x: 38, y: 5, w: 30, h: 16 });
  });

  it('shares the free space between fill children and stretches across', () => {
    const frame = row({
      primaryAxisSizingMode: 'FIXED',
      counterAxisSizingMode: 'FIXED',
    });
    const r = layoutFrame(
      frame,
      { w: 200, h: 40 },
      [
        child('a', 20, 10),
        child('b', 1, 10, { layoutGrow: 1 }),
        child('c', 1, 10, { layoutGrow: 1, layoutAlign: 'STRETCH' }),
      ],
      undefined,
    )!;
    // 200 - 20 padding - 20 fixed - 16 gaps = 144, split in two.
    expect(r.boxes.get('b')).toEqual({ x: 38, y: 5, w: 72, h: 10 });
    expect(r.boxes.get('c')).toEqual({ x: 118, y: 5, w: 72, h: 30 });
  });

  it('centres, right-aligns and spreads children', () => {
    const fixed = { primaryAxisSizingMode: 'FIXED' as const };
    const kids = [child('a', 20, 10), child('b', 20, 20)];
    const centred = layoutFrame(
      row({
        ...fixed,
        primaryAxisAlignItems: 'CENTER',
        counterAxisAlignItems: 'CENTER',
      }),
      { w: 100, h: 0 },
      kids,
      undefined,
    )!;
    expect(centred.boxes.get('a')).toEqual({ x: 26, y: 10, w: 20, h: 10 });
    const spread = layoutFrame(
      row({ ...fixed, primaryAxisAlignItems: 'SPACE_BETWEEN' }),
      { w: 100, h: 0 },
      kids,
      undefined,
    )!;
    expect(spread.boxes.get('b')?.x).toBe(70);
    const single = layoutFrame(
      row({ ...fixed, primaryAxisAlignItems: 'SPACE_BETWEEN' }),
      { w: 100, h: 0 },
      [kids[0]],
      undefined,
    )!;
    expect(single.boxes.get('a')?.x).toBe(10);
  });

  it('leaves absolute children alone and lets the parent decide filled axes', () => {
    const r = layoutFrame(
      row({ layoutAlign: 'STRETCH' }),
      { w: 300, h: 50 },
      [
        child('a', 20, 10),
        child('abs', 99, 99, { layoutPositioning: 'ABSOLUTE' }),
      ],
      { ...row(), layoutMode: 'VERTICAL' },
    )!;
    expect(r.boxes.has('abs')).toBe(false);
    expect([r.w, r.h]).toEqual([300, 20]);
  });
});

// See apps/docs/figma-to-tldraw/verification.md §1.

function rectBounds(m: Matrix2x3, w: number, h: number): Box {
  const pts = [apply(m, 0, 0), apply(m, w, 0), apply(m, 0, h), apply(m, w, h)];
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/** A Figma node tree with mutable boxes, so the test can re-run every frame. */
class SnapshotHost implements LayoutHost<string> {
  nodes = new Map<string, FigmaNode>();
  parents = new Map<string, string>();
  kids = new Map<string, string[]>();
  local = new Map<string, Matrix2x3>();
  sizes = new Map<string, { w: number; h: number }>();
  depth = new Map<string, number>();

  constructor(snapshot: Snapshot) {
    const transforms = snapshot.transforms ?? {};
    const visit = (n: FigmaNode, parent: FigmaNode | undefined, d: number) => {
      this.nodes.set(n.id, n);
      this.depth.set(n.id, d);
      const t = transforms[n.id];
      const pt = parent && transforms[parent.id];
      if (t && pt) {
        this.local.set(n.id, multiply(invert(pt.m), t.m));
        this.sizes.set(n.id, { w: t.w, h: t.h });
      } else {
        const bb = n.absoluteBoundingBox;
        const pb = parent?.absoluteBoundingBox;
        this.local.set(
          n.id,
          translation((bb?.x ?? 0) - (pb?.x ?? 0), (bb?.y ?? 0) - (pb?.y ?? 0)),
        );
        this.sizes.set(n.id, {
          w: t?.w ?? bb?.width ?? 0,
          h: t?.h ?? bb?.height ?? 0,
        });
      }
      const kids = (n.children ?? []).filter((c) => c.visible !== false);
      this.kids.set(
        n.id,
        kids.map((c) => c.id),
      );
      for (const c of kids) {
        this.parents.set(c.id, n.id);
        visit(c, n, d + 1);
      }
    };
    visit(snapshot.rest.document, undefined, 0);
  }

  node(id: string) {
    return this.nodes.get(id)!;
  }
  parent(id: string) {
    return this.parents.get(id);
  }
  children(id: string) {
    return this.kids.get(id) ?? [];
  }
  size(id: string) {
    return this.sizes.get(id)!;
  }
  setSize(id: string, w: number, h: number) {
    this.sizes.set(id, { w, h });
  }
  box(id: string) {
    const { w, h } = this.size(id);
    return rectBounds(this.local.get(id)!, w, h);
  }
  rigid(id: string) {
    const m = this.local.get(id)!;
    return Math.abs(m[0][1]) > 1e-9 || Math.abs(m[1][0]) > 1e-9;
  }
  setBox(id: string, box: Box) {
    const m = this.local.get(id)!;
    if (!this.rigid(id)) {
      this.setSize(id, box.w, box.h);
    }
    const now = this.box(id);
    this.local.set(id, [
      [m[0][0], m[0][1], m[0][2] + box.x - now.x],
      [m[1][0], m[1][1], m[1][2] + box.y - now.y],
    ]);
  }
}

const CASES = path.resolve(__dirname, '../../../../../cases');

describe.skipIf(!existsSync(path.join(CASES, 'index.json')))(
  'whole-tree relayout of the exported cases',
  () => {
    it('puts (almost) every layer back where Figma had it', () => {
      const index = JSON.parse(
        readFileSync(path.join(CASES, 'index.json'), 'utf8'),
      ) as CaseIndex;
      let layers = 0;
      const moved: string[] = [];
      for (const c of index.cases) {
        const snapshot = JSON.parse(
          readFileSync(path.join(CASES, c.dir, 'snapshot.json'), 'utf8'),
        ) as Snapshot;
        const host = new SnapshotHost(snapshot);
        const before = new Map(
          [...host.nodes.keys()].map((id) => [id, host.box(id)]),
        );
        const frames = [...host.nodes.keys()].sort(
          (a, b) => host.depth.get(b)! - host.depth.get(a)!,
        );
        for (let pass = 0; pass < 10; pass++) {
          let changed = false;
          for (const id of frames) {
            changed = relayout(host, id) || changed;
          }
          if (!changed) {
            break;
          }
        }
        for (const [id, b] of before) {
          layers++;
          const a = host.box(id);
          const d = Math.max(
            Math.abs(a.x - b.x),
            Math.abs(a.y - b.y),
            Math.abs(a.w - b.w),
            Math.abs(a.h - b.h),
          );
          if (d > 0.01) {
            moved.push(
              `${c.dir} ${host.node(id).name} (${id}) ${d.toFixed(2)}`,
            );
          }
        }
      }
      console.log(
        `relayout: ${layers - moved.length} / ${layers} layers unchanged`,
      );
      if (process.env.SHOW_MOVED) {
        console.log(moved.join('\n'));
      }
      // See apps/docs/figma-to-tldraw/verification.md §1.
      expect(moved.length).toBeLessThanOrEqual(24);
    });
  },
);
