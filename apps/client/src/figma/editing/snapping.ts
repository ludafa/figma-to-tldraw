import {
  computed,
  type Editor,
  type StateNode,
  type TLParentId,
  type TLShapeId,
} from 'tldraw';

import { isFigmaShape } from '../clip';
import type { FigmaShape } from '../shape-types';
import { type Axis, axisSizing, inFlow, isAutoLayout } from './auto-layout';
import { isGroup } from './engine';
import { figmaChildren, figmaParent } from './host';

// See apps/docs/figma-to-tldraw/tech.md §13.5.

function inAutoLayoutFlow(editor: Editor, shape: FigmaShape): boolean {
  const parent = figmaParent(editor, shape);
  return (
    !!parent && isAutoLayout(parent.props.node) && inFlow(shape.props.node)
  );
}

function hugs(editor: Editor, frame: FigmaShape, axis: Axis): boolean {
  const parent = figmaParent(editor, frame)?.props.node;
  return axisSizing(frame.props.node, axis, parent) === 'HUG';
}

const BOTH: Axis[] = ['x', 'y'];

/** Axes along which the drag changes the selected layers. */
function changingAxes(editor: Editor, selected: FigmaShape[]): Axis[] {
  if (!editor.isIn('select.resizing')) {
    return BOTH;
  }
  const handle = editor.getStateDescendant<
    StateNode & { info: { handle?: string } }
  >('select.resizing')?.info.handle;
  const reflows = selected.some(
    (s) =>
      s.type === 'figma-text' ||
      (isAutoLayout(s.props.node) && BOTH.some((a) => hugs(editor, s, a))),
  );
  if (reflows) {
    return BOTH;
  }
  if (handle === 'left' || handle === 'right') {
    return ['x'];
  }
  if (handle === 'top' || handle === 'bottom') {
    return ['y'];
  }
  return BOTH;
}

/**
 * While `changing` changes, auto layout moves `moved` (with everything inside)
 * and `resized` (groups and hugging frames around it) change their own bounds.
 */
function followers(editor: Editor, changing: FigmaShape[], axes: Axis[]) {
  const moved = new Set<TLShapeId>();
  const resized = new Set<TLShapeId>();
  let level = changing.map((shape) => ({ shape, axes }));
  while (level.length) {
    const next = new Map<TLShapeId, { shape: FigmaShape; axes: Axis[] }>();
    const grow = (shape: FigmaShape, more: Axis[]) => {
      const had = next.get(shape.id)?.axes ?? [];
      next.set(shape.id, {
        shape,
        axes: BOTH.filter((a) => had.includes(a) || more.includes(a)),
      });
    };
    for (const { shape, axes: changes } of level) {
      const parent = figmaParent(editor, shape);
      if (!parent) {
        continue;
      }
      if (isGroup(parent)) {
        grow(parent, changes);
        continue;
      }
      const node = parent.props.node;
      if (!isAutoLayout(node) || !inFlow(shape.props.node)) {
        continue;
      }
      const main: Axis = node.layoutMode === 'HORIZONTAL' ? 'x' : 'y';
      const cross: Axis = main === 'x' ? 'y' : 'x';
      const mainChanges = changes.includes(main);
      const crossChanges =
        changes.includes(cross) && hugs(editor, parent, cross);
      const align = node.primaryAxisAlignItems ?? 'MIN';
      const kids = figmaChildren(editor, parent.id).filter((c) =>
        inFlow(c.props.node),
      );
      const at = kids.findIndex((c) => c.id === shape.id);
      kids.forEach((kid, i) => {
        const shifts =
          mainChanges &&
          (align === 'MIN' ? i > at : align === 'MAX' ? i < at : true);
        const fills =
          mainChanges && axisSizing(kid.props.node, main, node) === 'FILL';
        const crossMoves =
          crossChanges &&
          ((node.counterAxisAlignItems ?? 'MIN') !== 'MIN' ||
            axisSizing(kid.props.node, cross, node) === 'FILL');
        if (i !== at && (shifts || fills || crossMoves)) {
          moved.add(kid.id);
        }
      });
      const grows = changes.filter((a) => hugs(editor, parent, a));
      if (grows.length) {
        grow(parent, grows);
      }
    }
    for (const id of next.keys()) {
      resized.add(id);
    }
    level = [...next.values()];
  }
  return { moved, resized };
}

function figmaSnappable(editor: Editor): Set<TLShapeId> | undefined {
  const selected = editor.getSelectedShapes();
  if (!selected.length || !selected.every(isFigmaShape)) {
    return undefined;
  }
  if (
    editor.isIn('select.translating') &&
    selected.some((s) => inAutoLayoutFlow(editor, s))
  ) {
    return new Set();
  }
  const { moved, resized } = followers(
    editor,
    selected,
    changingAxes(editor, selected),
  );
  for (const s of selected) {
    moved.add(s.id);
  }
  let container = editor.getShape(
    editor.findCommonAncestor(selected) ?? editor.getCurrentPageId(),
  );
  while (isFigmaShape(container) && isGroup(container)) {
    container = editor.getShape(container.parentId);
  }
  const view = editor.getViewportPageBounds();
  const out = new Set<TLShapeId>();
  if (isFigmaShape(container) && !resized.has(container.id)) {
    out.add(container.id);
  }
  const collect = (parentId: TLParentId) => {
    for (const id of editor.getSortedChildIdsForParent(parentId)) {
      const shape = editor.getShape(id);
      if (
        !shape ||
        moved.has(id) ||
        !editor.getShapeUtil(shape).canSnap(shape)
      ) {
        continue;
      }
      const bounds = editor.getShapePageBounds(id);
      if (!bounds || !view.includes(bounds)) {
        continue;
      }
      if (isFigmaShape(shape) && isGroup(shape)) {
        collect(id);
      } else if (!resized.has(id)) {
        out.add(id);
      }
    }
  };
  collect(container?.id ?? editor.getCurrentPageId());
  return out;
}

/** Snapping on by default, with Figma's snap targets. */
export function installFigmaSnapping(editor: Editor): () => void {
  editor.user.updateUserPreferences({ isSnapMode: true });
  const { snaps } = editor;
  const original = snaps.getSnappableShapes.bind(snaps);
  const snappable = computed(
    'figma snappable shapes',
    () => figmaSnappable(editor) ?? original(),
  );
  snaps.getSnappableShapes = () => snappable.get();
  return () => {
    snaps.getSnappableShapes = original;
  };
}
