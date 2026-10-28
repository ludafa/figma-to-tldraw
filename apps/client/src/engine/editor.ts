import {
  Box,
  type BoxLike,
  type Geometry2d,
  Mat,
  Vec,
  type VecLike,
} from './geometry';
import { HistoryManager, type HistoryMode } from './history';
import {
  getIndexAbove,
  getIndexBetween,
  getIndicesBetween,
  type IndexKey,
} from './indices';
import { type ShapeUtil, type TLShapeUtilConstructor } from './shape-util';
import { SnapManager } from './snaps';
import {
  type Atom,
  atom,
  computed,
  transact,
  unsafe__withoutCapture,
} from './state';
import { type RecordsDiff, Store } from './store';
import { HandTool } from './tools/hand';
import { SelectTool } from './tools/select';
import {
  RootState,
  type StateNode,
  type TLEventInfo,
  type TLPointerEventInfo,
  type TLStateNodeConstructor,
} from './tools/state-node';
import {
  createPageId,
  createShapeId,
  isPageId,
  isShapeId,
  type TLCamera,
  type TLPage,
  type TLPageId,
  type TLParentId,
  type TLRecord,
  type TLShape,
  type TLShapeId,
  type TLShapePartial,
} from './types';

// See apps/docs/skia-engine/tech.md §3 and §6.

export interface EditorOptions {
  maxShapesPerPage: number;
  createTextOnCanvasDoubleClick: boolean;
  dragDistanceSquared: number;
  doubleClickDurationMs: number;
  minZoom: number;
  maxZoom: number;
}

const DEFAULT_OPTIONS: EditorOptions = {
  maxShapesPerPage: 100_000,
  createTextOnCanvasDoubleClick: false,
  dragDistanceSquared: 16,
  doubleClickDurationMs: 450,
  minZoom: 0.02,
  maxZoom: 64,
};

export type TLShapeVisibility = 'hidden' | 'visible' | 'inherit';

export interface TLEditorConstructorOptions {
  store?: Store;
  shapeUtils: readonly TLShapeUtilConstructor<TLShape>[];
  bindingUtils?: readonly unknown[];
  tools?: readonly TLStateNodeConstructor[];
  getContainer: () => HTMLElement;
  options?: Partial<EditorOptions>;
  getShapeVisibility?: (
    shape: TLShape,
    editor: Editor,
  ) => TLShapeVisibility | undefined | null;
}

export interface TLCursor {
  type: string;
  rotation: number;
}

export interface TLInstanceState {
  isFocused: boolean;
  isToolLocked: boolean;
  brush: BoxLike | null;
  cursor: TLCursor;
  isReadonly: boolean;
}

export interface TLUserPreferences {
  isSnapMode: boolean;
}

export interface TLContent {
  shapes: TLShape[];
  rootShapeIds: TLShapeId[];
  schema?: unknown;
}

export interface TLGetShapeAtPointOptions {
  hitInside?: boolean;
  margin?: number;
  renderingOnly?: boolean;
  hitFrameInside?: boolean;
  hitLabels?: boolean;
  filter?: (shape: TLShape) => boolean;
}

export interface Inputs {
  originScreenPoint: Vec;
  originPagePoint: Vec;
  currentScreenPoint: Vec;
  currentPagePoint: Vec;
  previousScreenPoint: Vec;
  previousPagePoint: Vec;
  pointerVelocity: Vec;
  isPointing: boolean;
  isDragging: boolean;
  isPanning: boolean;
  isPinching: boolean;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  accelKey: boolean;
  keys: Set<string>;
  buttons: Set<number>;
}

type Listener = (...args: unknown[]) => void;

function isMac() {
  return (
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad/.test(navigator.platform)
  );
}

export class Editor {
  readonly store: Store;
  readonly history: HistoryManager;
  readonly options: EditorOptions;
  readonly snaps: SnapManager;
  readonly root: StateNode;
  readonly inputs: Inputs = {
    originScreenPoint: new Vec(),
    originPagePoint: new Vec(),
    currentScreenPoint: new Vec(),
    currentPagePoint: new Vec(),
    previousScreenPoint: new Vec(),
    previousPagePoint: new Vec(),
    pointerVelocity: new Vec(),
    isPointing: false,
    isDragging: false,
    isPanning: false,
    isPinching: false,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    accelKey: false,
    keys: new Set(),
    buttons: new Set(),
  };
  readonly user: {
    getUserPreferences: () => TLUserPreferences;
    updateUserPreferences: (p: Partial<TLUserPreferences>) => void;
    getIsSnapMode: () => boolean;
  };
  private utils = new Map<string, ShapeUtil>();
  private container: () => HTMLElement;
  private visibility?: TLEditorConstructorOptions['getShapeVisibility'];
  private currentPageId: Atom<TLPageId>;
  private selections = atom('selections', new Map<TLPageId, TLShapeId[]>());
  private hovered = atom<TLShapeId | null>('hovered', null);
  private editing = atom<TLShapeId | null>('editing', null);
  private cameras = atom('cameras', new Map<TLPageId, TLCamera>());
  private viewport = atom('viewport', new Box(0, 0, 1000, 800));
  private instance = atom<TLInstanceState>('instance', {
    isFocused: false,
    isToolLocked: false,
    brush: null,
    cursor: { type: 'default', rotation: 0 },
    isReadonly: false,
  });
  private prefs = atom<TLUserPreferences>('prefs', { isSnapMode: false });
  private listeners = new Map<string, Set<Listener>>();
  private geometryCache = new WeakMap<TLShape, Geometry2d>();
  private boundsCache = new Map<TLShapeId, Box | null>();
  private lastPointerDown = { time: 0, point: new Vec() };
  private pendingDoubleClick = false;
  private ignoreShapeLock = 0;
  private disposed = false;
  readonly sideEffects;

  constructor(opts: TLEditorConstructorOptions) {
    this.store = opts.store ?? new Store();
    this.sideEffects = this.store.sideEffects;
    this.history = new HistoryManager(this.store);
    this.options = { ...DEFAULT_OPTIONS, ...opts.options };
    this.container = opts.getContainer;
    this.visibility = opts.getShapeVisibility;
    for (const Util of opts.shapeUtils) {
      this.utils.set(Util.type, new Util(this));
    }
    this.snaps = new SnapManager(this);
    const prefs = this.prefs;
    this.user = {
      getUserPreferences: () => prefs.get(),
      updateUserPreferences: (p) => prefs.update((v) => ({ ...v, ...p })),
      getIsSnapMode: () => prefs.get().isSnapMode,
    };

    let pages = [...this.store.pageIds()];
    if (!pages.length) {
      this.history.withMode('ignore', () =>
        this.store.put([
          {
            id: createPageId('page'),
            typeName: 'page',
            name: 'Page 1',
            index: 'a1' as IndexKey,
            meta: {},
          },
        ]),
      );
      pages = [...this.store.pageIds()];
    }
    this.currentPageId = atom('current page', pages[0]);

    this.store.onApply((diff) => this.invalidateBounds(diff));
    this.store.sideEffects.registerAfterDeleteHandler('shape', (shape) => {
      this.onShapeDeleted(shape);
    });

    const tools: TLStateNodeConstructor[] = [
      SelectTool,
      HandTool,
      ...(opts.tools ?? []),
    ];
    class Root extends RootState {
      static override initial = 'select';
      static override children = () => tools;
    }
    this.root = new Root(this);
    this.root.enter({}, 'initial');
  }

  dispose() {
    this.disposed = true;
    this.listeners.clear();
  }

  get isDisposed() {
    return this.disposed;
  }

  // --- utils & geometry -----------------------------------------------------

  getShapeUtil<S extends TLShape = TLShape>(
    shapeOrType: S | S['type'] | TLShapePartial<S>,
  ): ShapeUtil<S> {
    const type =
      typeof shapeOrType === 'string' ? shapeOrType : shapeOrType.type;
    const util = this.utils.get(type);
    if (!util) {
      throw new Error(`No shape util for ${type}`);
    }
    return util as unknown as ShapeUtil<S>;
  }

  hasShapeUtil(type: string) {
    return this.utils.has(type);
  }

  getShapeGeometry<T extends Geometry2d = Geometry2d>(
    shape: TLShape | TLShapeId,
  ): T {
    const s = typeof shape === 'string' ? this.getShape(shape) : shape;
    if (!s) {
      throw new Error('getShapeGeometry: missing shape');
    }
    let g = this.geometryCache.get(s);
    if (!g) {
      g = this.getShapeUtil(s).getGeometry(s);
      this.geometryCache.set(s, g);
    }
    return g as T;
  }

  // --- records --------------------------------------------------------------

  getShape<T extends TLShape = TLShape>(
    id: TLShapeId | TLShape | TLParentId | undefined | null,
  ): T | undefined {
    if (!id) {
      return undefined;
    }
    const key = typeof id === 'string' ? id : id.id;
    if (!isShapeId(key)) {
      return undefined;
    }
    return this.store.get<T>(key);
  }

  getPage(id: TLPageId | TLPage): TLPage | undefined {
    const key = typeof id === 'string' ? id : id.id;
    return this.store.get<TLPage>(key);
  }

  getPages(): TLPage[] {
    const pages = [...this.store.pageIds()]
      .map((id) => this.store.get<TLPage>(id))
      .filter((p): p is TLPage => !!p);
    return pages.sort((a, b) =>
      a.index < b.index ? -1 : a.index > b.index ? 1 : 0,
    );
  }

  getCurrentPageId(): TLPageId {
    return this.currentPageId.get();
  }

  getCurrentPage(): TLPage {
    return this.getPage(this.getCurrentPageId())!;
  }

  setCurrentPage(page: TLPageId | TLPage): this {
    const id = typeof page === 'string' ? page : page.id;
    if (!this.getPage(id)) {
      return this;
    }
    transact(() => {
      this.setEditingShape(null);
      this.hovered.set(null);
      this.currentPageId.set(id);
    });
    this.emit('change-page', id);
    this.emit('camera', this.getCamera());
    return this;
  }

  createPage(page: Partial<TLPage> & { name?: string }): this {
    const pages = this.getPages();
    const id = page.id ?? createPageId();
    this.store.put([
      {
        id,
        typeName: 'page',
        name: page.name ?? `Page ${pages.length + 1}`,
        index: page.index ?? getIndexAbove(pages[pages.length - 1]?.index),
        meta: page.meta ?? {},
      },
    ]);
    return this;
  }

  deletePage(page: TLPageId | TLPage): this {
    const id = typeof page === 'string' ? page : page.id;
    const pages = this.getPages();
    if (pages.length <= 1) {
      return this;
    }
    this.run(() => {
      this.deleteShapes([...this.getPageShapeIds(id)]);
      if (this.getCurrentPageId() === id) {
        const next = pages.find((p) => p.id !== id)!;
        this.currentPageId.set(next.id);
      }
      this.store.remove([id]);
    });
    return this;
  }

  updatePage(partial: Partial<TLPage> & { id: TLPageId }): this {
    const prev = this.getPage(partial.id);
    if (prev) {
      this.store.put([{ ...prev, ...partial }]);
    }
    return this;
  }

  // --- hierarchy ------------------------------------------------------------

  getSortedChildIdsForParent(
    parent: TLParentId | TLShape | TLPage,
  ): TLShapeId[] {
    const id = typeof parent === 'string' ? parent : parent.id;
    return this.store.sortedChildIds(id);
  }

  getParentShape(shape: TLShape | TLShapeId | undefined): TLShape | undefined {
    const s = typeof shape === 'string' ? this.getShape(shape) : shape;
    return s && isShapeId(s.parentId) ? this.getShape(s.parentId) : undefined;
  }

  /** Ancestors from the outermost down to the direct parent. */
  getShapeAncestors(
    shape: TLShape | TLShapeId,
    acc: TLShape[] = [],
  ): TLShape[] {
    const s = typeof shape === 'string' ? this.getShape(shape) : shape;
    const out: TLShape[] = [];
    let parent = s && this.getParentShape(s);
    while (parent) {
      out.push(parent);
      parent = this.getParentShape(parent);
    }
    out.reverse();
    acc.push(...out);
    return acc;
  }

  hasAncestor(
    shape: TLShape | TLShapeId | undefined,
    ancestorId: TLShapeId,
  ): boolean {
    let parent = shape ? this.getParentShape(shape) : undefined;
    while (parent) {
      if (parent.id === ancestorId) {
        return true;
      }
      parent = this.getParentShape(parent);
    }
    return false;
  }

  findShapeAncestor(
    shape: TLShape | TLShapeId,
    predicate: (s: TLShape) => boolean,
  ): TLShape | undefined {
    let parent = this.getParentShape(shape);
    while (parent) {
      if (predicate(parent)) {
        return parent;
      }
      parent = this.getParentShape(parent);
    }
    return undefined;
  }

  findCommonAncestor(
    shapes: (TLShape | TLShapeId)[],
    predicate?: (s: TLShape) => boolean,
  ): TLShapeId | undefined {
    if (!shapes.length) {
      return undefined;
    }
    const chains = shapes.map((s) => this.getShapeAncestors(s));
    let common: TLShape | undefined;
    for (let i = 0; ; i++) {
      const at = chains[0][i];
      if (!at || chains.some((c) => c[i]?.id !== at.id)) {
        break;
      }
      if (!predicate || predicate(at)) {
        common = at;
      }
    }
    return common?.id;
  }

  visitDescendants(
    parent: TLParentId,
    visitor: (id: TLShapeId) => void | false,
  ) {
    for (const id of this.getSortedChildIdsForParent(parent)) {
      if (visitor(id) === false) {
        continue;
      }
      this.visitDescendants(id, visitor);
    }
  }

  getShapeAndDescendantIds(ids: TLShapeId[]): Set<TLShapeId> {
    const out = new Set<TLShapeId>();
    for (const id of ids) {
      if (!this.getShape(id)) {
        continue;
      }
      out.add(id);
      this.visitDescendants(id, (d) => {
        out.add(d);
      });
    }
    return out;
  }

  getAncestorPageId(
    shape: TLShape | TLShapeId | undefined,
  ): TLPageId | undefined {
    let s = typeof shape === 'string' ? this.getShape(shape) : shape;
    while (s) {
      if (isPageId(s.parentId)) {
        return s.parentId;
      }
      s = this.getShape(s.parentId);
    }
    return undefined;
  }

  getPageShapeIds(page: TLPageId | TLPage): Set<TLShapeId> {
    const id = typeof page === 'string' ? page : page.id;
    const out = new Set<TLShapeId>();
    this.visitDescendants(id, (d) => {
      out.add(d);
    });
    return out;
  }

  private pageShapeIds = computed('current page shape ids', () => {
    const page = this.getCurrentPageId();
    this.store.shapeIds();
    return this.getPageShapeIds(page);
  });

  getCurrentPageShapeIds(): Set<TLShapeId> {
    return this.pageShapeIds.get();
  }

  getCurrentPageShapes(): TLShape[] {
    return [...this.getCurrentPageShapeIds()]
      .map((id) => this.getShape(id)!)
      .filter(Boolean);
  }

  /** Depth-first paint order. */
  getCurrentPageShapesSorted(): TLShape[] {
    const out: TLShape[] = [];
    this.visitDescendants(this.getCurrentPageId(), (id) => {
      const s = this.getShape(id);
      if (s) {
        out.push(s);
      }
    });
    return out;
  }

  isShapeOfType<T extends TLShape>(
    shape: TLShape | undefined,
    type: T['type'],
  ): shape is T {
    return shape?.type === type;
  }

  isShapeHidden(shape: TLShape | TLShapeId): boolean {
    const s = typeof shape === 'string' ? this.getShape(shape) : shape;
    if (!s || !this.visibility) {
      return false;
    }
    const own = this.visibility(s, this);
    if (own === 'hidden') {
      return true;
    }
    if (own === 'visible') {
      return false;
    }
    const parent = this.getParentShape(s);
    return parent ? this.isShapeHidden(parent) : false;
  }

  /** The visibility callback's answer for the shape alone. */
  getShapeVisibility(shape: TLShape): TLShapeVisibility {
    return this.visibility?.(shape, this) ?? 'inherit';
  }

  /** Hidden by its own visibility, ignoring ancestors. */
  isShapeHiddenSelf(shape: TLShape): boolean {
    return this.visibility?.(shape, this) === 'hidden';
  }

  isShapeOrAncestorLocked(shape: TLShape | TLShapeId | undefined): boolean {
    let s = typeof shape === 'string' ? this.getShape(shape) : shape;
    while (s) {
      if (s.isLocked) {
        return true;
      }
      s = this.getParentShape(s);
    }
    return false;
  }

  // --- transforms & bounds --------------------------------------------------

  getShapeLocalTransform(shape: TLShape | TLShapeId): Mat {
    const s = typeof shape === 'string' ? this.getShape(shape)! : shape;
    if (!s.rotation) {
      return Mat.Translate(s.x, s.y);
    }
    const c = Math.cos(s.rotation);
    const n = Math.sin(s.rotation);
    return new Mat(c, n, -n, c, s.x, s.y);
  }

  getShapePageTransform(shape: TLShape | TLShapeId): Mat {
    const s = typeof shape === 'string' ? this.getShape(shape) : shape;
    if (!s) {
      return new Mat();
    }
    const local = this.getShapeLocalTransform(s);
    const parent = this.getParentShape(s);
    return parent
      ? Mat.Multiply(this.getShapePageTransform(parent), local)
      : local;
  }

  getShapeParentTransform(shape: TLShape | TLShapeId): Mat {
    const s = typeof shape === 'string' ? this.getShape(shape) : shape;
    const parent = s && this.getParentShape(s);
    return parent ? this.getShapePageTransform(parent) : new Mat();
  }

  getShapePageBounds(shape: TLShape | TLShapeId): Box | undefined {
    const s = typeof shape === 'string' ? this.getShape(shape) : shape;
    if (!s) {
      return undefined;
    }
    return Mat.applyToBounds(
      this.getShapePageTransform(s),
      this.getShapeGeometry(s).bounds,
    );
  }

  getPointInShapeSpace(shape: TLShape | TLShapeId, point: VecLike): Vec {
    return Mat.applyToPoint(
      Mat.Inverse(this.getShapePageTransform(shape)),
      point,
    );
  }

  getPointInParentSpace(shape: TLShape | TLShapeId, point: VecLike): Vec {
    return Mat.applyToPoint(
      Mat.Inverse(this.getShapeParentTransform(shape)),
      point,
    );
  }

  private invalidateBounds(diff: RecordsDiff) {
    const touch = (rec: TLRecord) => {
      if (rec.typeName !== 'shape') {
        return;
      }
      this.boundsCache.delete(rec.id);
      let parent: TLParentId = rec.parentId;
      while (isShapeId(parent)) {
        this.boundsCache.delete(parent);
        const p = this.store.unsafeGetWithoutCapture<TLShape>(parent);
        if (!p) {
          break;
        }
        parent = p.parentId;
      }
    };
    for (const rec of Object.values(diff.added)) {
      touch(rec);
    }
    for (const [from, to] of Object.values(diff.updated)) {
      touch(from);
      touch(to);
    }
    for (const rec of Object.values(diff.removed)) {
      touch(rec);
    }
  }

  /** Geometry bounds of a shape and everything under it, in the shape's own space. */
  getSubtreeLocalBounds(id: TLShapeId): Box | null {
    if (this.boundsCache.has(id)) {
      return this.boundsCache.get(id)!;
    }
    const shape = this.store.unsafeGetWithoutCapture<TLShape>(id);
    if (!shape) {
      return null;
    }
    const boxes: BoxLike[] = [this.getShapeGeometry(shape).bounds];
    for (const childId of this.store.sortedChildIds(id)) {
      const child = this.store.unsafeGetWithoutCapture<TLShape>(childId);
      const b = child && this.getSubtreeLocalBounds(childId);
      if (child && b) {
        boxes.push(Mat.applyToBounds(this.getShapeLocalTransform(child), b));
      }
    }
    const out = Box.Common(boxes);
    this.boundsCache.set(id, out);
    return out;
  }

  getSelectionPageBounds(): Box | null {
    const shapes = this.getSelectedShapes();
    if (!shapes.length) {
      return null;
    }
    return Box.Common(
      shapes.map((s) => this.getShapePageBounds(s)!).filter(Boolean),
    );
  }

  getSelectionRotation(): number {
    const shapes = this.getSelectedShapes();
    if (!shapes.length) {
      return 0;
    }
    const first = this.getShapePageTransform(shapes[0]).rotation();
    return shapes.every(
      (s) => Math.abs(this.getShapePageTransform(s).rotation() - first) < 1e-6,
    )
      ? first
      : 0;
  }

  /** Selection bounds in the selection's rotated frame (x, y in that frame). */
  getSelectionRotatedPageBounds(): Box | undefined {
    const shapes = this.getSelectedShapes();
    if (!shapes.length) {
      return undefined;
    }
    const rotation = this.getSelectionRotation();
    const unrotate = Mat.Rotate(-rotation);
    const points = shapes.flatMap((s) =>
      Mat.applyToPoints(
        Mat.Multiply(unrotate, this.getShapePageTransform(s)),
        this.getShapeGeometry(s).bounds.corners,
      ),
    );
    return Box.FromPoints(points);
  }

  // --- hit testing ----------------------------------------------------------

  isPointInShape(
    shape: TLShape | TLShapeId,
    point: VecLike,
    opts: { hitInside?: boolean; margin?: number } = {},
  ): boolean {
    const s = typeof shape === 'string' ? this.getShape(shape) : shape;
    if (!s) {
      return false;
    }
    const local = this.getPointInShapeSpace(s, point);
    return this.getShapeGeometry(s).hitTestPoint(
      local,
      opts.margin ?? 0,
      opts.hitInside ?? true,
    );
  }

  getShapeAtPoint(
    point: VecLike,
    opts: TLGetShapeAtPointOptions = {},
  ): TLShape | undefined {
    const zoom = this.getZoomLevel();
    const margin = opts.margin ?? 0;
    const view = opts.renderingOnly ? this.getViewportPageBounds() : undefined;
    const visit = (
      parentId: TLParentId,
      parentMat: Mat,
    ): TLShape | undefined => {
      const kids = this.store.sortedChildIds(parentId);
      for (let i = kids.length - 1; i >= 0; i--) {
        const shape = this.store.unsafeGetWithoutCapture<TLShape>(kids[i]);
        if (!shape || this.isShapeHiddenSelf(shape)) {
          continue;
        }
        const mat = Mat.Multiply(parentMat, this.getShapeLocalTransform(shape));
        const sub = this.getSubtreeLocalBounds(shape.id);
        if (!sub) {
          continue;
        }
        const inv = Mat.Inverse(mat);
        const local = Mat.applyToPoint(inv, point);
        const slack = margin / Math.max(zoom, 1e-6);
        if (!sub.containsPoint(local, slack)) {
          continue;
        }
        if (view && !Box.Collides(view, Mat.applyToBounds(mat, sub))) {
          continue;
        }
        const util = this.getShapeUtil(shape);
        const geometry = this.getShapeGeometry(shape);
        if (
          !util.clipsChildren(shape) ||
          geometry.hitTestPoint(local, 0, true)
        ) {
          const hit = visit(shape.id, mat);
          if (hit) {
            return hit;
          }
        }
        if (
          (opts.filter?.(shape) ?? true) &&
          geometry.hitTestPoint(local, slack, opts.hitInside ?? false)
        ) {
          return shape;
        }
      }
      return undefined;
    };
    return unsafe__withoutCapture(() =>
      visit(this.getCurrentPageId(), new Mat()),
    );
  }

  getShapesAtPoint(
    point: VecLike,
    opts: { hitInside?: boolean; margin?: number } = {},
  ): TLShape[] {
    return this.getCurrentPageShapesSorted()
      .filter(
        (s) => !this.isShapeHidden(s) && this.isPointInShape(s, point, opts),
      )
      .reverse();
  }

  getOutermostSelectableShape(
    shape: TLShape | TLShapeId,
    _filter?: (shape: TLShape) => boolean,
  ): TLShape {
    const s = typeof shape === 'string' ? this.getShape(shape) : shape;
    return s!;
  }

  // --- selection ------------------------------------------------------------

  getSelectedShapeIds(): TLShapeId[] {
    return this.selections.get().get(this.getCurrentPageId()) ?? EMPTY_IDS;
  }

  getSelectedShapes(): TLShape[] {
    return this.getSelectedShapeIds()
      .map((id) => this.getShape(id))
      .filter((s): s is TLShape => !!s);
  }

  getOnlySelectedShapeId(): TLShapeId | null {
    const ids = this.getSelectedShapeIds();
    return ids.length === 1 ? ids[0] : null;
  }

  getOnlySelectedShape(): TLShape | null {
    const id = this.getOnlySelectedShapeId();
    return (id && this.getShape(id)) || null;
  }

  isAncestorSelected(shape: TLShape | TLShapeId): boolean {
    const selected = new Set(this.getSelectedShapeIds());
    let parent = this.getParentShape(shape);
    while (parent) {
      if (selected.has(parent.id)) {
        return true;
      }
      parent = this.getParentShape(parent);
    }
    return false;
  }

  setSelectedShapes(shapes: (TLShapeId | TLShape)[]): this {
    const ids = shapes.map((s) => (typeof s === 'string' ? s : s.id));
    const page = this.getCurrentPageId();
    const prev = this.getSelectedShapeIds();
    const unique = [...new Set(ids)].filter((id) =>
      this.store.unsafeGetWithoutCapture(id),
    );
    if (
      unique.length === prev.length &&
      unique.every((id, i) => prev[i] === id)
    ) {
      return this;
    }
    this.selections.update((m) => new Map(m).set(page, unique));
    return this;
  }

  select(...shapes: (TLShapeId | TLShape)[]): this {
    return this.setSelectedShapes(shapes);
  }

  selectNone(): this {
    return this.setSelectedShapes([]);
  }

  selectAll(): this {
    return this.setSelectedShapes(
      this.getSortedChildIdsForParent(this.getCurrentPageId()),
    );
  }

  deselect(...shapes: (TLShapeId | TLShape)[]): this {
    const drop = new Set(shapes.map((s) => (typeof s === 'string' ? s : s.id)));
    return this.setSelectedShapes(
      this.getSelectedShapeIds().filter((id) => !drop.has(id)),
    );
  }

  getHoveredShapeId(): TLShapeId | null {
    return this.hovered.get();
  }

  getHoveredShape(): TLShape | undefined {
    const id = this.getHoveredShapeId();
    return id ? this.getShape(id) : undefined;
  }

  setHoveredShape(shape: TLShapeId | TLShape | null): this {
    this.hovered.set(
      shape ? (typeof shape === 'string' ? shape : shape.id) : null,
    );
    return this;
  }

  getEditingShapeId(): TLShapeId | null {
    return this.editing.get();
  }

  getEditingShape(): TLShape | undefined {
    const id = this.getEditingShapeId();
    return id ? this.getShape(id) : undefined;
  }

  setEditingShape(shape: TLShapeId | TLShape | null): this {
    const id = shape ? (typeof shape === 'string' ? shape : shape.id) : null;
    const prev = this.editing.__unsafe__getWithoutCapture();
    if (prev === id) {
      return this;
    }
    if (id) {
      const s = this.getShape(id);
      if (!s || !this.getShapeUtil(s).canEdit(s)) {
        return this;
      }
    }
    this.editing.set(id);
    if (prev) {
      const s = this.getShape(prev);
      if (s) {
        this.getShapeUtil(s).onEditEnd?.(s);
      }
    }
    return this;
  }

  private onShapeDeleted(shape: TLShape) {
    const page = this.getCurrentPageId();
    const sel = this.selections.__unsafe__getWithoutCapture().get(page);
    if (sel?.includes(shape.id)) {
      this.selections.update((m) =>
        new Map(m).set(
          page,
          sel.filter((id) => id !== shape.id),
        ),
      );
    }
    if (this.hovered.__unsafe__getWithoutCapture() === shape.id) {
      this.hovered.set(null);
    }
    if (this.editing.__unsafe__getWithoutCapture() === shape.id) {
      this.editing.set(null);
    }
  }

  // --- shape mutations ------------------------------------------------------

  private highestChildIndex(parentId: TLParentId): IndexKey | undefined {
    const kids = this.store.sortedChildIds(parentId);
    const last = kids[kids.length - 1];
    return last
      ? this.store.unsafeGetWithoutCapture<TLShape>(last)?.index
      : undefined;
  }

  createShape<T extends TLShape>(
    partial: Omit<TLShapePartial<T>, 'id'> & { id?: TLShapeId },
  ): this {
    return this.createShapes<T>([partial]);
  }

  createShapes<T extends TLShape>(
    partials: (Omit<TLShapePartial<T>, 'id'> & { id?: TLShapeId })[],
  ): this {
    if (!partials.length) {
      return this;
    }
    const page = this.getCurrentPageId();
    const tops = new Map<TLParentId, IndexKey | undefined>();
    const records: TLShape[] = [];
    for (const p of partials) {
      const util = this.getShapeUtil(p.type as string);
      const parentId = (p.parentId ?? page) as TLParentId;
      let top = tops.has(parentId)
        ? tops.get(parentId)
        : this.highestChildIndex(parentId);
      const index = (p.index as IndexKey | undefined) ?? getIndexAbove(top);
      if (!top || index > top) {
        top = index;
      }
      tops.set(parentId, top);
      records.push({
        id: p.id ?? createShapeId(),
        typeName: 'shape',
        type: p.type as string,
        x: p.x ?? 0,
        y: p.y ?? 0,
        rotation: p.rotation ?? 0,
        index,
        parentId,
        isLocked: p.isLocked ?? false,
        opacity: p.opacity ?? 1,
        props: { ...util.getDefaultProps(), ...(p.props as object) },
        meta: { ...(p.meta as object) },
      });
    }
    this.store.put(records);
    return this;
  }

  private merge(prev: TLShape, partial: TLShapePartial): TLShape {
    const next: Record<string, unknown> = { ...prev };
    for (const [k, v] of Object.entries(partial)) {
      if (v === undefined || k === 'id' || k === 'typeName') {
        continue;
      }
      if (k === 'props' || k === 'meta') {
        const base = prev[k] as Record<string, unknown>;
        let changed = false;
        const merged: Record<string, unknown> = { ...base };
        for (const [pk, pv] of Object.entries(v as object)) {
          if (pv === undefined) {
            continue;
          }
          if (merged[pk] !== pv) {
            merged[pk] = pv;
            changed = true;
          }
        }
        next[k] = changed ? merged : base;
        continue;
      }
      next[k] = v;
    }
    return next as unknown as TLShape;
  }

  updateShape<T extends TLShape = TLShape>(
    partial: TLShapePartial<T> | null | undefined,
  ): this {
    return partial ? this.updateShapes([partial]) : this;
  }

  updateShapes<T extends TLShape = TLShape>(
    partials: (TLShapePartial<T> | null | undefined)[],
  ): this {
    const records: TLShape[] = [];
    for (const partial of partials) {
      if (!partial) {
        continue;
      }
      const prev = this.store.unsafeGetWithoutCapture<TLShape>(partial.id);
      if (!prev) {
        continue;
      }
      if (
        !this.ignoreShapeLock &&
        this.isShapeOrAncestorLocked(prev) &&
        !('isLocked' in partial)
      ) {
        continue;
      }
      records.push(this.merge(prev, partial as TLShapePartial));
    }
    if (records.length) {
      this.store.put(records);
    }
    return this;
  }

  deleteShape(id: TLShapeId | TLShape): this {
    return this.deleteShapes([typeof id === 'string' ? id : id.id]);
  }

  deleteShapes(ids: (TLShapeId | TLShape)[]): this {
    const list = ids.map((i) => (typeof i === 'string' ? i : i.id));
    const all = this.getShapeAndDescendantIds(list);
    if (!all.size) {
      return this;
    }
    const ordered = [...all].reverse();
    this.store.remove(ordered);
    return this;
  }

  reparentShapes(
    shapes: (TLShapeId | TLShape)[],
    parentId: TLParentId,
    insertIndex?: IndexKey,
  ): this {
    const ids = shapes.map((s) => (typeof s === 'string' ? s : s.id));
    const parentMat = isShapeId(parentId)
      ? this.getShapePageTransform(parentId)
      : new Mat();
    const inv = Mat.Inverse(parentMat);
    let below = insertIndex ?? this.highestChildIndex(parentId);
    const updates: TLShapePartial[] = [];
    for (const id of ids) {
      const shape = this.getShape(id);
      if (!shape || shape.parentId === parentId) {
        continue;
      }
      const page = this.getShapePageTransform(shape);
      const local = Mat.Multiply(inv, page);
      const d = local.decompose();
      const index = insertIndex
        ? getIndexBetween(below, this.indexAbove(parentId, below))
        : getIndexAbove(below);
      below = index;
      updates.push({
        id,
        type: shape.type,
        parentId,
        x: d.x,
        y: d.y,
        rotation: d.rotation,
        index,
      });
    }
    this.updateShapes(updates);
    return this;
  }

  private indexAbove(
    parentId: TLParentId,
    index: IndexKey | undefined,
  ): IndexKey | undefined {
    if (!index) {
      return undefined;
    }
    for (const id of this.store.sortedChildIds(parentId)) {
      const s = this.store.unsafeGetWithoutCapture<TLShape>(id);
      if (s && s.index > index) {
        return s.index;
      }
    }
    return undefined;
  }

  toggleLock(ids: TLShapeId[]): this {
    const shapes = ids
      .map((id) => this.getShape(id))
      .filter((s): s is TLShape => !!s);
    const lock = shapes.some((s) => !s.isLocked);
    this.run(
      () =>
        this.updateShapes(
          shapes.map((s) => ({ id: s.id, type: s.type, isLocked: lock })),
        ),
      {
        ignoreShapeLock: true,
      },
    );
    return this;
  }

  rotateShapesBy(
    ids: TLShapeId[],
    delta: number,
    opts: { center?: VecLike } = {},
  ): this {
    const shapes = ids
      .map((id) => this.getShape(id))
      .filter((s): s is TLShape => !!s);
    if (!shapes.length) {
      return this;
    }
    const center =
      opts.center ??
      Box.Common(shapes.map((s) => this.getShapePageBounds(s)!)).center;
    const rot = Mat.Rotate(delta, center.x, center.y);
    this.updateShapes(
      shapes.map((s) => {
        const page = Mat.Multiply(rot, this.getShapePageTransform(s));
        const local = Mat.Multiply(
          Mat.Inverse(this.getShapeParentTransform(s)),
          page,
        ).decompose();
        return {
          id: s.id,
          type: s.type,
          x: local.x,
          y: local.y,
          rotation: local.rotation,
        };
      }),
    );
    return this;
  }

  nudgeShapes(ids: TLShapeId[], offset: VecLike): this {
    const updates: TLShapePartial[] = [];
    for (const id of ids) {
      const s = this.getShape(id);
      if (!s) {
        continue;
      }
      const parent = this.getShapeParentTransform(s);
      const inv = Mat.Inverse(parent);
      const d = Mat.applyToPoint(
        inv,
        Vec.Add(Mat.applyToPoint(parent, s), offset),
      );
      updates.push({ id, type: s.type, x: d.x, y: d.y });
    }
    this.updateShapes(updates);
    return this;
  }

  getContentFromCurrentPage(ids: TLShapeId[]): TLContent | undefined {
    const roots = ids.filter(
      (id) =>
        this.getShape(id) &&
        !ids.some((o) => o !== id && this.hasAncestor(id, o)),
    );
    if (!roots.length) {
      return undefined;
    }
    const all = this.getShapeAndDescendantIds(roots);
    const shapes: TLShape[] = [];
    for (const id of all) {
      const s = this.getShape(id)!;
      if (roots.includes(id)) {
        const page = this.getShapePageTransform(s).decompose();
        shapes.push({
          ...s,
          parentId: this.getCurrentPageId(),
          x: page.x,
          y: page.y,
          rotation: page.rotation,
        });
      } else {
        shapes.push(s);
      }
    }
    return { shapes, rootShapeIds: roots };
  }

  putContentOntoCurrentPage(
    content: TLContent,
    opts: { select?: boolean; point?: VecLike; preserveIds?: boolean } = {},
  ): this {
    const idMap = new Map<TLShapeId, TLShapeId>();
    for (const s of content.shapes) {
      idMap.set(s.id, opts.preserveIds ? s.id : createShapeId());
    }
    const page = this.getCurrentPageId();
    const roots = new Set(content.rootShapeIds);
    const rootIndices = getIndicesBetween(
      this.highestChildIndex(page),
      undefined,
      roots.size,
    );
    let r = 0;
    const partials = content.shapes.map((s) => {
      const isRoot = roots.has(s.id);
      return {
        ...s,
        id: idMap.get(s.id)!,
        parentId: isRoot ? page : (idMap.get(s.parentId as TLShapeId) ?? page),
        index: isRoot ? rootIndices[r++] : s.index,
      };
    });
    this.run(() => {
      this.createShapes(partials as TLShapePartial[]);
      if (opts.select) {
        this.select(...content.rootShapeIds.map((id) => idMap.get(id)!));
      }
    });
    return this;
  }

  duplicateShapes(
    ids: (TLShapeId | TLShape)[],
    offset: VecLike = { x: 16, y: 16 },
  ): this {
    const list = ids.map((i) => (typeof i === 'string' ? i : i.id));
    const content = this.getContentFromCurrentPage(list);
    if (!content) {
      return this;
    }
    const idMap = new Map<TLShapeId, TLShapeId>();
    for (const s of content.shapes) {
      idMap.set(s.id, createShapeId());
    }
    const partials: TLShapePartial[] = [];
    for (const s of content.shapes) {
      const isRoot = content.rootShapeIds.includes(s.id);
      if (isRoot) {
        const original = this.getShape(s.id)!;
        partials.push({
          ...original,
          id: idMap.get(s.id)!,
          x: original.x + offset.x,
          y: original.y + offset.y,
          index: getIndexBetween(
            original.index,
            this.indexAbove(original.parentId, original.index),
          ),
        });
      } else {
        partials.push({
          ...s,
          id: idMap.get(s.id)!,
          parentId: idMap.get(s.parentId as TLShapeId) ?? s.parentId,
        });
      }
    }
    this.run(() => {
      this.createShapes(partials);
      this.select(...content.rootShapeIds.map((id) => idMap.get(id)!));
    });
    return this;
  }

  // --- history --------------------------------------------------------------

  markHistoryStoppingPoint(name?: string): string {
    return this.history.mark(
      name ? `${name}-${Math.random().toString(36).slice(2, 7)}` : undefined,
    );
  }

  undo(): this {
    this.history.undo();
    return this;
  }

  redo(): this {
    this.history.redo();
    return this;
  }

  canUndo() {
    return this.history.canUndo();
  }

  canRedo() {
    return this.history.canRedo();
  }

  bailToMark(id: string): this {
    this.history.bailToMark(id);
    return this;
  }

  squashToMark(id: string): this {
    this.history.squashToMark(id);
    return this;
  }

  clearHistory(): this {
    this.history.clear();
    return this;
  }

  run(
    fn: () => void,
    opts: { history?: HistoryMode; ignoreShapeLock?: boolean } = {},
  ): this {
    if (opts.ignoreShapeLock) {
      this.ignoreShapeLock++;
    }
    try {
      // See apps/docs/skia-engine/tech.md §3.
      if (opts.history) {
        this.history.withMode(opts.history, () => transact(fn));
      } else {
        transact(fn);
      }
    } finally {
      if (opts.ignoreShapeLock) {
        this.ignoreShapeLock--;
      }
    }
    return this;
  }

  batch(fn: () => void): this {
    return this.run(fn);
  }

  // --- camera & viewport ----------------------------------------------------

  getCamera(): TLCamera {
    return this.cameras.get().get(this.getCurrentPageId()) ?? DEFAULT_CAMERA;
  }

  getZoomLevel(): number {
    return this.getCamera().z;
  }

  setCamera(
    camera: Partial<TLCamera>,
    _opts?: { animation?: unknown; immediate?: boolean; force?: boolean },
  ): this {
    const prev = this.getCamera();
    const z = Math.min(
      this.options.maxZoom,
      Math.max(this.options.minZoom, camera.z ?? prev.z),
    );
    const next = { x: camera.x ?? prev.x, y: camera.y ?? prev.y, z };
    if (next.x === prev.x && next.y === prev.y && next.z === prev.z) {
      return this;
    }
    const page = this.getCurrentPageId();
    this.cameras.update((m) => new Map(m).set(page, next));
    this.updatePagePoint();
    this.emit('camera', next);
    return this;
  }

  private updatePagePoint() {
    const p = this.viewportToPage(this.inputs.currentScreenPoint);
    this.inputs.currentPagePoint.x = p.x;
    this.inputs.currentPagePoint.y = p.y;
  }

  getViewportScreenBounds(): Box {
    return this.viewport.get();
  }

  getViewportScreenCenter(): Vec {
    const b = this.getViewportScreenBounds();
    return new Vec(b.w / 2, b.h / 2);
  }

  updateViewportScreenBounds(
    rect?: BoxLike | DOMRect | HTMLElement,
    _center?: boolean,
  ): this {
    const r =
      rect === undefined || rect instanceof HTMLElement
        ? (rect ?? this.container()).getBoundingClientRect()
        : rect;
    const box =
      'w' in r
        ? new Box(r.x, r.y, r.w, r.h)
        : new Box(
            (r as DOMRect).left,
            (r as DOMRect).top,
            (r as DOMRect).width,
            (r as DOMRect).height,
          );
    const prev = this.viewport.__unsafe__getWithoutCapture();
    if (
      prev.x !== box.x ||
      prev.y !== box.y ||
      prev.w !== box.w ||
      prev.h !== box.h
    ) {
      this.viewport.set(box);
    }
    return this;
  }

  getViewportPageBounds(): Box {
    const { w, h } = this.getViewportScreenBounds();
    const c = this.getCamera();
    return new Box(-c.x, -c.y, w / c.z, h / c.z);
  }

  /** `point` in client (window) pixels. */
  screenToPage(point: VecLike): Vec {
    const v = this.getViewportScreenBounds();
    return this.viewportToPage({ x: point.x - v.x, y: point.y - v.y });
  }

  /** `point` relative to the viewport's top-left. */
  viewportToPage(point: VecLike): Vec {
    const c = this.getCamera();
    return new Vec(point.x / c.z - c.x, point.y / c.z - c.y);
  }

  pageToScreen(point: VecLike): Vec {
    const v = this.getViewportScreenBounds();
    const p = this.pageToViewport(point);
    return new Vec(p.x + v.x, p.y + v.y);
  }

  pageToViewport(point: VecLike): Vec {
    const c = this.getCamera();
    return new Vec((point.x + c.x) * c.z, (point.y + c.y) * c.z);
  }

  zoomToBounds(
    bounds: BoxLike,
    opts: { inset?: number; targetZoom?: number; animation?: unknown } = {},
  ): this {
    const view = this.getViewportScreenBounds();
    const inset = opts.inset ?? Math.min(64, view.w * 0.1);
    const zx = (view.w - inset * 2) / Math.max(bounds.w, 1);
    const zy = (view.h - inset * 2) / Math.max(bounds.h, 1);
    let z = Math.min(zx, zy);
    if (opts.targetZoom !== undefined) {
      z = Math.min(z, opts.targetZoom);
    }
    z = Math.min(this.options.maxZoom, Math.max(this.options.minZoom, z));
    return this.setCamera({
      x: view.w / 2 / z - (bounds.x + bounds.w / 2),
      y: view.h / 2 / z - (bounds.y + bounds.h / 2),
      z,
    });
  }

  zoomToSelection(opts: { animation?: unknown } = {}): this {
    const b = this.getSelectionPageBounds();
    return b
      ? this.zoomToBounds(b, {
          ...opts,
          targetZoom: Math.max(1, this.getZoomLevel()),
        })
      : this;
  }

  zoomToFit(opts: { animation?: unknown } = {}): this {
    const shapes = this.getSortedChildIdsForParent(this.getCurrentPageId());
    const boxes = shapes
      .map((id) => this.getShapePageBounds(id))
      .filter((b): b is Box => !!b);
    return boxes.length ? this.zoomToBounds(Box.Common(boxes), opts) : this;
  }

  resetZoom(point = this.getViewportScreenCenter()): this {
    return this.zoomAt(point, 1 / this.getZoomLevel());
  }

  zoomAt(screenPoint: VecLike, factor: number): this {
    const c = this.getCamera();
    const z = Math.min(
      this.options.maxZoom,
      Math.max(this.options.minZoom, c.z * factor),
    );
    const p = this.viewportToPage(screenPoint);
    return this.setCamera({
      x: screenPoint.x / z - p.x,
      y: screenPoint.y / z - p.y,
      z,
    });
  }

  zoomIn(point = this.getViewportScreenCenter()): this {
    return this.zoomAt(point, 2);
  }

  zoomOut(point = this.getViewportScreenCenter()): this {
    return this.zoomAt(point, 0.5);
  }

  pan(offset: VecLike): this {
    const c = this.getCamera();
    return this.setCamera({ x: c.x + offset.x / c.z, y: c.y + offset.y / c.z });
  }

  // --- instance state -------------------------------------------------------

  getInstanceState(): TLInstanceState {
    return this.instance.get();
  }

  updateInstanceState(partial: Partial<TLInstanceState>): this {
    this.instance.update((v) => ({ ...v, ...partial }));
    return this;
  }

  setCursor(cursor: Partial<TLCursor>): this {
    const prev = this.instance.__unsafe__getWithoutCapture().cursor;
    const next = { ...prev, ...cursor };
    if (next.type !== prev.type || next.rotation !== prev.rotation) {
      this.updateInstanceState({ cursor: next });
    }
    return this;
  }

  getContainer(): HTMLElement {
    return this.container();
  }

  focus(): this {
    this.updateInstanceState({ isFocused: true });
    return this;
  }

  blur(): this {
    this.updateInstanceState({ isFocused: false });
    return this;
  }

  // --- events ---------------------------------------------------------------

  on(name: string, fn: Listener): this {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(fn);
    return this;
  }

  off(name: string, fn: Listener): this {
    this.listeners.get(name)?.delete(fn);
    return this;
  }

  emit(name: string, ...args: unknown[]): this {
    for (const fn of this.listeners.get(name) ?? []) {
      fn(...args);
    }
    return this;
  }

  // --- tools ----------------------------------------------------------------

  setCurrentTool(id: string, info: object = {}): this {
    this.root.transition(id, info);
    return this;
  }

  getCurrentTool(): StateNode | undefined {
    return this.root.getCurrent();
  }

  getCurrentToolId(): string {
    return this.getCurrentTool()?.id ?? '';
  }

  getPath(): string {
    return this.root.getPath().split('.').slice(1).join('.');
  }

  isIn(path: string): boolean {
    const ids = path.split('.');
    let state: StateNode | undefined = this.root;
    for (const id of ids) {
      const current: StateNode | undefined = state?.getCurrent();
      if (current?.id !== id) {
        return false;
      }
      state = current;
    }
    return true;
  }

  isInAny(...paths: string[]): boolean {
    return paths.some((p) => this.isIn(p));
  }

  getStateDescendant<T extends StateNode>(path: string): T | undefined {
    let state: StateNode | undefined = this.root;
    for (const id of path.split('.')) {
      state = state?.children?.[id];
    }
    return state as T | undefined;
  }

  cancel(): this {
    this.dispatch({ type: 'misc', name: 'cancel' });
    return this;
  }

  complete(): this {
    this.dispatch({ type: 'misc', name: 'complete' });
    return this;
  }

  interrupt(): this {
    this.dispatch({ type: 'misc', name: 'interrupt' });
    return this;
  }

  private updateModifiers(info: {
    shiftKey: boolean;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
  }) {
    const { inputs } = this;
    inputs.shiftKey = info.shiftKey;
    inputs.altKey = info.altKey;
    inputs.ctrlKey = info.ctrlKey;
    inputs.metaKey = info.metaKey;
    inputs.accelKey = isMac() ? info.metaKey : info.ctrlKey;
  }

  private updatePointer(info: TLPointerEventInfo) {
    const { inputs } = this;
    const v = this.getViewportScreenBounds();
    const screen = new Vec(info.point.x - v.x, info.point.y - v.y);
    inputs.previousScreenPoint = inputs.currentScreenPoint.clone();
    inputs.previousPagePoint = inputs.currentPagePoint.clone();
    inputs.currentScreenPoint = screen;
    inputs.currentPagePoint = this.viewportToPage(screen);
  }

  /** Feeds one input event to the state chart, the way tldraw's `dispatch` does. */
  dispatch(info: TLEventInfo): this {
    const { inputs } = this;
    transact(() => {
      if (info.type === 'pointer') {
        this.updateModifiers(info);
        this.updatePointer(info);
        if (info.name === 'pointer_down') {
          inputs.buttons.add(info.button);
          inputs.isPointing = true;
          inputs.isDragging = false;
          inputs.originScreenPoint = inputs.currentScreenPoint.clone();
          inputs.originPagePoint = inputs.currentPagePoint.clone();
          const now = performance.now();
          const isDouble =
            now - this.lastPointerDown.time <
              this.options.doubleClickDurationMs &&
            Vec.Dist(this.lastPointerDown.point, info.point) < 6 &&
            info.button === 0;
          this.lastPointerDown = {
            time: isDouble ? 0 : now,
            point: Vec.From(info.point),
          };
          if (info.button === 2) {
            this.root.handleEvent({ ...info, name: 'right_click' });
            return;
          }
          this.root.handleEvent(info);
          // See apps/docs/skia-engine/tech.md §6.5.
          this.pendingDoubleClick = isDouble;
          if (isDouble) {
            this.root.handleEvent({
              ...info,
              name: 'double_click',
              phase: 'down',
            });
          }
          return;
        }
        if (info.name === 'pointer_move') {
          if (
            inputs.isPointing &&
            !inputs.isDragging &&
            Vec.Dist(inputs.originScreenPoint, inputs.currentScreenPoint) ** 2 >
              this.options.dragDistanceSquared
          ) {
            inputs.isDragging = true;
          }
          this.root.handleEvent(info);
          return;
        }
        if (info.name === 'pointer_up') {
          inputs.buttons.delete(info.button);
          const wasDragging = inputs.isDragging;
          this.root.handleEvent(info);
          inputs.isPointing = false;
          inputs.isDragging = false;
          if (this.pendingDoubleClick && !wasDragging) {
            this.pendingDoubleClick = false;
            this.root.handleEvent({
              ...info,
              name: 'double_click',
              phase: 'up',
            });
          }
          this.pendingDoubleClick = false;
          return;
        }
        this.root.handleEvent(info);
        return;
      }
      if (info.type === 'keyboard') {
        this.updateModifiers(info);
        if (info.name === 'key_down') {
          inputs.keys.add(info.code);
        } else if (info.name === 'key_up') {
          inputs.keys.delete(info.code);
        }
        this.root.handleEvent(info);
        return;
      }
      if (info.type === 'wheel') {
        this.updateModifiers(info);
        this.root.handleEvent(info);
        return;
      }
      this.root.handleEvent(info);
    });
    return this;
  }
}

const EMPTY_IDS: TLShapeId[] = [];
const DEFAULT_CAMERA: TLCamera = { x: 0, y: 0, z: 1 };
