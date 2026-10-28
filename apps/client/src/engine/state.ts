// See apps/docs/skia-engine/tech.md §2.

interface Parent {
  lastChangedEpoch: number;
  children: Set<Child>;
  /** Brings a computed up to date; atoms are always current. */
  refresh(): void;
}

interface Child {
  parents: Parent[];
  parentEpochs: number[];
  isActive(): boolean;
  notify(): void;
}

export interface Signal<T> {
  readonly name: string;
  get(): T;
  __unsafe__getWithoutCapture(): T;
}

export interface Atom<T> extends Signal<T> {
  set(value: T): T;
  update(fn: (value: T) => T): T;
}

export interface Computed<T> extends Signal<T> {
  readonly isComputed: true;
}

let globalEpoch = 1;
let capturing: { parents: Parent[]; epochs: number[] } | null = null;
let transactionDepth = 0;
const pendingEffects = new Set<EffectNode>();

function captured(parent: Parent) {
  if (capturing && !capturing.parents.includes(parent)) {
    capturing.parents.push(parent);
    capturing.epochs.push(parent.lastChangedEpoch);
  }
}

function propagate(children: Set<Child>) {
  for (const child of children) {
    child.notify();
  }
}

function flushEffects() {
  let guard = 0;
  while (pendingEffects.size) {
    if (++guard > 1000) {
      pendingEffects.clear();
      throw new Error('Reactive effects did not settle');
    }
    const batch = [...pendingEffects];
    pendingEffects.clear();
    for (const effect of batch) {
      effect.maybeRun();
    }
  }
}

function track<T>(
  child: Child,
  fn: () => T,
): { value: T; parents: Parent[]; epochs: number[] } {
  const prev = capturing;
  const frame = { parents: [] as Parent[], epochs: [] as number[] };
  capturing = frame;
  try {
    const value = fn();
    return { value, ...frame };
  } finally {
    capturing = prev;
    const active = child.isActive();
    for (const p of child.parents) {
      if (!frame.parents.includes(p)) {
        detach(p, child);
      }
    }
    if (active) {
      for (const p of frame.parents) {
        attach(p, child);
      }
    }
  }
}

function attach(parent: Parent, child: Child) {
  if (parent.children.has(child)) {
    return;
  }
  parent.children.add(child);
  if (parent instanceof ComputedNode && parent.children.size === 1) {
    for (const gp of parent.parents) {
      attach(gp, parent);
    }
  }
}

function detach(parent: Parent, child: Child) {
  if (!parent.children.delete(child)) {
    return;
  }
  if (parent instanceof ComputedNode && parent.children.size === 0) {
    for (const gp of parent.parents) {
      detach(gp, parent);
    }
  }
}

function parentsChanged(child: Child): boolean {
  for (let i = 0; i < child.parents.length; i++) {
    const p = child.parents[i];
    p.refresh();
    if (p.lastChangedEpoch !== child.parentEpochs[i]) {
      return true;
    }
  }
  return false;
}

class AtomNode<T> implements Atom<T>, Parent {
  lastChangedEpoch = globalEpoch;
  children = new Set<Child>();
  readonly name: string;
  private value: T;
  private isEqual?: (a: T, b: T) => boolean;
  constructor(name: string, value: T, isEqual?: (a: T, b: T) => boolean) {
    this.name = name;
    this.value = value;
    this.isEqual = isEqual;
  }

  refresh() {}

  get(): T {
    captured(this);
    return this.value;
  }

  __unsafe__getWithoutCapture(): T {
    return this.value;
  }

  set(value: T): T {
    if (
      Object.is(value, this.value) ||
      (this.isEqual && this.isEqual(value, this.value))
    ) {
      return this.value;
    }
    this.value = value;
    this.lastChangedEpoch = ++globalEpoch;
    propagate(this.children);
    if (!transactionDepth) {
      flushEffects();
    }
    return value;
  }

  update(fn: (value: T) => T): T {
    return this.set(fn(this.value));
  }
}

const UNINITIALIZED = Symbol('uninitialized');

class ComputedNode<T> implements Computed<T>, Parent, Child {
  readonly isComputed = true as const;
  lastChangedEpoch = 0;
  lastCheckedEpoch = 0;
  children = new Set<Child>();
  parents: Parent[] = [];
  parentEpochs: number[] = [];
  private value: T | typeof UNINITIALIZED = UNINITIALIZED;
  readonly name: string;
  private fn: (prev: T | undefined) => T;
  private isEqual?: (a: T, b: T) => boolean;
  constructor(
    name: string,
    fn: (prev: T | undefined) => T,
    isEqual?: (a: T, b: T) => boolean,
  ) {
    this.name = name;
    this.fn = fn;
    this.isEqual = isEqual;
  }

  isActive() {
    return this.children.size > 0;
  }

  notify() {
    this.lastCheckedEpoch = 0;
    propagate(this.children);
  }

  refresh() {
    if (this.lastCheckedEpoch === globalEpoch) {
      return;
    }
    const isFirst = this.value === UNINITIALIZED;
    if (!isFirst && this.isActive() && this.lastCheckedEpoch !== 0) {
      this.lastCheckedEpoch = globalEpoch;
      return;
    }
    if (!isFirst && !parentsChanged(this)) {
      this.lastCheckedEpoch = globalEpoch;
      return;
    }
    const prev = this.value === UNINITIALIZED ? undefined : this.value;
    const result = track(this, () => this.fn(prev));
    this.parents = result.parents;
    this.parentEpochs = result.parents.map((p) => p.lastChangedEpoch);
    this.lastCheckedEpoch = globalEpoch;
    if (
      isFirst ||
      !(
        Object.is(prev, result.value) ||
        (this.isEqual && this.isEqual(result.value, prev as T))
      )
    ) {
      this.value = result.value;
      this.lastChangedEpoch = globalEpoch;
    }
  }

  get(): T {
    this.refresh();
    captured(this);
    return this.value as T;
  }

  __unsafe__getWithoutCapture(): T {
    this.refresh();
    return this.value as T;
  }
}

class EffectNode implements Child {
  parents: Parent[] = [];
  parentEpochs: number[] = [];
  private stopped = false;
  readonly name: string;
  private fn: () => void;
  constructor(name: string, fn: () => void) {
    this.name = name;
    this.fn = fn;
  }

  isActive() {
    return !this.stopped;
  }

  notify() {
    if (!this.stopped) {
      pendingEffects.add(this);
    }
  }

  maybeRun() {
    if (this.stopped || !parentsChanged(this)) {
      return;
    }
    this.run();
  }

  run() {
    const result = track(this, this.fn);
    this.parents = result.parents;
    this.parentEpochs = result.parents.map((p) => p.lastChangedEpoch);
  }

  stop() {
    this.stopped = true;
    pendingEffects.delete(this);
    for (const p of this.parents) {
      detach(p, this);
    }
    this.parents = [];
  }
}

export function atom<T>(
  name: string,
  initial: T,
  opts?: { isEqual?: (a: T, b: T) => boolean },
): Atom<T> {
  return new AtomNode(name, initial, opts?.isEqual);
}

export function computed<T>(
  name: string,
  fn: (prev: T | undefined) => T,
  opts?: { isEqual?: (a: T, b: T) => boolean },
): Computed<T> {
  return new ComputedNode(name, fn, opts?.isEqual);
}

/** Runs `fn` now and again whenever a signal it read changes. */
export function react(name: string, fn: () => void): () => void {
  const effect = new EffectNode(name, fn);
  effect.run();
  return () => effect.stop();
}

export function transact<T>(fn: () => T): T {
  transactionDepth++;
  try {
    return fn();
  } finally {
    transactionDepth--;
    if (!transactionDepth) {
      flushEffects();
    }
  }
}

export function unsafe__withoutCapture<T>(fn: () => T): T {
  const prev = capturing;
  capturing = null;
  try {
    return fn();
  } finally {
    capturing = prev;
  }
}

export function isSignal(value: unknown): value is Signal<unknown> {
  return value instanceof AtomNode || value instanceof ComputedNode;
}
