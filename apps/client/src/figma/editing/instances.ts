import {
  atom,
  type Atom,
  createShapeId,
  type Editor,
  react,
  type TLParentId,
  type TLShape,
  type TLShapeId,
  type TLShapePartial,
} from '../../engine';
import {
  copyId,
  nodeFieldsFor,
  propertyFields,
  same,
  stripI,
  SWAP_FIELDS,
  templateIdOf,
} from '../components';
import { isFigmaShape, type FigmaShape } from '../shape-types';
import type {
  FigmaComponentProperty,
  FigmaComponentPropertyDefinition,
  FigmaNode,
  FigmaOverride,
} from '../types';

// See apps/docs/figma-to-tldraw/tech.md §16.4.

const EPSILON = 1e-3;

function near(a: number, b: number): boolean {
  return Math.abs(a - b) < EPSILON;
}

function figmaParentOf(editor: Editor, shape: TLShape): FigmaShape | undefined {
  const parent = editor.getShape(shape.parentId as TLShapeId);
  return isFigmaShape(parent) ? parent : undefined;
}

export function isInstance(shape: TLShape | undefined): shape is FigmaShape {
  return isFigmaShape(shape) && shape.props.node.type === 'INSTANCE';
}

export function isMain(shape: TLShape | undefined): shape is FigmaShape {
  return isFigmaShape(shape) && shape.props.node.type === 'COMPONENT';
}

/** Components, component sets and instances get Figma's purple. */
export function isComponentLike(shape: TLShape | undefined): boolean {
  if (!isFigmaShape(shape)) {
    return false;
  }
  const { type } = shape.props.node;
  return (
    type === 'COMPONENT' || type === 'COMPONENT_SET' || type === 'INSTANCE'
  );
}

/** Instances around a layer, outermost first; the layer itself counts. */
export function instanceChain(editor: Editor, shape: TLShape): FigmaShape[] {
  const out: FigmaShape[] = [];
  for (let s: TLShape | undefined = shape; s;) {
    if (isInstance(s)) {
      out.unshift(s);
    }
    s = editor.getShape(s.parentId as TLShapeId);
  }
  return out;
}

/** Whether a layer's structure belongs to a main (it sits inside an instance). */
export function isInsideInstance(editor: Editor, shape: TLShape): boolean {
  for (let s = figmaParentOf(editor, shape); s; s = figmaParentOf(editor, s)) {
    if (isInstance(s)) {
      return true;
    }
  }
  return false;
}

/** The main component a layer is part of (itself included). */
export function mainAround(
  editor: Editor,
  shape: TLShape,
): FigmaShape | undefined {
  for (let s: TLShape | undefined = shape; s;) {
    if (isMain(s)) {
      return s;
    }
    s = editor.getShape(s.parentId as TLShapeId);
  }
  return undefined;
}

/** Every Figma layer on every page, by node id. */
export function shapesByNodeId(editor: Editor): Map<string, FigmaShape> {
  const out = new Map<string, FigmaShape>();
  for (const record of editor.store.query.records('shape').get()) {
    if (isFigmaShape(record) && !out.has(record.props.node.id)) {
      out.set(record.props.node.id, record);
    }
  }
  return out;
}

interface NodeIndex {
  ids: Map<string, Set<TLShapeId>>;
  /** Bumps when a node id appears or disappears, not on every edit. */
  version: Atom<number>;
}

const nodeIndexes = new WeakMap<Editor, NodeIndex>();

// See apps/docs/skia-engine/tech.md §10.6.
function nodeIndex(editor: Editor): NodeIndex {
  const hit = nodeIndexes.get(editor);
  if (hit) {
    return hit;
  }
  const index: NodeIndex = {
    ids: new Map(),
    version: atom('figma node index', 0),
  };
  const add = (s: TLShape) => {
    if (isFigmaShape(s)) {
      const key = s.props.node.id;
      const set = index.ids.get(key) ?? new Set();
      set.add(s.id);
      index.ids.set(key, set);
    }
  };
  const remove = (s: TLShape) => {
    if (isFigmaShape(s)) {
      const set = index.ids.get(s.props.node.id);
      set?.delete(s.id);
      if (set && !set.size) {
        index.ids.delete(s.props.node.id);
      }
    }
  };
  const bump = () => index.version.update((v) => v + 1);
  for (const r of editor.store.allRecords()) {
    if (r.typeName === 'shape') {
      add(r);
    }
  }
  editor.sideEffects.registerAfterCreateHandler('shape', (s) => {
    add(s);
    bump();
  });
  editor.sideEffects.registerAfterDeleteHandler('shape', (s) => {
    remove(s);
    bump();
  });
  editor.sideEffects.registerAfterChangeHandler('shape', (prev, next) => {
    if (
      isFigmaShape(prev) !== isFigmaShape(next) ||
      (isFigmaShape(prev) &&
        isFigmaShape(next) &&
        prev.props.node.id !== next.props.node.id)
    ) {
      remove(prev);
      add(next);
      bump();
    }
  });
  nodeIndexes.set(editor, index);
  return index;
}

/**
 * The layer for a Figma node id: the one in the same case as `near` when there
 * is one (several cases can share node ids), else the first one created.
 */
export function shapeByNodeId(
  editor: Editor,
  nodeId: string,
  near?: TLShape,
): FigmaShape | undefined {
  if (isFigmaShape(near)) {
    const own = `:${near.props.node.id}`;
    if (near.id.endsWith(own)) {
      const prefix = near.id.slice(0, -own.length);
      const same = editor.getShape(`${prefix}:${nodeId}` as TLShapeId);
      if (isFigmaShape(same) && same.props.node.id === nodeId) {
        return same;
      }
    }
  }
  const index = nodeIndex(editor);
  index.version.get();
  for (const id of index.ids.get(nodeId) ?? []) {
    const shape = editor.getShape(id);
    if (isFigmaShape(shape)) {
      return shape;
    }
  }
  return undefined;
}

export function mainOf(
  editor: Editor,
  instance: FigmaShape,
  byNode?: Map<string, FigmaShape>,
): FigmaShape | undefined {
  const id = instance.props.node.componentId;
  if (!id) {
    return undefined;
  }
  const main = byNode ? byNode.get(id) : shapeByNodeId(editor, id, instance);
  return isMain(main) ? main : undefined;
}

export function instancesOf(editor: Editor, mainNodeId: string): FigmaShape[] {
  return [...shapesByNodeId(editor).values()].filter(
    (s) => isInstance(s) && s.props.node.componentId === mainNodeId,
  );
}

/** The component set a variant sits in. */
export function componentSetOf(
  editor: Editor,
  main: FigmaShape,
): FigmaShape | undefined {
  const parent = figmaParentOf(editor, main);
  return parent?.props.node.type === 'COMPONENT_SET' ? parent : undefined;
}

/** `Size=md, State=Hover` → { Size: 'md', State: 'Hover' }. */
export function variantProps(name: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of name.split(',')) {
    const at = part.indexOf('=');
    if (at > 0) {
      out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
    }
  }
  return out;
}

export function propertyDefinitions(
  editor: Editor,
  main: FigmaShape,
): Record<string, FigmaComponentPropertyDefinition> {
  const set = componentSetOf(editor, main);
  return {
    ...set?.props.node.componentPropertyDefinitions,
    ...main.props.node.componentPropertyDefinitions,
  };
}

function defaultProperties(
  editor: Editor,
  main: FigmaShape,
): Record<string, FigmaComponentProperty> {
  const variant = variantProps(main.props.node.name);
  const out: Record<string, FigmaComponentProperty> = {};
  for (const [key, def] of Object.entries(propertyDefinitions(editor, main))) {
    const value =
      def.type === 'VARIANT' ? variant[key] : (def.defaultValue ?? '');
    if (value !== undefined) {
      out[key] = { type: def.type, value };
    }
  }
  return out;
}

/** Fields of a layer that an instance around it (or itself) overrides. */
export function overriddenFields(
  editor: Editor,
  layer: FigmaShape,
): Set<string> {
  const out = new Set<string>();
  for (const owner of instanceChain(editor, layer)) {
    for (const o of owner.props.node.overrides ?? []) {
      if (o.id === layer.props.node.id) {
        for (const f of o.overriddenFields) {
          for (const n of nodeFieldsFor(f)) {
            out.add(n);
          }
        }
      }
    }
  }
  return out;
}

// See apps/docs/figma-to-tldraw/tech.md §16.4.
function withFields(
  node: FigmaNode,
  fields: Record<string, unknown>,
): FigmaNode {
  const out: Record<string, unknown> = { ...node };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      delete out[key];
    } else {
      out[key] = value;
    }
  }
  return out as unknown as FigmaNode;
}

export function changedFields(a: FigmaNode, b: FigmaNode): string[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].filter(
    (k) =>
      k !== 'children' &&
      !same(a[k as keyof FigmaNode], b[k as keyof FigmaNode]),
  );
}

/** Node fields an edit inside an instance never records as an override. */
const NOT_OVERRIDES = new Set([
  'id',
  'type',
  'overrides',
  'componentId',
  'componentProperties',
  'componentPropertyDefinitions',
]);

/** Node fields a main never pushes to its instances. */
const NOT_SYNCED = new Set([
  ...NOT_OVERRIDES,
  'exposedInstances',
  'isExposedInstance',
]);

/** Node fields of an instance that stay when its main is swapped. */
const SLOT_FIELDS = [
  'absoluteBoundingBox',
  'absoluteRenderBounds',
  'relativeTransform',
  'size',
  'componentPropertyReferences',
  'isExposedInstance',
  'visible',
  'locked',
  'layoutAlign',
  'layoutGrow',
  'layoutPositioning',
  'layoutSizingHorizontal',
  'layoutSizingVertical',
  'constraints',
];

/** `list` with `fields` added to the entry for `id` (`list` itself if none are new). */
function withOverride(
  list: FigmaOverride[],
  id: string,
  fields: string[],
): FigmaOverride[] {
  const entry = list.find((o) => o.id === id);
  if (!entry) {
    return [...list, { id, overriddenFields: fields }];
  }
  const merged = [...new Set([...entry.overriddenFields, ...fields])];
  return merged.length === entry.overriddenFields.length
    ? list
    : list.map((o) => (o.id === id ? { ...o, overriddenFields: merged } : o));
}

/** Records the fields an edit changed on a layer inside an instance. */
export function recordOverride(
  editor: Editor,
  prev: FigmaShape,
  next: FigmaShape,
) {
  if (prev.props.node === next.props.node) {
    return;
  }
  const owner = instanceChain(editor, next)[0];
  if (!owner) {
    return;
  }
  const { node } = next.props;
  const fields = changedFields(prev.props.node, node).filter(
    (f) =>
      !NOT_OVERRIDES.has(f) &&
      // See apps/docs/figma-to-tldraw/tech.md §16.4.
      !(f === 'name' && node.name === node.characters),
  );
  if (!fields.length) {
    return;
  }
  const current = editor.getShape<FigmaShape>(owner.id)!;
  const list = current.props.node.overrides ?? [];
  const overrides = withOverride(list, node.id, fields);
  if (overrides === list) {
    return;
  }
  editor.updateShape<FigmaShape>({
    id: owner.id,
    type: owner.type,
    props: { node: { ...current.props.node, overrides } },
  });
}

// --- Main → instances --------------------------------------------------------

/** Edits to main components in one operation, flushed together. */
export interface MainEdits {
  /** Changed layers: the first `prev` this operation, and the main's node id. */
  changed: Map<TLShapeId, { prev: FigmaShape; main: string }>;
  created: Map<TLShapeId, string>;
  deleted: { shape: FigmaShape; main: string }[];
}

export function emptyMainEdits(): MainEdits {
  return { changed: new Map(), created: new Map(), deleted: [] };
}

export function hasMainEdits(edits: MainEdits): boolean {
  return !!(edits.changed.size || edits.created.size || edits.deleted.length);
}

const COPIED_PROPS = [
  'svg',
  'images',
  'imageSizes',
  'maskPath',
  'flipX',
] as const;

interface SyncHooks {
  /** Marks a write so it is not recorded as an override. */
  quiet: (id: TLShapeId) => void;
  deleteShapes: (ids: TLShapeId[]) => void;
  /** Moves a frame's children by their constraints, as if resized from `from`. */
  constrain: (frame: FigmaShape, from: { w: number; h: number }) => void;
}

/** The copy of a main's layer inside an instance (the instance for the root). */
function copyOf(
  byNode: Map<string, FigmaShape>,
  instance: FigmaShape,
  layer: FigmaNode,
  main: string,
): FigmaShape | undefined {
  return layer.id === main
    ? instance
    : byNode.get(copyId(instance.props.node.id, layer.id));
}

// See apps/docs/figma-to-tldraw/tech.md §16.4.
function followsOuterMain(
  editor: Editor,
  nested: FigmaShape,
  byNode: Map<string, FigmaShape>,
): boolean {
  const chain = instanceChain(editor, nested);
  const outer = chain[chain.length - 2];
  if (!outer) {
    return false;
  }
  const templateId = templateIdOf(outer.props.node.id, nested.props.node.id);
  const template = templateId ? byNode.get(templateId) : undefined;
  return (
    isInstance(template) &&
    template.props.node.componentId === nested.props.node.componentId &&
    mainAround(editor, template)?.props.node.id === outer.props.node.componentId
  );
}

/** Fields a nested instance's copies take from it when it is swapped or detached. */
const NESTED_FIELDS = ['type', ...SWAP_FIELDS] as const;

/** Pushes this operation's edits of main components to their instances. */
export function syncInstances(
  editor: Editor,
  edits: MainEdits,
  hooks: SyncHooks,
) {
  const byNode = shapesByNodeId(editor);
  const edited = new Set([
    ...[...edits.changed.values()].map((e) => e.main),
    ...edits.created.values(),
    ...edits.deleted.map((e) => e.main),
  ]);
  const instances = new Map<string, FigmaShape[]>();
  for (const s of byNode.values()) {
    const main = isInstance(s) ? s.props.node.componentId : undefined;
    if (main && edited.has(main) && !followsOuterMain(editor, s, byNode)) {
      instances.set(main, [...(instances.get(main) ?? []), s]);
    }
  }
  const fresh = (s: FigmaShape) => editor.getShape<FigmaShape>(s.id) ?? s;

  for (const [id, main] of edits.created) {
    const shape = editor.getShape<FigmaShape>(id);
    const parent = shape && figmaParentOf(editor, shape);
    if (!shape || !parent) {
      continue;
    }
    for (const inst of instances.get(main) ?? []) {
      const nodeId = copyId(inst.props.node.id, shape.props.node.id);
      const into = copyOf(byNode, inst, parent.props.node, main);
      if (!into || byNode.has(nodeId)) {
        continue;
      }
      const mask = shape.props.mask
        ? editor.getShape<FigmaShape>(shape.props.mask as TLShapeId)
        : undefined;
      const maskCopy = mask && copyOf(byNode, inst, mask.props.node, main);
      const copy: TLShapePartial<FigmaShape> = {
        id: createShapeId(),
        type: shape.type,
        parentId: into.id,
        index: shape.index,
        x: shape.x,
        y: shape.y,
        rotation: shape.rotation,
        opacity: shape.opacity,
        props: {
          ...shape.props,
          node: { ...shape.props.node, id: nodeId },
          mask: maskCopy?.id ?? '',
        },
      };
      hooks.quiet(copy.id);
      editor.createShape(copy);
      byNode.set(nodeId, editor.getShape<FigmaShape>(copy.id)!);
    }
  }

  for (const [id, { prev, main }] of edits.changed) {
    const next = editor.getShape<FigmaShape>(id);
    if (!next || edits.created.has(id)) {
      continue;
    }
    const fields = changedFields(prev.props.node, next.props.node).filter(
      (f) => !NOT_SYNCED.has(f),
    );
    const driven = new Set(propertyFields(next.props.node));
    const isRoot = next.props.node.id === main;
    const newParent = figmaParentOf(editor, next);
    const moved =
      !isRoot && (prev.parentId !== next.parentId || prev.index !== next.index);
    for (const inst of instances.get(main) ?? []) {
      const found = copyOf(byNode, inst, next.props.node, main);
      if (!found) {
        continue;
      }
      const target = fresh(found);
      const over = overriddenFields(editor, target);
      const patch: Record<string, unknown> = {};
      for (const f of fields) {
        const k = f as keyof FigmaNode;
        if (
          !over.has(f) &&
          !driven.has(f) &&
          !same(target.props.node[k], next.props.node[k])
        ) {
          patch[f] = next.props.node[k];
        }
      }
      if (!isRoot && isInstance(target)) {
        for (const f of NESTED_FIELDS) {
          if (
            !driven.has(f) &&
            same(target.props.node[f], prev.props.node[f]) &&
            !same(prev.props.node[f], next.props.node[f])
          ) {
            patch[f] = next.props.node[f];
          }
        }
      }
      const update: TLShapePartial<FigmaShape> = {
        id: target.id,
        type: target.type,
      };
      const props: Partial<FigmaShape['props']> = {};
      if (Object.keys(patch).length) {
        props.node = withFields(target.props.node, patch);
      }
      // See apps/docs/figma-to-tldraw/tech.md §16.4.
      if (
        near(target.props.w, prev.props.w) &&
        near(target.props.h, prev.props.h) &&
        (!near(prev.props.w, next.props.w) || !near(prev.props.h, next.props.h))
      ) {
        props.w = next.props.w;
        props.h = next.props.h;
      }
      for (const p of COPIED_PROPS) {
        if (
          same(target.props[p], prev.props[p]) &&
          !same(prev.props[p], next.props[p])
        ) {
          (props as Record<string, unknown>)[p] = next.props[p];
        }
      }
      if (!isRoot) {
        if (
          near(target.x, prev.x) &&
          near(target.y, prev.y) &&
          (!near(prev.x, next.x) || !near(prev.y, next.y))
        ) {
          update.x = next.x;
          update.y = next.y;
        }
        if (
          near(target.rotation, prev.rotation) &&
          !near(prev.rotation, next.rotation)
        ) {
          update.rotation = next.rotation;
        }
      }
      if (moved && newParent) {
        const into = copyOf(byNode, inst, newParent.props.node, main);
        if (into) {
          update.parentId = into.id;
          update.index = next.index;
          update.x = next.x;
          update.y = next.y;
        }
      }
      if (Object.keys(props).length) {
        update.props = props;
      }
      if (Object.keys(update).length > 2) {
        hooks.quiet(target.id);
        editor.updateShape(update);
      }
      // See apps/docs/figma-to-tldraw/tech.md §16.4.
      if (patch.componentProperties && !('componentId' in patch)) {
        const had = target.props.node.componentProperties ?? {};
        for (const [key, prop] of Object.entries(
          next.props.node.componentProperties ?? {},
        )) {
          if (prop.type !== 'VARIANT' && !same(had[key], prop)) {
            applyProperty(editor, fresh(target), key, prop.value, hooks);
          }
        }
      }
    }
  }

  const gone: TLShapeId[] = [];
  for (const { shape, main } of edits.deleted) {
    for (const inst of instances.get(main) ?? []) {
      const copy = byNode.get(copyId(inst.props.node.id, shape.props.node.id));
      if (copy && editor.getShape(copy.id)) {
        gone.push(copy.id);
      }
    }
  }
  if (gone.length) {
    hooks.deleteShapes(gone);
  }
}

// --- Instance operations ----------------------------------------------------

let counter = 0;

/** A node id that will not collide with Figma's `12:34` ids. */
export function newNodeId(): string {
  counter++;
  return `n${Date.now().toString(36)}:${counter}`;
}

/** Copies of a main's layers (not the main itself) for an instance. */
function cloneLayers(
  editor: Editor,
  main: FigmaShape,
  instanceNodeId: string,
  parentId: TLParentId,
): TLShapePartial<FigmaShape>[] {
  const ids = new Map<string, TLShapeId>();
  const out: TLShapePartial<FigmaShape>[] = [];
  const walk = (from: FigmaShape, into: TLParentId) => {
    for (const childId of editor.getSortedChildIdsForParent(from.id)) {
      const child = editor.getShape(childId);
      if (!isFigmaShape(child)) {
        continue;
      }
      const id = createShapeId();
      ids.set(child.id, id);
      out.push({
        id,
        type: child.type,
        parentId: into,
        index: child.index,
        x: child.x,
        y: child.y,
        rotation: child.rotation,
        opacity: child.opacity,
        props: {
          ...child.props,
          node: {
            ...child.props.node,
            id: copyId(instanceNodeId, child.props.node.id),
          },
        },
      });
      walk(child, id);
    }
  };
  walk(main, parentId);
  for (const s of out) {
    if (s.props?.mask) {
      s.props.mask = ids.get(s.props.mask) ?? '';
    }
  }
  return out;
}

function instanceNode(
  editor: Editor,
  main: FigmaShape,
  id: string,
  name = main.props.node.name,
): FigmaNode {
  const {
    componentPropertyDefinitions: _defs,
    children: _children,
    ...rest
  } = main.props.node;
  const set = componentSetOf(editor, main);
  return {
    ...rest,
    id,
    name: set && name === main.props.node.name ? set.props.node.name : name,
    type: 'INSTANCE',
    componentId: main.props.node.id,
    componentProperties: defaultProperties(editor, main),
    overrides: [],
  };
}

/** Places a new instance of a main next to it and selects it. */
export function createInstance(editor: Editor, main: FigmaShape): TLShapeId {
  const id = createShapeId();
  const nodeId = newNodeId();
  const page = editor.getShapePageBounds(main.id)!;
  editor.markHistoryStoppingPoint('create instance');
  editor.run(() => {
    editor.createShape<FigmaShape>({
      id,
      type: main.type,
      x: page.maxX + 40,
      y: page.minY,
      opacity: main.opacity,
      props: { ...main.props, node: instanceNode(editor, main, nodeId) },
    });
    editor.createShapes(cloneLayers(editor, main, nodeId, id));
    editor.select(id);
  });
  return id;
}

/** Name paths below an instance, for carrying overrides across a swap. */
function namePaths(editor: Editor, root: FigmaShape): Map<string, FigmaShape> {
  const out = new Map<string, FigmaShape>();
  const walk = (s: FigmaShape, path: string) => {
    for (const id of editor.getSortedChildIdsForParent(s.id)) {
      const child = editor.getShape(id);
      if (isFigmaShape(child)) {
        const p = `${path}/${child.props.node.name}`;
        if (!out.has(p)) {
          out.set(p, child);
        }
        walk(child, p);
      }
    }
  };
  walk(root, '');
  return out;
}

/**
 * Rebuilds an instance's layers from another main (a variant switch, an
 * instance swap, or a reset). Overrides follow layers with the same name path.
 */
export function swapMain(
  editor: Editor,
  instance: FigmaShape,
  main: FigmaShape,
  hooks: SyncHooks,
  keepOverrides = true,
) {
  const owner = instanceChain(editor, instance)[0] ?? instance;
  const oldMain = mainOf(editor, instance);
  const carried = new Map<string, Record<string, unknown>>();
  if (keepOverrides) {
    for (const [path, layer] of namePaths(editor, instance)) {
      const fields = overriddenFields(editor, layer);
      if (fields.size) {
        carried.set(
          path,
          Object.fromEntries(
            [...fields].map((f) => [f, layer.props.node[f as keyof FigmaNode]]),
          ),
        );
      }
    }
  }
  const oldPrefix = `I${stripI(instance.props.node.id)};`;
  hooks.deleteShapes([...editor.getSortedChildIdsForParent(instance.id)]);
  const layers = cloneLayers(editor, main, instance.props.node.id, instance.id);
  for (const s of layers) {
    hooks.quiet(s.id);
  }
  editor.createShapes(layers);

  const recorded: FigmaOverride[] = [];
  for (const [path, layer] of namePaths(editor, instance)) {
    const values = carried.get(path);
    if (!values) {
      continue;
    }
    hooks.quiet(layer.id);
    editor.updateShape<FigmaShape>({
      id: layer.id,
      type: layer.type,
      props: { node: withFields(layer.props.node, values) },
    });
    recorded.push({
      id: layer.props.node.id,
      overriddenFields: Object.keys(values),
    });
  }

  const current = editor.getShape<FigmaShape>(instance.id)!;
  const followsSize =
    !oldMain ||
    (near(current.props.w, oldMain.props.w) &&
      near(current.props.h, oldMain.props.h));
  const variant = variantProps(main.props.node.name);
  const properties = { ...current.props.node.componentProperties };
  for (const [key, value] of Object.entries(variant)) {
    if (properties[key]?.type === 'VARIANT') {
      properties[key] = { ...properties[key], value };
    }
  }
  // See apps/docs/figma-to-tldraw/tech.md §16.4.
  const was = current.props.node as unknown as Record<string, unknown>;
  const before = oldMain?.props.node as unknown as
    | Record<string, unknown>
    | undefined;
  const own = overriddenFields(editor, current);
  const templateId =
    owner.id === instance.id
      ? undefined
      : templateIdOf(owner.props.node.id, current.props.node.id);
  const template = templateId
    ? (shapesByNodeId(editor).get(templateId)?.props.node as unknown as
        | Record<string, unknown>
        | undefined)
    : undefined;
  const kept: Record<string, unknown> = {};
  for (const f of SLOT_FIELDS) {
    kept[f] = !keepOverrides && own.has(f) && template ? template[f] : was[f];
  }
  if (keepOverrides) {
    for (const k of new Set([
      ...Object.keys(was),
      ...Object.keys(before ?? {}),
    ])) {
      if (
        k !== 'children' &&
        !NOT_SYNCED.has(k) &&
        (own.has(k) || !before || !same(was[k], before[k]))
      ) {
        kept[k] = was[k];
      }
    }
  }
  const node = withFields(
    {
      ...instanceNode(
        editor,
        main,
        current.props.node.id,
        current.props.node.name,
      ),
      componentProperties: properties,
      overrides: keepOverrides ? (current.props.node.overrides ?? []) : [],
    },
    kept,
  );
  const keep = (o: FigmaOverride) =>
    o.id === current.props.node.id
      ? keepOverrides
      : !o.id.startsWith(oldPrefix);
  if (owner.id === instance.id) {
    node.overrides = [
      ...(keepOverrides ? (node.overrides ?? []).filter(keep) : []),
      ...recorded,
    ];
  }
  hooks.quiet(instance.id);
  editor.updateShape<FigmaShape>({
    id: instance.id,
    type: instance.type,
    props: {
      node,
      ...(followsSize ? { w: main.props.w, h: main.props.h } : {}),
    },
  });
  // See apps/docs/figma-to-tldraw/tech.md §16.4.
  const placed = editor.getShape<FigmaShape>(instance.id)!;
  if (
    !near(placed.props.w, main.props.w) ||
    !near(placed.props.h, main.props.h)
  ) {
    hooks.constrain(placed, { w: main.props.w, h: main.props.h });
  }
  if (owner.id !== instance.id) {
    const o = editor.getShape<FigmaShape>(owner.id)!;
    hooks.quiet(owner.id);
    editor.updateShape<FigmaShape>({
      id: owner.id,
      type: owner.type,
      props: {
        node: {
          ...o.props.node,
          overrides: [
            ...(o.props.node.overrides ?? []).filter(keep),
            ...recorded,
          ],
        },
      },
    });
  }
}

/** Sets one component property on an instance and applies it to its layers. */
export function setProperty(
  editor: Editor,
  instance: FigmaShape,
  key: string,
  value: string | boolean,
  hooks: SyncHooks,
) {
  const node = instance.props.node;
  const prop = node.componentProperties?.[key];
  if (!prop) {
    return;
  }
  if (prop.type === 'VARIANT') {
    const main = mainOf(editor, instance);
    const set = main && componentSetOf(editor, main);
    if (!main || !set) {
      return;
    }
    const want = {
      ...variantProps(main.props.node.name),
      [key]: String(value),
    };
    const variants = editor
      .getSortedChildIdsForParent(set.id)
      .map((id) => editor.getShape(id))
      .filter(isMain);
    const score = (v: FigmaShape) => {
      const got = variantProps(v.props.node.name);
      return Object.entries(want).filter(([k, x]) => got[k] === x).length;
    };
    const exact = variants.filter(
      (v) => variantProps(v.props.node.name)[key] === String(value),
    );
    const target = exact.sort((a, b) => score(b) - score(a))[0];
    if (target && target.id !== main.id) {
      swapMain(editor, instance, target, hooks);
    }
    return;
  }
  hooks.quiet(instance.id);
  editor.updateShape<FigmaShape>({
    id: instance.id,
    type: instance.type,
    props: {
      node: {
        ...node,
        componentProperties: {
          ...node.componentProperties,
          [key]: { ...prop, value },
        },
      },
    },
  });
  applyProperty(editor, instance, key, value, hooks);
}

function applyProperty(
  editor: Editor,
  instance: FigmaShape,
  key: string,
  value: string | boolean,
  hooks: SyncHooks,
) {
  const byNode = shapesByNodeId(editor);
  for (const id of editor.getShapeAndDescendantIds([instance.id])) {
    const layer = editor.getShape(id);
    const refs = isFigmaShape(layer)
      ? layer.props.node.componentPropertyReferences
      : undefined;
    if (!isFigmaShape(layer) || !refs || layer.id === instance.id) {
      continue;
    }
    const node = { ...layer.props.node };
    if (refs.visible === key) {
      node.visible = value === true;
    }
    if (refs.characters === key) {
      node.characters = String(value);
    }
    if (refs.mainComponent === key) {
      const main = byNode.get(String(value));
      if (
        isMain(main) &&
        isInstance(layer) &&
        layer.props.node.componentId !== main.props.node.id
      ) {
        swapMain(editor, layer, main, hooks, false);
      }
      continue;
    }
    if (
      node.visible !== layer.props.node.visible ||
      node.characters !== layer.props.node.characters
    ) {
      hooks.quiet(layer.id);
      editor.updateShape<FigmaShape>({
        id: layer.id,
        type: layer.type,
        props: { node },
      });
    }
  }
}

/** Puts an instance back to its main, keeping its place and property values. */
export function resetInstance(
  editor: Editor,
  instance: FigmaShape,
  hooks: SyncHooks,
) {
  const main = mainOf(editor, instance);
  if (!main) {
    return;
  }
  swapMain(editor, instance, main, hooks, false);
  const props =
    editor.getShape<FigmaShape>(instance.id)!.props.node.componentProperties ??
    {};
  for (const [key, prop] of Object.entries(
    instance.props.node.componentProperties ?? {},
  )) {
    if (prop.type !== 'VARIANT' && props[key]) {
      applyProperty(
        editor,
        editor.getShape<FigmaShape>(instance.id)!,
        key,
        prop.value,
        hooks,
      );
    }
  }
}

/** Turns an instance into a plain frame; nested instances stay instances. */
export function detachInstance(editor: Editor, instance: FigmaShape) {
  const {
    componentId: _id,
    componentProperties: _props,
    overrides = [],
    ...node
  } = instance.props.node;
  // See apps/docs/figma-to-tldraw/tech.md §16.4.
  const byNode = shapesByNodeId(editor);
  const moved = new Map<TLShapeId, FigmaOverride[]>();
  const give = (id: TLShapeId, list: FigmaOverride[]) =>
    moved.set(id, [...(moved.get(id) ?? []), ...list]);
  if (instanceChain(editor, instance).length === 1) {
    for (const id of editor.getShapeAndDescendantIds([instance.id])) {
      const nested = editor.getShape(id);
      if (!isInstance(nested) || instanceChain(editor, nested).length !== 2) {
        continue;
      }
      const templateId = templateIdOf(node.id, nested.props.node.id);
      const template = templateId ? byNode.get(templateId) : undefined;
      if (
        isInstance(template) &&
        template.props.node.componentId === nested.props.node.componentId
      ) {
        give(
          nested.id,
          (template.props.node.overrides ?? []).map((o) => ({
            ...o,
            id: copyId(node.id, o.id),
          })),
        );
      }
    }
  }
  editor.updateShape<FigmaShape>({
    id: instance.id,
    type: instance.type,
    props: { node: { ...node, type: 'FRAME' } },
  });
  for (const o of overrides) {
    const layer = byNode.get(o.id);
    const owner = layer && instanceChain(editor, layer)[0];
    if (owner) {
      give(owner.id, [o]);
    }
  }
  for (const [id, list] of moved) {
    const owner = editor.getShape<FigmaShape>(id)!;
    const merged = list.reduce(
      (acc, o) => withOverride(acc, o.id, o.overriddenFields),
      owner.props.node.overrides ?? [],
    );
    editor.updateShape<FigmaShape>({
      id,
      type: owner.type,
      props: { node: { ...owner.props.node, overrides: merged } },
    });
  }
}

/** Turns frames into main components. */
export function createComponents(editor: Editor, shapes: FigmaShape[]) {
  editor.updateShapes(
    shapes.map((s) => ({
      id: s.id,
      type: s.type,
      props: { node: { ...s.props.node, type: 'COMPONENT' } },
    })),
  );
}

export function canBecomeComponent(editor: Editor, shape: FigmaShape): boolean {
  return (
    shape.type === 'figma-frame' &&
    shape.props.node.type === 'FRAME' &&
    !isInsideInstance(editor, shape) &&
    !mainAround(editor, shape)
  );
}

/** Shows a main component: switches to its page and selects it. */
export function goToMain(editor: Editor, instance: FigmaShape) {
  const main = mainOf(editor, instance);
  if (!main) {
    return;
  }
  editor.setCurrentPage(editor.getAncestorPageId(main.id)!);
  editor.select(main.id);
  editor.zoomToSelection({ animation: { duration: 200 } });
}

// --- Copy and paste ----------------------------------------------------------

/** New node ids handed out in one `createShapes` call, old id → new id. */
export interface Renames {
  ids: Map<string, string>;
  /** Pasted mains that became instances: new shape id → instance node id. */
  instances: Map<TLShapeId, string>;
  used?: Set<string>;
}

export function emptyRenames(): Renames {
  return { ids: new Map(), instances: new Map() };
}

function renamed(id: string, renames: Renames): string | undefined {
  if (!id.startsWith('I')) {
    return renames.ids.get(id);
  }
  const parts = id.slice(1).split(';');
  for (let n = parts.length - 1; n >= 1; n--) {
    const head = n === 1 ? parts[0] : `I${parts.slice(0, n).join(';')}`;
    const to = renames.ids.get(head);
    if (to) {
      return copyId(to, parts.slice(n).join(';'));
    }
  }
  return undefined;
}

/**
 * Gives a pasted or duplicated layer a node id of its own, so overrides and
 * main lookups keep pointing at the right layers. A pasted main becomes an
 * instance of it.
 */
export function renameOnCreate(
  editor: Editor,
  shape: FigmaShape,
  renames: Renames,
): FigmaShape {
  const used = (renames.used ??= new Set(shapesByNodeId(editor).keys()));
  const old = shape.props.node.id;
  let node = shape.props.node;
  let into: string | undefined;
  for (let p = editor.getShape(shape.parentId as TLShapeId); p && !into;) {
    into = renames.instances.get(p.id);
    p = editor.getShape(p.parentId as TLShapeId);
  }
  const mapped = into ? copyId(into, old) : renamed(old, renames);
  const to =
    mapped && !used.has(mapped)
      ? mapped
      : used.has(old)
        ? newNodeId()
        : undefined;
  if (!to) {
    used.add(old);
    return shape;
  }
  renames.ids.set(old, to);
  used.add(to);
  if (node.type === 'COMPONENT' && !into) {
    const main = shapesByNodeId(editor).get(old);
    if (isMain(main)) {
      node = instanceNode(editor, main, to, node.name);
      renames.instances.set(shape.id, to);
    }
  }
  node = { ...node, id: to };
  if (node.overrides?.length) {
    node.overrides = node.overrides.map((o) => ({
      ...o,
      id: renamed(o.id, renames) ?? o.id,
    }));
  }
  return { ...shape, props: { ...shape.props, node } };
}

/** Purple selection for components, component sets and instances. */
export function installComponentColors(editor: Editor): () => void {
  const container = editor.getContainer();
  return react('figma component selection', () => {
    const selected = editor.getSelectedShapes();
    container.classList.toggle(
      'figma-component-selected',
      selected.length > 0 && selected.every(isComponentLike),
    );
  });
}
