import { describe, expect, it } from 'vitest';

import { HistoryManager } from './history';
import { type IndexKey } from './indices';
import { createTLStore, type StoreListenerEntry } from './store';
import type { TLPage, TLPageId, TLShape, TLShapeId } from './types';

const PAGE = 'page:p' as TLPageId;

function page(): TLPage {
  return {
    id: PAGE,
    typeName: 'page',
    name: 'Page',
    index: 'a1' as IndexKey,
    meta: {},
  };
}

function shape(id: string, index: string, extra: Partial<TLShape> = {}) {
  return {
    id: `shape:${id}` as TLShapeId,
    typeName: 'shape',
    type: 'box',
    x: 0,
    y: 0,
    rotation: 0,
    index: index as IndexKey,
    parentId: PAGE,
    isLocked: false,
    opacity: 1,
    props: { w: 10 },
    meta: {},
    ...extra,
  } as TLShape;
}

function setup() {
  const store = createTLStore();
  store.put([page(), shape('a', 'a1'), shape('b', 'a2'), shape('c', 'a0')]);
  return store;
}

describe('store', () => {
  it('keeps children sorted by index and updates on reorder', () => {
    const store = setup();
    expect(store.sortedChildIds(PAGE)).toEqual([
      'shape:c',
      'shape:a',
      'shape:b',
    ]);
    store.update<TLShape>('shape:c', (s) => ({
      ...s,
      index: 'a3' as IndexKey,
    }));
    expect(store.sortedChildIds(PAGE)).toEqual([
      'shape:a',
      'shape:b',
      'shape:c',
    ]);
  });

  it('moves a shape between parents', () => {
    const store = setup();
    store.update<TLShape>('shape:b', (s) => ({
      ...s,
      parentId: 'shape:a' as TLShapeId,
    }));
    expect(store.sortedChildIds(PAGE)).not.toContain('shape:b');
    expect(store.sortedChildIds('shape:a' as TLShapeId)).toEqual(['shape:b']);
  });

  it('keeps the old props object when the new one is shallow-equal', () => {
    const store = setup();
    const before = store.get<TLShape>('shape:a')!;
    store.put([{ ...before, props: { w: 10 } }]);
    expect(store.get<TLShape>('shape:a')).toBe(before);
  });

  it('reports one squashed diff per atomic operation', () => {
    const store = setup();
    const entries: StoreListenerEntry[] = [];
    store.listen((e) => entries.push(e));
    store.atomic(() => {
      store.update<TLShape>('shape:a', (s) => ({ ...s, x: 5 }));
      store.update<TLShape>('shape:a', (s) => ({ ...s, x: 7 }));
      store.remove(['shape:b']);
    });
    expect(entries).toHaveLength(1);
    const { updated, removed } = entries[0].changes;
    expect((updated['shape:a'][0] as TLShape).x).toBe(0);
    expect((updated['shape:a'][1] as TLShape).x).toBe(7);
    expect(Object.keys(removed)).toEqual(['shape:b']);
  });

  it('runs side-effect handlers and lets beforeDelete veto', () => {
    const store = setup();
    store.sideEffects.registerBeforeChangeHandler('shape', (_prev, next) => ({
      ...next,
      y: 99,
    }));
    store.sideEffects.registerBeforeDeleteHandler('shape', (rec) =>
      rec.id === 'shape:c' ? false : undefined,
    );
    store.update<TLShape>('shape:a', (s) => ({ ...s, x: 1 }));
    expect(store.get<TLShape>('shape:a')!.y).toBe(99);
    store.remove(['shape:c']);
    expect(store.has('shape:c')).toBe(true);
  });
});

describe('side-effect queue', () => {
  it('merges events per record id within one operation', () => {
    const store = setup();
    const seen: string[] = [];
    store.sideEffects.registerAfterCreateHandler('shape', (s) => {
      seen.push(`create ${s.id}`);
    });
    store.sideEffects.registerAfterChangeHandler('shape', (_p, s) => {
      seen.push(`change ${s.id}`);
    });
    store.sideEffects.registerAfterDeleteHandler('shape', (s) => {
      seen.push(`delete ${s.id}`);
    });
    store.atomic(() => {
      const a = store.get<TLShape>('shape:a')!;
      store.remove(['shape:a']);
      store.put([{ ...a, x: 4 }]);
      store.put([shape('d', 'a5')]);
      store.remove(['shape:d']);
    });
    expect(seen).toEqual(['change shape:a']);
  });
});

describe('history', () => {
  it('undoes and redoes back to marks', () => {
    const store = setup();
    const history = new HistoryManager(store);
    history.mark('m1');
    store.update<TLShape>('shape:a', (s) => ({ ...s, x: 5 }));
    history.mark('m2');
    store.update<TLShape>('shape:a', (s) => ({ ...s, x: 9 }));
    history.undo();
    expect(store.get<TLShape>('shape:a')!.x).toBe(5);
    history.undo();
    expect(store.get<TLShape>('shape:a')!.x).toBe(0);
    history.redo();
    history.redo();
    expect(store.get<TLShape>('shape:a')!.x).toBe(9);
  });

  it('bails to a mark without leaving a redo entry', () => {
    const store = setup();
    const history = new HistoryManager(store);
    const mark = history.mark();
    store.remove(['shape:a']);
    history.bailToMark(mark);
    expect(store.has('shape:a')).toBe(true);
    expect(history.canRedo()).toBe(false);
  });

  it('does nothing when bailing to a mark that is gone', () => {
    const store = setup();
    const history = new HistoryManager(store);
    history.mark('m1');
    store.update<TLShape>('shape:a', (s) => ({ ...s, x: 5 }));
    history.bailToMark('missing');
    expect(store.get<TLShape>('shape:a')!.x).toBe(5);
    history.undo();
    expect(store.get<TLShape>('shape:a')!.x).toBe(0);
  });

  it('ignores changes made in ignore mode', () => {
    const store = setup();
    const history = new HistoryManager(store);
    history.withMode('ignore', () =>
      store.update<TLShape>('shape:a', (s) => ({ ...s, x: 3 })),
    );
    expect(history.canUndo()).toBe(false);
  });

  it('a new change clears the redo stack', () => {
    const store = setup();
    const history = new HistoryManager(store);
    history.mark();
    store.update<TLShape>('shape:a', (s) => ({ ...s, x: 5 }));
    history.undo();
    expect(history.canRedo()).toBe(true);
    store.update<TLShape>('shape:b', (s) => ({ ...s, x: 1 }));
    expect(history.canRedo()).toBe(false);
  });
});
