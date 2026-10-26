import {
  ArrowToolbarItem,
  DefaultToolbar,
  DrawToolbarItem,
  type Editor,
  HandToolbarItem,
  SelectToolbarItem,
  StateNode,
  type TLPointerEventInfo,
  type TLShapeId,
  type TLStateNodeConstructor,
  type TLUiOverrides,
  ToolbarItem,
} from 'tldraw';

import { isFigmaShape } from '../clip';
import {
  createLayer,
  DEFAULT_SIZE,
  finishLayer,
  type NewLayerKind,
} from './create';
import { canBecomeComponent, createComponents } from './instances';

// See apps/docs/figma-to-tldraw/tech.md §14.1.

const FIGMA_TOOLS: {
  id: string;
  kind: NewLayerKind;
  label: string;
  icon: string;
  kbd: string;
}[] = [
  {
    id: 'figma-frame',
    kind: 'FRAME',
    label: 'tool.frame',
    icon: 'tool-frame',
    kbd: 'f',
  },
  {
    id: 'figma-rectangle',
    kind: 'RECTANGLE',
    label: 'tool.rectangle',
    icon: 'geo-rectangle',
    kbd: 'r',
  },
  {
    id: 'figma-ellipse',
    kind: 'ELLIPSE',
    label: 'tool.ellipse',
    icon: 'geo-ellipse',
    kbd: 'o',
  },
  {
    id: 'figma-text',
    kind: 'TEXT',
    label: 'tool.text',
    icon: 'tool-text',
    kbd: 't',
  },
];

/** tldraw's own tools kept in the toolbar and on their keys (user's call). */
const KEPT_TOOLS = new Set(['select', 'hand', 'draw', 'arrow']);

function kindOf(state: StateNode): NewLayerKind {
  return FIGMA_TOOLS.find((t) => t.id === state.id)!.kind;
}

/** Selects the new layer; a text layer goes straight into editing. */
function done(editor: Editor, id: TLShapeId, kind: NewLayerKind) {
  finishLayer(editor, id);
  if (!editor.getShape(id)) {
    editor.setCurrentTool('select');
    return;
  }
  editor.select(id);
  if (kind === 'TEXT') {
    editor.setEditingShape(id);
  } else {
    editor.setCurrentTool('select.idle');
  }
}

class Idle extends StateNode {
  static override id = 'idle';

  override onEnter() {
    this.editor.setCursor({ type: 'cross', rotation: 0 });
  }

  override onPointerDown(info: TLPointerEventInfo) {
    this.parent.transition('pointing', info);
  }

  override onCancel() {
    this.editor.setCurrentTool('select');
  }
}

class Pointing extends StateNode {
  static override id = 'pointing';

  override onPointerMove(info: TLPointerEventInfo) {
    const { editor } = this;
    if (!editor.inputs.isDragging) {
      return;
    }
    const kind = kindOf(this.parent);
    const markId = editor.markHistoryStoppingPoint('create figma layer');
    const id = createLayer(editor, kind, editor.inputs.originPagePoint, {
      w: 1,
      h: 1,
    });
    editor.select(id);
    editor.setCurrentTool('select.resizing', {
      ...info,
      target: 'selection',
      handle: kind === 'TEXT' ? 'right' : 'bottom_right',
      isCreating: true,
      creatingMarkId: markId,
      creationCursorOffset: { x: 1, y: 1 },
      onInteractionEnd: this.parent.id,
      onCreate: () => done(editor, id, kind),
    });
  }

  override onPointerUp() {
    const { editor } = this;
    const kind = kindOf(this.parent);
    const point = editor.inputs.originPagePoint;
    if (kind === 'TEXT') {
      const hit = editor.getShapeAtPoint(point, {
        hitInside: true,
        renderingOnly: true,
      });
      if (hit?.type === 'figma-text') {
        editor.select(hit.id);
        editor.setEditingShape(hit.id);
        return;
      }
    }
    editor.markHistoryStoppingPoint('create figma layer');
    const id = createLayer(editor, kind, point, {
      w: kind === 'TEXT' ? 1 : DEFAULT_SIZE,
      h: DEFAULT_SIZE,
    });
    done(editor, id, kind);
  }

  override onCancel() {
    this.parent.transition('idle');
  }

  override onInterrupt() {
    this.parent.transition('idle');
  }
}

export const figmaTools: TLStateNodeConstructor[] = FIGMA_TOOLS.map(
  (tool) =>
    class extends StateNode {
      static override id = tool.id;
      static override initial = 'idle';
      static override children = () => [Idle, Pointing];
    },
);

export const figmaUiOverrides: TLUiOverrides = {
  tools(editor, tools) {
    for (const [id, tool] of Object.entries(tools)) {
      if (!KEPT_TOOLS.has(id)) {
        tools[id] = { ...tool, kbd: undefined };
      }
    }
    for (const tool of FIGMA_TOOLS) {
      tools[tool.id] = {
        id: tool.id,
        label: tool.label,
        icon: tool.icon,
        kbd: tool.kbd,
        onSelect: () => editor.setCurrentTool(tool.id),
      };
    }
    return tools;
  },
  // See apps/docs/figma-to-tldraw/tech.md §16.5.
  actions(editor, actions) {
    actions['figma-create-component'] = {
      id: 'figma-create-component',
      label: 'action.create-component',
      kbd: 'cmd+alt+k,ctrl+alt+k',
      onSelect() {
        const shapes = editor.getSelectedShapes();
        if (
          shapes.length &&
          shapes.every((s) => isFigmaShape(s) && canBecomeComponent(editor, s))
        ) {
          editor.markHistoryStoppingPoint('create component');
          createComponents(editor, shapes.filter(isFigmaShape));
        }
      },
    };
    return actions;
  },
};

export function FigmaToolbar() {
  return (
    <DefaultToolbar>
      <SelectToolbarItem />
      <HandToolbarItem />
      {FIGMA_TOOLS.map((tool) => (
        <ToolbarItem key={tool.id} tool={tool.id} />
      ))}
      <DrawToolbarItem />
      <ArrowToolbarItem />
    </DefaultToolbar>
  );
}
