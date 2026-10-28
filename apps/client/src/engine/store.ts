import { type Atom, atom, transact } from './state';
import type { TLPage, TLParentId, TLRecord, TLShape, TLShapeId } from './types';

// See apps/docs/skia-engine/tech.md §3.

export type ChangeSource = 'user' | 'remote';

export interface RecordsDiff<R extends TLRecord = TLRecord> {
  added: Record<string, R>;
  updated: Record<string, [from: R, to: R]>;
  removed: Record<string, R>;
}

export function emptyDiff<R extends TLRecord = TLRecord>(): RecordsDiff<R> {
  return { added: {}, updated: {}, removed: {} };
}

export function isDiffEmpty(diff: RecordsDiff): boolean {
  for (const _ in diff.added) {
    return false;
  }
  for (const _ in diff.updated) {
    return false;
  }
  for (const _ in diff.removed) {
    return false;
  }
  return true;
}

/** Folds `next` into `into` so `into` goes straight from the first state to the last. */
export function squashInto(into: RecordsDiff, next: RecordsDiff) {
  for (const [id, rec] of Object.entries(next.added)) {
    if (into.removed[id]) {
      const from = into.removed[id];
      delete into.removed[id];
      if (from !== rec) {
        into.updated[id] = [from, rec];
      }
    } else {
      into.added[id] = rec;
    }
  }
  for (const [id, [from, to]] of Object.entries(next.updated)) {
    if (into.added[id]) {
      into.added[id] = to;
    } else if (into.updated[id]) {
      into.updated[id] = [into.updated[id][0], to];
    } else {
      into.updated[id] = [from, to];
    }
  }
  for (const [id, rec] of Object.entries(next.removed)) {
    if (into.added[id]) {
      delete into.added[id];
    } else if (into.updated[id]) {
      into.removed[id] = into.updated[id][0];
      delete into.updated[id];
    } else {
      into.removed[id] = rec;
    }
  }
}

export function reverseDiff(diff: RecordsDiff): RecordsDiff {
  const out = emptyDiff();
  for (const [id, rec] of Object.entries(diff.added)) {
    out.removed[id] = rec;
  }
  for (const [id, [from, to]] of Object.entries(diff.updated)) {
    out.updated[id] = [to, from];
  }
  for (const [id, rec] of Object.entries(diff.removed)) {
    out.added[id] = rec;
  }
  return out;
}

type TypeName = TLRecord['typeName'];
type RecordOf<T extends TypeName> = Extract<TLRecord, { typeName: T }>;

type BeforeCreate<R> = (record: R, source: ChangeSource) => R;
type AfterCreate<R> = (record: R, source: ChangeSource) => void;
type BeforeChange<R> = (prev: R, next: R, source: ChangeSource) => R;
type AfterChange<R> = (prev: R, next: R, source: ChangeSource) => void;
type BeforeDelete<R> = (record: R, source: ChangeSource) => void | false;
type AfterDelete<R> = (record: R, source: ChangeSource) => void;

interface HandlerSet {
  beforeCreate: BeforeCreate<TLRecord>[];
  afterCreate: AfterCreate<TLRecord>[];
  beforeChange: BeforeChange<TLRecord>[];
  afterChange: AfterChange<TLRecord>[];
  beforeDelete: BeforeDelete<TLRecord>[];
  afterDelete: AfterDelete<TLRecord>[];
}

function remover<T>(list: T[], item: T): () => void {
  list.push(item);
  return () => {
    const i = list.indexOf(item);
    if (i >= 0) {
      list.splice(i, 1);
    }
  };
}

export class StoreSideEffects {
  private sets = new Map<TypeName, HandlerSet>();
  readonly operationComplete: ((source: ChangeSource) => void)[] = [];

  handlers(type: TypeName): HandlerSet {
    let set = this.sets.get(type);
    if (!set) {
      set = {
        beforeCreate: [],
        afterCreate: [],
        beforeChange: [],
        afterChange: [],
        beforeDelete: [],
        afterDelete: [],
      };
      this.sets.set(type, set);
    }
    return set;
  }

  registerBeforeCreateHandler<T extends TypeName>(
    type: T,
    fn: BeforeCreate<RecordOf<T>>,
  ) {
    return remover(
      this.handlers(type).beforeCreate,
      fn as unknown as BeforeCreate<TLRecord>,
    );
  }

  registerAfterCreateHandler<T extends TypeName>(
    type: T,
    fn: AfterCreate<RecordOf<T>>,
  ) {
    return remover(
      this.handlers(type).afterCreate,
      fn as unknown as AfterCreate<TLRecord>,
    );
  }

  registerBeforeChangeHandler<T extends TypeName>(
    type: T,
    fn: BeforeChange<RecordOf<T>>,
  ) {
    return remover(
      this.handlers(type).beforeChange,
      fn as unknown as BeforeChange<TLRecord>,
    );
  }

  registerAfterChangeHandler<T extends TypeName>(
    type: T,
    fn: AfterChange<RecordOf<T>>,
  ) {
    return remover(
      this.handlers(type).afterChange,
      fn as unknown as AfterChange<TLRecord>,
    );
  }

  registerBeforeDeleteHandler<T extends TypeName>(
    type: T,
    fn: BeforeDelete<RecordOf<T>>,
  ) {
    return remover(
      this.handlers(type).beforeDelete,
      fn as unknown as BeforeDelete<TLRecord>,
    );
  }

  registerAfterDeleteHandler<T extends TypeName>(
    type: T,
    fn: AfterDelete<RecordOf<T>>,
  ) {
    return remover(
      this.handlers(type).afterDelete,
      fn as unknown as AfterDelete<TLRecord>,
    );
  }

  registerOperationCompleteHandler(fn: (source: ChangeSource) => void) {
    return remover(this.operationComplete, fn);
  }
}

interface PendingEvent {
  before: TLRecord | undefined;
  after: TLRecord | undefined;
}

export interface StoreListenerEntry {
  changes: RecordsDiff;
  source: ChangeSource;
}

function shallowEqual(a: object, b: object): boolean {
  if (a === b) {
    return true;
  }
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) {
    return false;
  }
  for (const k of ka) {
    if (
      (a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]
    ) {
      return false;
    }
  }
  return true;
}

/** Keeps unchanged nested objects so cached work keyed on them stays valid. */
function preserve(prev: TLRecord, next: TLRecord): TLRecord {
  if (prev.typeName !== 'shape' || next.typeName !== 'shape') {
    return shallowEqual(prev, next) ? prev : next;
  }
  let out = next;
  if (next.props !== prev.props && shallowEqual(next.props, prev.props)) {
    out = { ...out, props: prev.props };
  }
  if (next.meta !== prev.meta && shallowEqual(next.meta, prev.meta)) {
    out = { ...out, meta: prev.meta };
  }
  return shallowEqual(prev, out) ? prev : out;
}

export class Store {
  readonly sideEffects = new StoreSideEffects();
  private records = new Map<string, TLRecord>();
  private atoms = new Map<string, Atom<TLRecord | undefined>>();
  private idSets = {
    shape: atom('store shape ids', new Set<TLShapeId>()),
    page: atom('store page ids', new Set<TLPage['id']>()),
  };
  private children = new Map<TLParentId, Set<TLShapeId>>();
  private childVersions = new Map<TLParentId, Atom<number>>();
  private sortedChildren = new Map<TLParentId, TLShapeId[]>();
  private listeners = new Set<(entry: StoreListenerEntry) => void>();
  private historyListeners = new Set<(diff: RecordsDiff) => void>();
  private depth = 0;
  private pending = new Map<string, PendingEvent>();
  private opDiff = emptyDiff();
  private source: ChangeSource = 'user';
  private flushing = false;
  private applyCount = 0;

  readonly query = {
    records: <T extends TypeName>(type: T) => ({
      get: (): RecordOf<T>[] => {
        const ids = this.idSets[type].get() as Set<string>;
        const out: RecordOf<T>[] = [];
        for (const id of ids) {
          const rec = this.get(id);
          if (rec) {
            out.push(rec as RecordOf<T>);
          }
        }
        return out;
      },
    }),
  };

  private atomFor(id: string): Atom<TLRecord | undefined> {
    let a = this.atoms.get(id);
    if (!a) {
      a = atom(`record ${id}`, this.records.get(id));
      this.atoms.set(id, a);
    }
    return a;
  }

  private childVersion(parentId: TLParentId): Atom<number> {
    let a = this.childVersions.get(parentId);
    if (!a) {
      a = atom(`children of ${parentId}`, 0);
      this.childVersions.set(parentId, a);
    }
    return a;
  }

  get<R extends TLRecord = TLRecord>(id: string): R | undefined {
    return this.atomFor(id).get() as R | undefined;
  }

  unsafeGetWithoutCapture<R extends TLRecord = TLRecord>(
    id: string,
  ): R | undefined {
    return this.records.get(id) as R | undefined;
  }

  has(id: string): boolean {
    return this.get(id) !== undefined;
  }

  allRecords(): TLRecord[] {
    return [...this.records.values()];
  }

  shapeIds(): Set<TLShapeId> {
    return this.idSets.shape.get();
  }

  pageIds(): Set<TLPage['id']> {
    return this.idSets.page.get();
  }

  /** Children of `parentId` sorted by index (reactive). */
  sortedChildIds(parentId: TLParentId): TLShapeId[] {
    this.childVersion(parentId).get();
    let sorted = this.sortedChildren.get(parentId);
    if (!sorted) {
      const set = this.children.get(parentId);
      sorted = set ? [...set] : [];
      const index = (id: TLShapeId) => (this.records.get(id) as TLShape).index;
      sorted.sort((a, b) => {
        const ia = index(a);
        const ib = index(b);
        return ia < ib ? -1 : ia > ib ? 1 : a < b ? -1 : 1;
      });
      this.sortedChildren.set(parentId, sorted);
    }
    return sorted;
  }

  listen(fn: (entry: StoreListenerEntry) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Every applied change, for the history manager. */
  onApply(fn: (diff: RecordsDiff) => void): () => void {
    this.historyListeners.add(fn);
    return () => this.historyListeners.delete(fn);
  }

  private touchChildren(parentId: TLParentId) {
    this.sortedChildren.delete(parentId);
    const a = this.childVersion(parentId);
    a.set(a.__unsafe__getWithoutCapture() + 1);
  }

  private addChild(rec: TLShape) {
    let set = this.children.get(rec.parentId);
    if (!set) {
      set = new Set();
      this.children.set(rec.parentId, set);
    }
    set.add(rec.id);
    this.touchChildren(rec.parentId);
  }

  private removeChild(rec: TLShape) {
    this.children.get(rec.parentId)?.delete(rec.id);
    this.touchChildren(rec.parentId);
  }

  private setIds(type: TypeName, fn: (set: Set<string>) => void) {
    const a = this.idSets[type] as Atom<Set<string>>;
    const next = new Set(a.__unsafe__getWithoutCapture());
    fn(next);
    a.set(next);
  }

  private apply(prev: TLRecord | undefined, next: TLRecord | undefined) {
    const id = (next ?? prev)!.id;
    this.applyCount++;
    const diff = emptyDiff();
    if (next) {
      this.records.set(id, next);
    } else {
      this.records.delete(id);
    }
    if (prev && next) {
      diff.updated[id] = [prev, next];
      if (prev.typeName === 'shape' && next.typeName === 'shape') {
        if (prev.parentId !== next.parentId) {
          this.removeChild(prev);
          this.addChild(next);
        } else if (prev.index !== next.index) {
          this.touchChildren(next.parentId);
        }
      }
    } else if (next) {
      diff.added[id] = next;
      this.setIds(next.typeName, (s) => s.add(id));
      if (next.typeName === 'shape') {
        this.addChild(next);
      }
    } else if (prev) {
      diff.removed[id] = prev;
      this.setIds(prev.typeName, (s) => s.delete(id));
      if (prev.typeName === 'shape') {
        this.removeChild(prev);
      }
    }
    this.atomFor(id).set(next);
    squashInto(this.opDiff, diff);
    for (const fn of this.historyListeners) {
      fn(diff);
    }
  }

  put(records: TLRecord[], source: ChangeSource = 'user') {
    this.atomic(() => {
      for (const incoming of records) {
        const prev = this.records.get(incoming.id);
        const handlers = this.sideEffects.handlers(incoming.typeName);
        if (prev) {
          let next = preserve(prev, incoming);
          for (const fn of handlers.beforeChange) {
            next = fn(prev, next, this.source);
          }
          next = preserve(prev, next);
          if (next === prev) {
            continue;
          }
          this.apply(prev, next);
          this.queue(prev, next);
        } else {
          let next = incoming;
          for (const fn of handlers.beforeCreate) {
            next = fn(next, this.source);
          }
          this.apply(undefined, next);
          this.queue(undefined, next);
        }
      }
    }, source);
  }

  remove(ids: string[], source: ChangeSource = 'user') {
    this.atomic(() => {
      for (const id of ids) {
        const rec = this.records.get(id);
        if (!rec) {
          continue;
        }
        const handlers = this.sideEffects.handlers(rec.typeName);
        if (
          handlers.beforeDelete.some((fn) => fn(rec, this.source) === false)
        ) {
          continue;
        }
        this.apply(rec, undefined);
        this.queue(rec, undefined);
      }
    }, source);
  }

  update<R extends TLRecord>(id: string, fn: (record: R) => R) {
    const rec = this.records.get(id) as R | undefined;
    if (rec) {
      this.put([fn(rec)]);
    }
  }

  applyDiff(diff: RecordsDiff, source: ChangeSource = 'user') {
    this.atomic(() => {
      const removed = Object.keys(diff.removed);
      if (removed.length) {
        this.remove(removed);
      }
      const puts = [
        ...Object.values(diff.added),
        ...Object.values(diff.updated).map(([, to]) => to),
      ];
      if (puts.length) {
        this.put(puts);
      }
    }, source);
  }

  atomic<T>(fn: () => T, source?: ChangeSource): T {
    return transact(() => {
      const prevSource = this.source;
      if (source && this.depth === 0) {
        this.source = source;
      }
      this.depth++;
      try {
        return fn();
      } finally {
        this.depth--;
        if (this.depth === 0) {
          try {
            this.flush();
          } finally {
            this.source = prevSource;
          }
        }
      }
    });
  }

  // See apps/docs/skia-engine/tech.md §3.
  private queue(before: TLRecord | undefined, after: TLRecord | undefined) {
    const id = (before ?? after)!.id;
    const existing = this.pending.get(id);
    if (existing) {
      existing.after = after;
    } else {
      this.pending.set(id, { before, after });
    }
  }

  private runPending() {
    while (this.pending.size) {
      const events = this.pending;
      this.pending = new Map();
      for (const { before, after } of events.values()) {
        if (before && after) {
          if (before === after) {
            continue;
          }
          for (const fn of this.sideEffects.handlers(after.typeName)
            .afterChange) {
            fn(before, after, this.source);
          }
        } else if (after) {
          for (const fn of this.sideEffects.handlers(after.typeName)
            .afterCreate) {
            fn(after, this.source);
          }
        } else if (before) {
          for (const fn of this.sideEffects.handlers(before.typeName)
            .afterDelete) {
            fn(before, this.source);
          }
        }
      }
    }
  }

  private flush() {
    if (this.flushing) {
      return;
    }
    this.flushing = true;
    this.depth++;
    try {
      for (let pass = 0; pass < 20; pass++) {
        this.runPending();
        const marker = this.applyCount;
        for (const fn of this.sideEffects.operationComplete) {
          fn(this.source);
        }
        if (!this.pending.size && marker === this.applyCount) {
          break;
        }
      }
    } finally {
      this.depth--;
      this.flushing = false;
    }
    const changes = this.opDiff;
    this.opDiff = emptyDiff();
    if (!isDiffEmpty(changes)) {
      const entry = { changes, source: this.source };
      for (const fn of this.listeners) {
        fn(entry);
      }
    }
  }
}

export function createTLStore(_opts?: unknown): Store {
  return new Store();
}
