import type { Editor } from '../editor';
import type { CanvasController } from '../render/controller';
import { react } from '../state';
import type {
  TLModifiers,
  TLPointerEventInfo,
  TLPointerEventName,
  TLSelectionHandle,
} from '../tools/state-node';
import {
  matchKbd,
  type TLUiActionsContextType,
  type TLUiToolsContextType,
} from './actions';

// See apps/docs/skia-engine/tech.md §6.

const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform);

function modifiers(e: KeyboardEvent | PointerEvent | WheelEvent): TLModifiers {
  return {
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    ctrlKey: e.ctrlKey,
    metaKey: e.metaKey,
    accelKey: isMac ? e.metaKey : e.ctrlKey,
  };
}

function isEditable(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) {
    return false;
  }
  return (
    el.isContentEditable ||
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT'
  );
}

// See apps/docs/skia-engine/tech.md §6.5.
let keyboardEditor: Editor | null = null;

const CURSORS: Record<string, string> = {
  default: 'default',
  cross: 'crosshair',
  grab: 'grab',
  grabbing: 'grabbing',
  move: 'move',
  text: 'text',
  pointer: 'pointer',
  'nwse-resize': 'nwse-resize',
  'nesw-resize': 'nesw-resize',
  'ew-resize': 'ew-resize',
  'ns-resize': 'ns-resize',
  'nwse-rotate': 'grab',
  'nesw-rotate': 'grab',
  'senw-rotate': 'grab',
  'swne-rotate': 'grab',
};

export function cssCursor(type: string) {
  return CURSORS[type] ?? 'default';
}

const HANDLE_CURSORS: Record<TLSelectionHandle, string> = {
  top: 'ns-resize',
  bottom: 'ns-resize',
  left: 'ew-resize',
  right: 'ew-resize',
  top_left: 'nwse-resize',
  bottom_right: 'nwse-resize',
  top_right: 'nesw-resize',
  bottom_left: 'nesw-resize',
  top_left_rotate: 'nwse-rotate',
  top_right_rotate: 'nesw-rotate',
  bottom_left_rotate: 'swne-rotate',
  bottom_right_rotate: 'senw-rotate',
};

/** Wires pointer, wheel and keyboard events of the canvas to the editor. */
export function bindInput(
  editor: Editor,
  controller: CanvasController,
  container: HTMLElement,
  ui: { actions: TLUiActionsContextType; tools: TLUiToolsContextType },
): () => void {
  const canvas = controller.canvas;
  let spaceHeld = false;
  let panning: { id: number; x: number; y: number } | null = null;
  let cursorOverride: string | null = null;

  const viewportPoint = (e: { clientX: number; clientY: number }) => {
    const v = editor.getViewportScreenBounds();
    return { x: e.clientX - v.x, y: e.clientY - v.y };
  };

  const pointerInfo = (
    e: PointerEvent,
    name: TLPointerEventName,
  ): TLPointerEventInfo => {
    const handle =
      name === 'pointer_down' && editor.isIn('select.idle')
        ? controller.overlay.getHandleAt(viewportPoint(e))
        : null;
    return {
      type: 'pointer',
      name,
      target: handle ? 'selection' : 'canvas',
      handle: handle ?? undefined,
      point: { x: e.clientX, y: e.clientY, z: e.pressure },
      pointerId: e.pointerId,
      button: e.button,
      isPen: e.pointerType === 'pen',
      ...modifiers(e),
    };
  };

  const setCursorOverride = (cursor: string | null) => {
    if (cursor === cursorOverride) {
      return;
    }
    cursorOverride = cursor;
    container.style.cursor = cssCursor(
      cursor ?? editor.getInstanceState().cursor.type,
    );
  };

  const onPointerDown = (e: PointerEvent) => {
    if (e.target !== canvas) {
      return;
    }
    keyboardEditor = editor;
    if (
      !isEditable(document.activeElement) ||
      !container.contains(document.activeElement)
    ) {
      container.focus({ preventScroll: true });
    }
    editor.focus();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // See apps/docs/skia-engine/tech.md §6.5.
    }
    if (e.button === 1 || (spaceHeld && e.button === 0)) {
      e.preventDefault();
      panning = { id: e.pointerId, x: e.clientX, y: e.clientY };
      editor.inputs.isPanning = true;
      setCursorOverride('grabbing');
      return;
    }
    editor.dispatch(pointerInfo(e, 'pointer_down'));
    controller.requestFrame();
  };

  const onPointerMove = (e: PointerEvent) => {
    if (panning && e.pointerId === panning.id) {
      editor.pan({ x: e.clientX - panning.x, y: e.clientY - panning.y });
      panning.x = e.clientX;
      panning.y = e.clientY;
      return;
    }
    if (e.target !== canvas && !canvas.hasPointerCapture(e.pointerId)) {
      return;
    }
    editor.dispatch(pointerInfo(e, 'pointer_move'));
    if (!spaceHeld) {
      const handle =
        editor.isIn('select.idle') && !editor.inputs.isPointing
          ? controller.overlay.getHandleAt(viewportPoint(e))
          : null;
      setCursorOverride(handle ? HANDLE_CURSORS[handle] : null);
    }
    controller.requestFrame();
  };

  const onPointerUp = (e: PointerEvent) => {
    if (canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    if (panning && e.pointerId === panning.id) {
      panning = null;
      editor.inputs.isPanning = false;
      setCursorOverride(spaceHeld ? 'grab' : null);
      return;
    }
    editor.dispatch(pointerInfo(e, 'pointer_up'));
    controller.requestFrame();
  };

  const onWheel = (e: WheelEvent) => {
    if (!container.contains(e.target as Node) || e.target !== canvas) {
      return;
    }
    e.preventDefault();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    if (e.ctrlKey || e.metaKey) {
      const clamped = Math.max(-30, Math.min(30, dy));
      editor.zoomAt(viewportPoint(e), Math.exp(-clamped * 0.01));
    } else {
      editor.pan({ x: -dx, y: -dy });
    }
    editor.dispatch({
      type: 'wheel',
      name: 'wheel',
      delta: { x: -dx, y: -dy },
      point: { x: e.clientX, y: e.clientY },
      ...modifiers(e),
    });
  };

  const shouldHandleKey = (e: KeyboardEvent) => {
    if (isEditable(e.target)) {
      return false;
    }
    const active = document.activeElement;
    if (!active || active === document.body) {
      return keyboardEditor === null || keyboardEditor === editor;
    }
    return active === container || container.contains(active);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (!shouldHandleKey(e)) {
      return;
    }
    if (e.code === 'Space' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      if (!spaceHeld) {
        spaceHeld = true;
        setCursorOverride('grab');
      }
      return;
    }
    if (!e.repeat) {
      const readonly = editor.getInstanceState().isReadonly;
      for (const action of Object.values(ui.actions)) {
        if (
          action.kbd &&
          (!readonly || action.readonlyOk) &&
          matchKbd(action.kbd, e)
        ) {
          e.preventDefault();
          action.onSelect('kbd');
          controller.requestFrame();
          return;
        }
      }
      if (!readonly && !editor.getEditingShapeId()) {
        for (const tool of Object.values(ui.tools)) {
          if (tool.kbd && matchKbd(tool.kbd, e)) {
            e.preventDefault();
            tool.onSelect('kbd');
            return;
          }
        }
      }
    }
    if (
      [
        'Backspace',
        'Delete',
        'ArrowLeft',
        'ArrowRight',
        'ArrowUp',
        'ArrowDown',
      ].includes(e.key)
    ) {
      e.preventDefault();
    }
    editor.dispatch({
      type: 'keyboard',
      name: e.repeat ? 'key_repeat' : 'key_down',
      key: e.key,
      code: e.code,
      ...modifiers(e),
    });
    if (e.key === 'Escape') {
      editor.cancel();
    }
    controller.requestFrame();
  };

  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'Space' && spaceHeld) {
      spaceHeld = false;
      if (!panning) {
        setCursorOverride(null);
      }
      return;
    }
    if (!shouldHandleKey(e)) {
      return;
    }
    editor.dispatch({
      type: 'keyboard',
      name: 'key_up',
      key: e.key,
      code: e.code,
      ...modifiers(e),
    });
  };

  const onBlur = () => {
    spaceHeld = false;
    panning = null;
    setCursorOverride(null);
  };

  const onContextMenu = (e: MouseEvent) => {
    if (e.target === canvas) {
      e.preventDefault();
    }
  };

  const stopCursor = react('cursor', () => {
    const type = editor.getInstanceState().cursor.type;
    if (!cursorOverride) {
      container.style.cursor = cssCursor(type);
    }
  });

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerUp);
  container.addEventListener('pointercancel', onPointerUp);
  container.addEventListener('wheel', onWheel, { passive: false });
  container.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  return () => {
    stopCursor();
    container.removeEventListener('pointerdown', onPointerDown);
    container.removeEventListener('pointermove', onPointerMove);
    container.removeEventListener('pointerup', onPointerUp);
    container.removeEventListener('pointercancel', onPointerUp);
    container.removeEventListener('wheel', onWheel);
    container.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    if (keyboardEditor === editor) {
      keyboardEditor = null;
    }
  };
}
