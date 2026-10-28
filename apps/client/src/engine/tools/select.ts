import { Box, Mat, Vec } from '../geometry';
import type { TLResizeHandle } from '../shape-util';
import type { TLShape, TLShapeId, TLShapePartial } from '../types';
import {
  StateNode,
  type TLKeyboardEventInfo,
  type TLPointerEventInfo,
  type TLSelectionHandle,
} from './state-node';

// See apps/docs/skia-engine/tech.md §6.

const HOVER_MARGIN_PX = 0;

function hitAtPointer(state: StateNode): TLShape | undefined {
  const { editor } = state;
  return editor.getShapeAtPoint(editor.inputs.currentPagePoint, {
    renderingOnly: true,
    margin: HOVER_MARGIN_PX,
  });
}

function updateHover(state: StateNode) {
  const { editor } = state;
  const hit = hitAtPointer(state);
  const target =
    hit && !editor.isShapeOrAncestorLocked(hit)
      ? editor.getOutermostSelectableShape(hit)
      : undefined;
  editor.setHoveredShape(target?.id ?? null);
}

function isRotateHandle(handle?: TLSelectionHandle) {
  return !!handle && handle.endsWith('_rotate');
}

class Idle extends StateNode {
  static override id = 'idle';

  override onEnter() {
    this.editor.setCursor({ type: 'default', rotation: 0 });
    updateHover(this);
  }

  override onPointerMove() {
    updateHover(this);
  }

  override onPointerDown(info: TLPointerEventInfo) {
    const { editor } = this;
    if (info.button !== 0) {
      return;
    }
    if (info.target === 'selection' && info.handle) {
      this.parent.transition(
        isRotateHandle(info.handle)
          ? 'pointing_rotate_handle'
          : 'pointing_resize_handle',
        info,
      );
      return;
    }
    const hit = hitAtPointer(this);
    const selected = editor.getSelectedShapeIds();
    const bounds = editor.getSelectionRotatedPageBounds();
    const rotation = editor.getSelectionRotation();
    const inSelection =
      !!bounds &&
      selected.length > 1 &&
      bounds.containsPoint(
        Mat.applyToPoint(Mat.Rotate(-rotation), editor.inputs.currentPagePoint),
      );
    if (hit && !editor.isShapeOrAncestorLocked(hit)) {
      const outer = editor.getOutermostSelectableShape(hit);
      if (
        inSelection &&
        !info.shiftKey &&
        (selected.includes(outer.id) || editor.isAncestorSelected(outer))
      ) {
        this.parent.transition('pointing_selection', info);
        return;
      }
      this.parent.transition('pointing_shape', {
        ...info,
        target: 'shape',
        shape: hit,
      });
      return;
    }
    if (inSelection && !info.shiftKey) {
      this.parent.transition('pointing_selection', info);
      return;
    }
    this.parent.transition('pointing_canvas', info);
  }

  override onDoubleClick(info: TLPointerEventInfo) {
    const { editor } = this;
    if (info.shiftKey || info.phase !== 'up') {
      return;
    }
    const hovered = editor.getHoveredShape();
    const hit = hitAtPointer(this);
    const shape =
      hovered ?? (hit ? editor.getOutermostSelectableShape(hit) : undefined);
    if (!shape || editor.isShapeOrAncestorLocked(shape)) {
      return;
    }
    const util = editor.getShapeUtil(shape);
    const change = util.onDoubleClick?.(shape);
    if (change) {
      editor.updateShapes([change]);
      return;
    }
    if (util.canEdit(shape)) {
      editor.markHistoryStoppingPoint('editing shape');
      editor.select(shape.id);
      editor.setEditingShape(shape.id);
      this.parent.transition('editing_shape', {
        ...info,
        target: 'shape',
        shape,
      });
    }
  }

  override onKeyDown(info: TLKeyboardEventInfo) {
    const { editor } = this;
    const selected = editor.getSelectedShapeIds();
    switch (info.key) {
      case 'Delete':
      case 'Backspace': {
        if (selected.length) {
          editor.markHistoryStoppingPoint('delete');
          editor.deleteShapes(selected);
        }
        return;
      }
      case 'Enter': {
        const only = editor.getOnlySelectedShape();
        if (only && editor.getShapeUtil(only).canEdit(only)) {
          editor.markHistoryStoppingPoint('editing shape');
          editor.setEditingShape(only.id);
          this.parent.transition('editing_shape', {
            target: 'shape',
            shape: only,
          });
        }
        return;
      }
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown': {
        if (!selected.length) {
          return;
        }
        const step = info.shiftKey ? 10 : 1;
        const d =
          info.key === 'ArrowLeft'
            ? { x: -step, y: 0 }
            : info.key === 'ArrowRight'
              ? { x: step, y: 0 }
              : info.key === 'ArrowUp'
                ? { x: 0, y: -step }
                : { x: 0, y: step };
        editor.markHistoryStoppingPoint('nudge');
        editor.nudgeShapes(selected, d);
        return;
      }
    }
  }

  override onCancel() {
    const { editor } = this;
    if (editor.getSelectedShapeIds().length) {
      editor.selectNone();
    }
  }
}

class PointingCanvas extends StateNode {
  static override id = 'pointing_canvas';

  override onEnter(info: TLPointerEventInfo) {
    if (!info.shiftKey && this.editor.getSelectedShapeIds().length) {
      this.editor.selectNone();
    }
  }

  override onPointerMove(info: TLPointerEventInfo) {
    if (this.editor.inputs.isDragging) {
      this.parent.transition('brushing', info);
    }
  }

  override onPointerUp() {
    this.parent.transition('idle');
  }

  override onCancel() {
    this.parent.transition('idle');
  }
}

class PointingShape extends StateNode {
  static override id = 'pointing_shape';
  private target?: TLShape;
  private selectedOnEnter = false;

  override onEnter(info: TLPointerEventInfo) {
    const { editor } = this;
    const hit = info.shape!;
    const outer = editor.getOutermostSelectableShape(hit);
    this.target = outer;
    const selected = editor.getSelectedShapeIds();
    this.selectedOnEnter = false;
    if (info.shiftKey) {
      if (!selected.includes(outer.id)) {
        editor.markHistoryStoppingPoint('selecting shape');
        editor.setSelectedShapes([...selected, outer.id]);
        this.selectedOnEnter = true;
      }
    } else if (!selected.includes(outer.id)) {
      editor.markHistoryStoppingPoint('selecting shape');
      editor.select(outer.id);
      this.selectedOnEnter = true;
    }
  }

  override onPointerMove(info: TLPointerEventInfo) {
    if (this.editor.inputs.isDragging) {
      this.parent.transition('translating', info);
    }
  }

  override onPointerUp(info: TLPointerEventInfo) {
    const { editor } = this;
    const outer = this.target;
    if (outer && !this.selectedOnEnter) {
      if (info.shiftKey) {
        editor.deselect(outer.id);
      } else if (
        editor.getSelectedShapeIds().length !== 1 ||
        editor.getOnlySelectedShapeId() !== outer.id
      ) {
        editor.select(outer.id);
      }
    }
    this.parent.transition('idle', info);
  }

  override onCancel() {
    this.parent.transition('idle');
  }

  override onInterrupt() {
    this.parent.transition('idle');
  }
}

class PointingSelection extends StateNode {
  static override id = 'pointing_selection';

  override onPointerMove(info: TLPointerEventInfo) {
    if (this.editor.inputs.isDragging) {
      this.parent.transition('translating', info);
    }
  }

  override onPointerUp(info: TLPointerEventInfo) {
    const { editor } = this;
    const hit = hitAtPointer(this);
    if (hit && !info.shiftKey) {
      editor.select(editor.getOutermostSelectableShape(hit).id);
    }
    this.parent.transition('idle', info);
  }

  override onCancel() {
    this.parent.transition('idle');
  }
}

class Brushing extends StateNode {
  static override id = 'brushing';
  private initialIds: TLShapeId[] = [];

  override onEnter(info: TLPointerEventInfo) {
    this.initialIds = info.shiftKey
      ? [...this.editor.getSelectedShapeIds()]
      : [];
    this.update();
  }

  private update() {
    const { editor } = this;
    const { originPagePoint, currentPagePoint } = editor.inputs;
    const brush = Box.FromPoints([originPagePoint, currentPagePoint]);
    editor.updateInstanceState({
      brush: { x: brush.x, y: brush.y, w: brush.w, h: brush.h },
    });
    const hits: TLShapeId[] = [];
    for (const id of editor.getSortedChildIdsForParent(
      editor.getCurrentPageId(),
    )) {
      const shape = editor.getShape(id);
      if (!shape || editor.isShapeHidden(shape) || shape.isLocked) {
        continue;
      }
      const b = editor.getShapePageBounds(shape);
      if (
        b &&
        (editor.inputs.ctrlKey ? brush.includes(b) : brush.collides(b))
      ) {
        hits.push(id);
      }
    }
    editor.setSelectedShapes([...new Set([...this.initialIds, ...hits])]);
  }

  override onPointerMove() {
    this.update();
  }

  override onPointerUp() {
    this.editor.updateInstanceState({ brush: null });
    this.parent.transition('idle');
  }

  override onCancel() {
    this.editor.updateInstanceState({ brush: null });
    this.editor.setSelectedShapes(this.initialIds);
    this.parent.transition('idle');
  }

  override onExit() {
    this.editor.updateInstanceState({ brush: null });
  }
}

interface TranslateSnapshot {
  shape: TLShape;
  origin: Vec;
  parentInverse: Mat;
}

class Translating extends StateNode {
  static override id = 'translating';
  private markId = '';
  private snapshot: TranslateSnapshot[] = [];
  private initialBounds = new Box();

  override onEnter(info: TLPointerEventInfo & { onInteractionEnd?: string }) {
    const { editor } = this;
    this.info = info;
    this.markId = editor.markHistoryStoppingPoint('translating');
    const shapes = editor
      .getSelectedShapes()
      .filter(
        (s) =>
          !editor.isAncestorSelected(s) && !editor.isShapeOrAncestorLocked(s),
      );
    this.snapshot = shapes.map((shape) => {
      const parent = editor.getShapeParentTransform(shape);
      return {
        shape,
        origin: Mat.applyToPoint(parent, shape),
        parentInverse: Mat.Inverse(parent),
      };
    });
    this.initialBounds = editor.getSelectionPageBounds() ?? new Box();
    const starts: TLShapePartial[] = [];
    for (const { shape } of this.snapshot) {
      const change = editor.getShapeUtil(shape).onTranslateStart?.(shape);
      if (change) {
        starts.push(change);
      }
    }
    if (starts.length) {
      editor.updateShapes(starts);
    }
    editor.setCursor({ type: 'move', rotation: 0 });
    this.update();
  }

  private update() {
    const { editor } = this;
    const { originPagePoint, currentPagePoint, shiftKey, ctrlKey } =
      editor.inputs;
    const delta = Vec.Sub(currentPagePoint, originPagePoint);
    let locked: 'x' | 'y' | null = null;
    if (shiftKey) {
      locked = Math.abs(delta.x) > Math.abs(delta.y) ? 'y' : 'x';
      if (locked === 'x') {
        delta.x = 0;
      } else {
        delta.y = 0;
      }
    }
    if (editor.user.getIsSnapMode() !== ctrlKey && this.snapshot.length) {
      const { nudge } = editor.snaps.snapTranslateShapes({
        lockedAxis: locked,
        initialSelectionPageBounds: this.initialBounds,
        dragDelta: delta,
      });
      delta.x += nudge.x;
      delta.y += nudge.y;
    } else {
      editor.snaps.clearIndicators();
    }
    editor.updateShapes(
      this.snapshot.map(({ shape, origin, parentInverse }) => {
        const p = Mat.applyToPoint(parentInverse, Vec.Add(origin, delta));
        return { id: shape.id, type: shape.type, x: p.x, y: p.y };
      }),
    );
    const changes: TLShapePartial[] = [];
    for (const { shape } of this.snapshot) {
      const current = editor.getShape(shape.id);
      const change =
        current && editor.getShapeUtil(shape).onTranslate?.(shape, current);
      if (change) {
        changes.push(change);
      }
    }
    if (changes.length) {
      editor.updateShapes(changes);
    }
  }

  override onPointerMove() {
    this.update();
  }

  override onKeyDown() {
    this.update();
  }

  override onKeyUp() {
    this.update();
  }

  override onPointerUp() {
    this.complete();
  }

  override onComplete() {
    this.complete();
  }

  private complete() {
    const { editor } = this;
    editor.snaps.clearIndicators();
    editor.run(() => {
      const changes: TLShapePartial[] = [];
      for (const { shape } of this.snapshot) {
        const current = editor.getShape(shape.id);
        const change =
          current &&
          editor.getShapeUtil(shape).onTranslateEnd?.(shape, current);
        if (change) {
          changes.push(change);
        }
      }
      if (changes.length) {
        editor.updateShapes(changes);
      }
    });
    const next = (this.info as { onInteractionEnd?: string }).onInteractionEnd;
    if (next) {
      editor.setCurrentTool(next);
    } else {
      this.parent.transition('idle');
    }
  }

  override onCancel() {
    this.editor.snaps.clearIndicators();
    this.editor.bailToMark(this.markId);
    this.parent.transition('idle');
  }

  override onInterrupt() {
    this.complete();
  }

  override onExit() {
    this.editor.snaps.clearIndicators();
  }
}

class PointingResizeHandle extends StateNode {
  static override id = 'pointing_resize_handle';

  override onPointerMove(info: TLPointerEventInfo) {
    if (this.editor.inputs.isDragging) {
      this.parent.transition('resizing', {
        ...this.info,
        ...info,
        handle: this.info.handle,
      });
    }
  }

  override onPointerUp() {
    this.parent.transition('idle');
  }

  override onCancel() {
    this.parent.transition('idle');
  }
}

class PointingRotateHandle extends StateNode {
  static override id = 'pointing_rotate_handle';

  override onEnter() {
    this.editor.setCursor({ type: 'grab', rotation: 0 });
  }

  override onPointerMove(info: TLPointerEventInfo) {
    if (this.editor.inputs.isDragging) {
      this.parent.transition('rotating', {
        ...this.info,
        ...info,
        handle: this.info.handle,
      });
    }
  }

  override onPointerUp() {
    this.parent.transition('idle');
  }

  override onCancel() {
    this.parent.transition('idle');
  }
}

interface ResizeInfo extends TLPointerEventInfo {
  handle: TLResizeHandle;
  isCreating?: boolean;
  creatingMarkId?: string;
  creationCursorOffset?: { x: number; y: number };
  onInteractionEnd?: string;
  onCreate?: (shape: TLShape | null) => void;
}

interface ResizeSnapshot {
  shape: TLShape;
  pageTransform: Mat;
  parentInverse: Mat;
  bounds: Box;
}

const X_HANDLES = new Set([
  'left',
  'right',
  'top_left',
  'top_right',
  'bottom_left',
  'bottom_right',
]);
const Y_HANDLES = new Set([
  'top',
  'bottom',
  'top_left',
  'top_right',
  'bottom_left',
  'bottom_right',
]);

class Resizing extends StateNode {
  static override id = 'resizing';
  declare info: ResizeInfo;
  private markId = '';
  private rotation = 0;
  private bounds = new Box();
  private shapes: ResizeSnapshot[] = [];

  override onEnter(info: ResizeInfo) {
    const { editor } = this;
    this.info = info;
    this.markId =
      info.isCreating && info.creatingMarkId
        ? info.creatingMarkId
        : editor.markHistoryStoppingPoint('resizing');
    this.rotation = editor.getSelectionRotation();
    this.bounds = editor.getSelectionRotatedPageBounds() ?? new Box();
    const roots = editor
      .getSelectedShapes()
      .filter((s) => !editor.isAncestorSelected(s));
    const list: TLShape[] = [];
    const visit = (shape: TLShape) => {
      list.push(shape);
      if (!editor.getShapeUtil(shape).canResizeChildren(shape)) {
        return;
      }
      for (const id of editor.getSortedChildIdsForParent(shape.id)) {
        const child = editor.getShape(id);
        if (child) {
          visit(child);
        }
      }
    };
    roots.forEach(visit);
    this.shapes = list.map((shape) => ({
      shape,
      pageTransform: editor.getShapePageTransform(shape),
      parentInverse: Mat.Inverse(editor.getShapeParentTransform(shape)),
      bounds: editor.getShapeGeometry(shape).bounds,
    }));
    const starts: TLShapePartial[] = [];
    for (const { shape } of this.shapes) {
      const change = editor.getShapeUtil(shape).onResizeStart?.(shape);
      if (change) {
        starts.push(change);
      }
    }
    if (starts.length) {
      editor.updateShapes(starts);
    }
    this.update();
  }

  private update() {
    const { editor } = this;
    const handle = this.info.handle;
    const unrotate = Mat.Rotate(-this.rotation);
    const rotate = Mat.Rotate(this.rotation);
    const offset = this.info.creationCursorOffset ?? { x: 0, y: 0 };
    const cur = Mat.applyToPoint(unrotate, editor.inputs.currentPagePoint);
    const org = Mat.applyToPoint(unrotate, editor.inputs.originPagePoint);
    const dx = cur.x - org.x + offset.x;
    const dy = cur.y - org.y + offset.y;
    const b = this.bounds;
    let { minX, minY, maxX, maxY } = b;
    if (handle.includes('left')) {
      minX += dx;
    } else if (handle.includes('right')) {
      maxX += dx;
    }
    if (handle.includes('top')) {
      minY += dy;
    } else if (handle.includes('bottom')) {
      maxY += dy;
    }
    let sx = X_HANDLES.has(handle) ? (maxX - minX) / Math.max(b.w, 1e-6) : 1;
    let sy = Y_HANDLES.has(handle) ? (maxY - minY) / Math.max(b.h, 1e-6) : 1;
    const locked =
      editor.inputs.shiftKey ||
      this.shapes.some(({ shape }) =>
        editor.getShapeUtil(shape).isAspectRatioLocked(shape),
      );
    if (locked) {
      const s =
        X_HANDLES.has(handle) && Y_HANDLES.has(handle)
          ? Math.max(Math.abs(sx), Math.abs(sy))
          : X_HANDLES.has(handle)
            ? Math.abs(sx)
            : Math.abs(sy);
      sx = Math.sign(sx || 1) * s;
      sy = Math.sign(sy || 1) * s;
    }
    const originX = handle.includes('left') ? b.maxX : b.minX;
    const originY = handle.includes('top') ? b.maxY : b.minY;
    const scaleOrigin = Mat.applyToPoint(rotate, { x: originX, y: originY });
    const updates: TLShapePartial[] = [];
    for (const snap of this.shapes) {
      const { shape, pageTransform, parentInverse } = snap;
      const util = editor.getShapeUtil(shape);
      const pageOrigin = Mat.applyToPoint(pageTransform, snap.bounds.point);
      const inSel = Mat.applyToPoint(
        unrotate,
        Vec.Sub(pageOrigin, scaleOrigin),
      );
      const relRot = pageTransform.rotation() - this.rotation;
      const aligned = Math.abs(Math.sin(relRot * 2)) < 1e-6;
      const scaled = new Vec(inSel.x * sx, inSel.y * sy);
      const newPage = Vec.Add(scaleOrigin, Mat.applyToPoint(rotate, scaled));
      const newPoint = Mat.applyToPoint(parentInverse, newPage);
      if (!util.canResize(shape) || !util.onResize || !aligned) {
        if (
          shape === this.shapes[0].shape ||
          !editor.isAncestorSelected(shape)
        ) {
          updates.push({
            id: shape.id,
            type: shape.type,
            x: newPoint.x,
            y: newPoint.y,
          });
        }
        continue;
      }
      const swap = Math.abs(Math.sin(relRot)) > 0.5;
      const change = util.onResize(shape, {
        newPoint,
        handle,
        mode: 'resize_bounds',
        scaleX: swap ? sy : sx,
        scaleY: swap ? sx : sy,
        initialBounds: snap.bounds,
        initialShape: shape,
      });
      if (change) {
        updates.push(change);
      }
    }
    editor.updateShapes(updates);
  }

  override onPointerMove() {
    this.update();
  }

  override onKeyDown() {
    this.update();
  }

  override onKeyUp() {
    this.update();
  }

  override onPointerUp() {
    this.complete();
  }

  override onComplete() {
    this.complete();
  }

  private complete() {
    const { editor } = this;
    const ends: TLShapePartial[] = [];
    for (const { shape } of this.shapes) {
      const current = editor.getShape(shape.id);
      const change =
        current && editor.getShapeUtil(shape).onResizeEnd?.(shape, current);
      if (change) {
        ends.push(change);
      }
    }
    if (ends.length) {
      editor.updateShapes(ends);
    }
    if (this.info.isCreating) {
      const first = this.shapes[0]
        ? editor.getShape(this.shapes[0].shape.id)
        : undefined;
      this.info.onCreate?.(first ?? null);
      if (this.info.onCreate) {
        return;
      }
    }
    if (this.info.onInteractionEnd) {
      editor.setCurrentTool(this.info.onInteractionEnd);
    } else {
      this.parent.transition('idle');
    }
  }

  override onCancel() {
    this.editor.bailToMark(this.markId);
    if (this.info.onInteractionEnd) {
      this.editor.setCurrentTool(this.info.onInteractionEnd);
    } else {
      this.parent.transition('idle');
    }
  }
}

class Rotating extends StateNode {
  static override id = 'rotating';
  private markId = '';
  private center = new Vec();
  private startAngle = 0;
  private shapes: { shape: TLShape; pageTransform: Mat; parentInverse: Mat }[] =
    [];

  override onEnter(info: TLPointerEventInfo) {
    const { editor } = this;
    this.info = info;
    this.markId = editor.markHistoryStoppingPoint('rotating');
    const rotation = editor.getSelectionRotation();
    const b = editor.getSelectionRotatedPageBounds() ?? new Box();
    this.center = Mat.applyToPoint(Mat.Rotate(rotation), b.center);
    this.startAngle = Vec.Angle(this.center, editor.inputs.originPagePoint);
    this.shapes = editor
      .getSelectedShapes()
      .filter((s) => !editor.isAncestorSelected(s))
      .map((shape) => ({
        shape,
        pageTransform: editor.getShapePageTransform(shape),
        parentInverse: Mat.Inverse(editor.getShapeParentTransform(shape)),
      }));
    for (const { shape } of this.shapes) {
      const change = editor.getShapeUtil(shape).onRotateStart?.(shape);
      if (change) {
        editor.updateShape(change);
      }
    }
    this.update();
  }

  private update() {
    const { editor } = this;
    let delta =
      Vec.Angle(this.center, editor.inputs.currentPagePoint) - this.startAngle;
    if (editor.inputs.shiftKey) {
      const step = Math.PI / 12;
      delta = Math.round(delta / step) * step;
    }
    const rot = Mat.Rotate(delta, this.center.x, this.center.y);
    editor.updateShapes(
      this.shapes.map(({ shape, pageTransform, parentInverse }) => {
        const local = Mat.Multiply(
          parentInverse,
          Mat.Multiply(rot, pageTransform),
        ).decompose();
        return {
          id: shape.id,
          type: shape.type,
          x: local.x,
          y: local.y,
          rotation: local.rotation,
        };
      }),
    );
  }

  override onPointerMove() {
    this.update();
  }

  override onPointerUp() {
    const { editor } = this;
    for (const { shape } of this.shapes) {
      const current = editor.getShape(shape.id);
      const change =
        current && editor.getShapeUtil(shape).onRotateEnd?.(shape, current);
      if (change) {
        editor.updateShape(change);
      }
    }
    this.parent.transition('idle');
  }

  override onCancel() {
    this.editor.bailToMark(this.markId);
    this.parent.transition('idle');
  }
}

class EditingShape extends StateNode {
  static override id = 'editing_shape';

  override onEnter() {
    this.editor.setCursor({ type: 'default', rotation: 0 });
  }

  override onPointerDown(info: TLPointerEventInfo) {
    const { editor } = this;
    const editing = editor.getEditingShape();
    const hit = hitAtPointer(this);
    if (editing && hit?.id === editing.id) {
      return;
    }
    editor.setEditingShape(null);
    this.parent.transition('idle', info);
    this.parent.getCurrent()?.handleEvent(info);
  }

  override onCancel() {
    const { editor } = this;
    const editing = editor.getEditingShape();
    editor.setEditingShape(null);
    if (editing && editor.getShape(editing.id)) {
      editor.select(editing.id);
    }
    this.parent.transition('idle');
  }

  override onComplete() {
    this.onCancel();
  }

  override onExit() {
    this.editor.setEditingShape(null);
  }
}

export class SelectTool extends StateNode {
  static override id = 'select';
  static override initial = 'idle';
  static override children = () => [
    Idle,
    PointingCanvas,
    PointingShape,
    PointingSelection,
    Brushing,
    Translating,
    PointingResizeHandle,
    Resizing,
    PointingRotateHandle,
    Rotating,
    EditingShape,
  ];

  override onExit() {
    this.editor.setHoveredShape(null);
  }
}

export type { TLShapeId };
