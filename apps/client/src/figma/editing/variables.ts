import type {
  Editor,
  JsonValue,
  TLShapeId,
  TLShapePartial,
} from '../../engine';
import { type FigmaShape, isFigmaShape } from '../shape-types';
import type {
  FigmaNode,
  FigmaVariableModes,
  FigmaVariableValue,
  Snapshot,
} from '../types';
import {
  applyVariables,
  effectiveModes,
  type FigmaVariableSet,
  hasVariables,
  withCollectionValues,
} from '../variables';

// See apps/docs/figma-to-tldraw/tech.md §21.3.

const META_KEY = 'figmaVariables';

export function variableSetOf(snapshot: Snapshot): FigmaVariableSet | null {
  const v = snapshot.variables;
  return v && Object.keys(v.variables).length
    ? { collections: v.collections, variables: v.variables }
    : null;
}

export function readVariableSet(editor: Editor): FigmaVariableSet | undefined {
  const value = editor.getDocumentSettings().meta[META_KEY];
  return (value ?? undefined) as unknown as FigmaVariableSet | undefined;
}

export function writeVariableSet(editor: Editor, set: FigmaVariableSet | null) {
  const doc = editor.getDocumentSettings();
  editor.updateDocumentSettings({
    meta: { ...doc.meta, [META_KEY]: set as unknown as JsonValue },
  });
}

/** Sets one variable's value in one mode, as an undoable edit; library variables stay read-only. */
export function setVariableValue(
  editor: Editor,
  variableId: string,
  modeId: string,
  value: FigmaVariableValue,
) {
  const set = readVariableSet(editor);
  const variable = set?.variables[variableId];
  if (!set || !variable || variable.remote) {
    return;
  }
  writeVariableSet(editor, {
    ...set,
    variables: {
      ...set.variables,
      [variableId]: {
        ...variable,
        valuesByMode: { ...variable.valuesByMode, [modeId]: value },
      },
    },
  });
}

/** Gives collection `targetName` the values of collection `sourceName`, as one undoable edit; false when either is missing. */
export function copyCollectionValues(
  editor: Editor,
  targetName: string,
  sourceName: string,
): boolean {
  const set = readVariableSet(editor);
  const byName = (name: string) =>
    Object.values(set?.collections ?? {}).find((c) => c.name === name);
  const target = byName(targetName);
  const source = byName(sourceName);
  if (!set || !target || !source || target.remote) {
    return false;
  }
  writeVariableSet(editor, withCollectionValues(set, target.id, source.id));
  return true;
}

/** The Figma layers from the top down to `shape`. */
function figmaChain(editor: Editor, shape: FigmaShape): FigmaNode[] {
  const nodes = [shape.props.node];
  let parent = editor.getShape(shape.parentId as TLShapeId);
  while (isFigmaShape(parent)) {
    nodes.push(parent.props.node);
    parent = editor.getShape(parent.parentId as TLShapeId);
  }
  return nodes.reverse();
}

/** The modes `shape` gets from its parents, ignoring the ones it sets itself. */
export function inheritedShapeModes(
  editor: Editor,
  shape: FigmaShape,
): FigmaVariableModes {
  const chain = figmaChain(editor, shape);
  const { explicitVariableModes: _own, ...last } = chain.pop()!;
  return effectiveModes([...chain, last]);
}

export function shapeModes(
  editor: Editor,
  shape: FigmaShape,
): FigmaVariableModes {
  return effectiveModes(figmaChain(editor, shape));
}

/** Sets the mode a layer uses for one collection; `null` goes back to following its parent. */
export function setShapeMode(
  editor: Editor,
  shape: FigmaShape,
  collectionId: string,
  modeId: string | null,
) {
  const { explicitVariableModes, ...node } = shape.props.node;
  const { [collectionId]: _old, ...rest } = explicitVariableModes ?? {};
  const modes = modeId ? { ...rest, [collectionId]: modeId } : rest;
  editor.updateShape<FigmaShape>({
    id: shape.id,
    type: shape.type,
    props: {
      node: Object.keys(modes).length
        ? { ...node, explicitVariableModes: modes }
        : node,
    },
  });
}

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-6;
}

/** Rewrites the bound fields of `roots` (and everything inside them when `deep`) for their current modes. */
export function refreshVariables(
  editor: Editor,
  roots: Iterable<TLShapeId>,
  deep: boolean,
  quiet: (id: TLShapeId) => void,
): number {
  const set = readVariableSet(editor);
  if (!set) {
    return 0;
  }
  const updates: TLShapePartial<FigmaShape>[] = [];
  const seen = new Set<TLShapeId>();
  const visit = (shape: FigmaShape, above: FigmaNode[]) => {
    if (seen.has(shape.id)) {
      return;
    }
    seen.add(shape.id);
    const node = shape.props.node;
    const chain = [...above, node];
    if (hasVariables(node)) {
      const r = applyVariables(node, set, effectiveModes(chain));
      const props: Partial<FigmaShape['props']> = {};
      if (r.node !== node) {
        props.node = r.node;
      }
      if (r.w !== undefined && !near(r.w, shape.props.w)) {
        props.w = r.w;
      }
      if (r.h !== undefined && !near(r.h, shape.props.h)) {
        props.h = r.h;
      }
      const opacity =
        shape.type === 'figma-vector' ? shape.opacity : (r.node.opacity ?? 1);
      if (Object.keys(props).length || !near(opacity, shape.opacity)) {
        quiet(shape.id);
        updates.push({ id: shape.id, type: shape.type, opacity, props });
      }
    }
    if (deep) {
      for (const id of editor.getSortedChildIdsForParent(shape.id)) {
        const child = editor.getShape(id);
        if (isFigmaShape(child)) {
          visit(child, chain);
        }
      }
    }
  };
  for (const id of roots) {
    const shape = editor.getShape(id);
    if (isFigmaShape(shape)) {
      visit(shape, figmaChain(editor, shape).slice(0, -1));
    }
  }
  if (updates.length) {
    editor.updateShapes<FigmaShape>(updates);
  }
  return updates.length;
}

/** Every Figma layer with a bound field, on every page. */
export function boundShapeIds(editor: Editor): TLShapeId[] {
  const out: TLShapeId[] = [];
  for (const id of editor.store.shapeIds()) {
    const shape = editor.getShape(id);
    if (isFigmaShape(shape) && hasVariables(shape.props.node)) {
      out.push(id);
    }
  }
  return out;
}
