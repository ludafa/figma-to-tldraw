import { atom } from './state';
import {
  emptyDiff,
  isDiffEmpty,
  type RecordsDiff,
  reverseDiff,
  squashInto,
  type Store,
} from './store';

// See apps/docs/skia-engine/tech.md §3.2.

export type HistoryMode = 'record' | 'record-preserveRedoStack' | 'ignore';

type Entry = { type: 'mark'; id: string } | { type: 'diff'; diff: RecordsDiff };

interface RedoUnit {
  mark?: string;
  diff: RecordsDiff;
}

let markCounter = 0;

export class HistoryManager {
  private undos: Entry[] = [];
  private redos: RedoUnit[] = [];
  private pending = emptyDiff();
  private modes: HistoryMode[] = [];
  private store: Store;
  /** Bumped on every stack change so UI can react to can-undo / can-redo. */
  readonly version = atom('history version', 0);

  constructor(store: Store) {
    this.store = store;
    store.onApply((diff) => this.onApply(diff));
  }

  private get mode(): HistoryMode {
    return this.modes[this.modes.length - 1] ?? 'record';
  }

  private bump() {
    this.version.update((v) => v + 1);
  }

  private onApply(diff: RecordsDiff) {
    const mode = this.mode;
    if (mode === 'ignore') {
      return;
    }
    squashInto(this.pending, diff);
    if (mode === 'record' && this.redos.length) {
      this.redos = [];
      this.bump();
    }
  }

  private flushPending() {
    if (isDiffEmpty(this.pending)) {
      return;
    }
    const top = this.undos[this.undos.length - 1];
    if (top?.type === 'diff') {
      squashInto(top.diff, this.pending);
    } else {
      this.undos.push({ type: 'diff', diff: this.pending });
    }
    this.pending = emptyDiff();
    this.bump();
  }

  withMode<T>(mode: HistoryMode, fn: () => T): T {
    this.modes.push(mode);
    try {
      return fn();
    } finally {
      this.modes.pop();
    }
  }

  mark(id = `mark-${++markCounter}`): string {
    this.flushPending();
    this.undos.push({ type: 'mark', id });
    this.bump();
    return id;
  }

  /** Pops entries back to the last mark that has changes after it. */
  private popToMark(stopAt?: string): { diff: RecordsDiff; mark?: string } {
    this.flushPending();
    const diffs: RecordsDiff[] = [];
    let mark: string | undefined;
    while (this.undos.length) {
      const entry = this.undos.pop()!;
      if (entry.type === 'mark') {
        if (stopAt !== undefined) {
          if (entry.id === stopAt) {
            mark = entry.id;
            break;
          }
          continue;
        }
        if (diffs.length) {
          mark = entry.id;
          break;
        }
        continue;
      }
      diffs.push(entry.diff);
    }
    const diff = emptyDiff();
    for (let i = diffs.length - 1; i >= 0; i--) {
      squashInto(diff, diffs[i]);
    }
    return { diff, mark };
  }

  private applyIgnored(diff: RecordsDiff) {
    this.withMode('ignore', () => this.store.applyDiff(diff));
  }

  undo() {
    const { diff, mark } = this.popToMark();
    if (isDiffEmpty(diff)) {
      if (mark) {
        this.undos.push({ type: 'mark', id: mark });
      }
      return;
    }
    this.applyIgnored(reverseDiff(diff));
    this.redos.push({ mark, diff });
    this.bump();
  }

  redo() {
    this.flushPending();
    const unit = this.redos.pop();
    if (!unit) {
      return;
    }
    if (unit.mark) {
      this.undos.push({ type: 'mark', id: unit.mark });
    }
    this.applyIgnored(unit.diff);
    this.undos.push({ type: 'diff', diff: unit.diff });
    this.bump();
  }

  bailToMark(id: string) {
    this.flushPending();
    if (!this.undos.some((e) => e.type === 'mark' && e.id === id)) {
      return;
    }
    const { diff } = this.popToMark(id);
    if (!isDiffEmpty(diff)) {
      this.applyIgnored(reverseDiff(diff));
    }
    this.bump();
  }

  squashToMark(id: string) {
    this.flushPending();
    const at = this.undos.findIndex((e) => e.type === 'mark' && e.id === id);
    if (at < 0) {
      return;
    }
    const diff = emptyDiff();
    const rest: Entry[] = [];
    for (const e of this.undos.slice(at + 1)) {
      if (e.type === 'diff') {
        squashInto(diff, e.diff);
      }
    }
    if (!isDiffEmpty(diff)) {
      rest.push({ type: 'diff', diff });
    }
    this.undos = [...this.undos.slice(0, at + 1), ...rest];
    this.bump();
  }

  clear() {
    this.undos = [];
    this.redos = [];
    this.pending = emptyDiff();
    this.bump();
  }

  canUndo() {
    this.version.get();
    return (
      !isDiffEmpty(this.pending) || this.undos.some((e) => e.type === 'diff')
    );
  }

  canRedo() {
    this.version.get();
    return this.redos.length > 0;
  }
}
