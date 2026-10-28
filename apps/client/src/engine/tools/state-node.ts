import type { Editor } from '../editor';
import type { VecLike } from '../geometry';
import { type Atom, atom } from '../state';
import type { TLShape } from '../types';

// See apps/docs/skia-engine/tech.md §6.

export interface TLModifiers {
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  accelKey: boolean;
}

export type TLPointerEventName =
  | 'pointer_down'
  | 'pointer_move'
  | 'pointer_up'
  | 'double_click'
  | 'right_click';

export type TLPointerEventTarget = 'canvas' | 'shape' | 'selection' | 'handle';

export type TLSelectionHandle =
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top_left'
  | 'top_right'
  | 'bottom_left'
  | 'bottom_right'
  | 'top_left_rotate'
  | 'top_right_rotate'
  | 'bottom_left_rotate'
  | 'bottom_right_rotate';

export interface TLPointerEventInfo extends TLModifiers {
  type: 'pointer';
  name: TLPointerEventName;
  target: TLPointerEventTarget;
  shape?: TLShape;
  handle?: TLSelectionHandle;
  point: VecLike;
  pointerId: number;
  button: number;
  isPen: boolean;
  /** Double clicks only: the second press (`down`) or its release (`up`), as in tldraw. */
  phase?: 'down' | 'up';
}

export interface TLKeyboardEventInfo extends TLModifiers {
  type: 'keyboard';
  name: 'key_down' | 'key_up' | 'key_repeat';
  key: string;
  code: string;
}

export interface TLWheelEventInfo extends TLModifiers {
  type: 'wheel';
  name: 'wheel';
  delta: VecLike;
  point: VecLike;
}

export interface TLMiscEventInfo {
  type: 'misc';
  name: 'cancel' | 'complete' | 'interrupt';
}

export interface TLTickEventInfo {
  type: 'tick';
  name: 'tick';
  elapsed: number;
}

export type TLEventInfo =
  | TLPointerEventInfo
  | TLKeyboardEventInfo
  | TLWheelEventInfo
  | TLMiscEventInfo
  | TLTickEventInfo;

export type TLStateNodeConstructor = {
  new (editor: Editor, parent?: StateNode): StateNode;
  id: string;
  initial?: string;
  children?: () => TLStateNodeConstructor[];
  isLockable?: boolean;
};

const HANDLERS: Record<string, keyof StateNode> = {
  pointer_down: 'onPointerDown',
  pointer_move: 'onPointerMove',
  pointer_up: 'onPointerUp',
  double_click: 'onDoubleClick',
  right_click: 'onRightClick',
  key_down: 'onKeyDown',
  key_up: 'onKeyUp',
  key_repeat: 'onKeyRepeat',
  wheel: 'onWheel',
  cancel: 'onCancel',
  complete: 'onComplete',
  interrupt: 'onInterrupt',
  tick: 'onTick',
};

// oxlint-disable-next-line typescript/no-explicit-any -- states pass arbitrary info objects, as in tldraw.
type AnyInfo = any;

export abstract class StateNode {
  static id: string;
  static initial?: string;
  static children?: () => TLStateNodeConstructor[];
  static isLockable = true;

  readonly id: string;
  readonly editor: Editor;
  readonly parent: StateNode;
  readonly children?: Record<string, StateNode>;
  readonly initial?: string;
  readonly type: 'branch' | 'leaf' | 'root';
  info: AnyInfo = {};
  private readonly _current: Atom<StateNode | undefined>;
  private readonly _isActive: Atom<boolean>;

  constructor(editor: Editor, parent?: StateNode) {
    const ctor = this.constructor as TLStateNodeConstructor;
    this.id = ctor.id;
    this.editor = editor;
    this.parent = parent ?? this;
    this.initial = ctor.initial;
    this._current = atom(`state ${this.id} current`, undefined);
    this._isActive = atom(`state ${this.id} active`, false);
    const kids = ctor.children?.();
    if (kids?.length) {
      this.children = {};
      for (const Kid of kids) {
        const node = new Kid(editor, this);
        this.children[node.id] = node;
      }
      this.type = parent ? 'branch' : 'root';
    } else {
      this.type = parent ? 'leaf' : 'root';
    }
  }

  getCurrent(): StateNode | undefined {
    return this._current.get();
  }

  getIsActive(): boolean {
    return this._isActive.get();
  }

  getPath(): string {
    const current = this.getCurrent();
    return current ? `${this.id}.${current.getPath()}` : this.id;
  }

  transition(id: string, info: AnyInfo = {}): this {
    this.transitionPath(id.split('.'), info);
    return this;
  }

  private transitionPath([step, ...rest]: string[], info: AnyInfo) {
    if (step === undefined) {
      return;
    }
    const prev = this.getCurrent();
    const next = this.children?.[step];
    if (!next) {
      throw new Error(`State ${this.id} has no child ${step}`);
    }
    if (prev?.id !== next.id) {
      prev?.exit(info, step);
      this._current.set(next);
      next.enter(info, prev?.id ?? 'initial');
      if (!next.getIsActive()) {
        return;
      }
    }
    next.transitionPath(rest, info);
  }

  handleEvent(info: TLEventInfo) {
    const name = HANDLERS[info.name];
    const child = this._current.__unsafe__getWithoutCapture();
    const fn = this[name] as ((info: TLEventInfo) => void) | undefined;
    fn?.call(this, info);
    if (
      this._isActive.__unsafe__getWithoutCapture() &&
      child &&
      child === this._current.__unsafe__getWithoutCapture()
    ) {
      child.handleEvent(info);
    }
  }

  enter(info: AnyInfo, from: string) {
    this._isActive.set(true);
    this.info = info;
    this.onEnter?.(info, from);
    if (this.children && this.initial && this.getIsActive()) {
      const initial = this.children[this.initial];
      this._current.set(initial);
      initial.enter(info, from);
    }
  }

  exit(info: AnyInfo, to: string) {
    this._isActive.set(false);
    this.onExit?.(info, to);
    if (!this.getIsActive()) {
      this.getCurrent()?.exit(info, to);
    }
  }

  onEnter?(info: AnyInfo, from: string): void;
  onExit?(info: AnyInfo, to: string): void;
  onPointerDown?(info: TLPointerEventInfo): void;
  onPointerMove?(info: TLPointerEventInfo): void;
  onPointerUp?(info: TLPointerEventInfo): void;
  onDoubleClick?(info: TLPointerEventInfo): void;
  onRightClick?(info: TLPointerEventInfo): void;
  onKeyDown?(info: TLKeyboardEventInfo): void;
  onKeyUp?(info: TLKeyboardEventInfo): void;
  onKeyRepeat?(info: TLKeyboardEventInfo): void;
  onWheel?(info: TLWheelEventInfo): void;
  onCancel?(info: TLMiscEventInfo): void;
  onComplete?(info: TLMiscEventInfo): void;
  onInterrupt?(info: TLMiscEventInfo): void;
  onTick?(info: TLTickEventInfo): void;
}

export class RootState extends StateNode {
  static override id = 'root';
  static override initial = '';
}
