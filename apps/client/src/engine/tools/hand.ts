import { StateNode, type TLPointerEventInfo } from './state-node';

// See apps/docs/skia-engine/tech.md §6.

class HandIdle extends StateNode {
  static override id = 'idle';

  override onEnter() {
    this.editor.setCursor({ type: 'grab', rotation: 0 });
  }

  override onPointerDown(info: TLPointerEventInfo) {
    this.parent.transition('dragging', info);
  }

  override onCancel() {
    this.editor.setCurrentTool('select');
  }
}

class HandDragging extends StateNode {
  static override id = 'dragging';

  override onEnter() {
    this.editor.setCursor({ type: 'grabbing', rotation: 0 });
  }

  override onPointerMove() {
    const { currentScreenPoint, previousScreenPoint } = this.editor.inputs;
    this.editor.pan({
      x: currentScreenPoint.x - previousScreenPoint.x,
      y: currentScreenPoint.y - previousScreenPoint.y,
    });
  }

  override onPointerUp() {
    this.parent.transition('idle');
  }

  override onCancel() {
    this.parent.transition('idle');
  }
}

export class HandTool extends StateNode {
  static override id = 'hand';
  static override initial = 'idle';
  static override children = () => [HandIdle, HandDragging];
}
