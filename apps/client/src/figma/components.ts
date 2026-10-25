import type { FigmaNode, FigmaOverride, Snapshot } from './types';

// See apps/docs/figma-to-tldraw/tech.md §16.2.

export function stripI(id: string): string {
  return id.startsWith('I') ? id.slice(1) : id;
}

/** Id of an instance's copy of `templateId`, a layer inside its main. */
export function copyId(instanceId: string, templateId: string): string {
  return `I${stripI(instanceId)};${stripI(templateId)}`;
}

/** The layer inside the main that an instance's layer copies. */
export function templateIdOf(
  instanceId: string,
  layerId: string,
): string | undefined {
  const prefix = `I${stripI(instanceId)};`;
  if (!layerId.startsWith(prefix)) {
    return undefined;
  }
  const rest = layerId.slice(prefix.length);
  return rest.includes(';') ? `I${rest}` : rest;
}

export function walk(node: FigmaNode, fn: (node: FigmaNode) => void) {
  fn(node);
  for (const child of node.children ?? []) {
    walk(child, fn);
  }
}

/** Every main component in a snapshot, by node id. */
export function indexMains(snapshot: Snapshot): Map<string, FigmaNode> {
  const mains = new Map<string, FigmaNode>();
  const add = (root: FigmaNode) =>
    walk(root, (n) => {
      if (n.type === 'COMPONENT') {
        mains.set(n.id, n);
      }
    });
  for (const root of Object.values(snapshot.mains ?? {})) {
    add(root);
  }
  add(snapshot.rest.document);
  return mains;
}

/** Fields that place a layer rather than style it; an instance keeps its own. */
const PLACEMENT = new Set([
  'absoluteBoundingBox',
  'absoluteRenderBounds',
  'relativeTransform',
  'size',
]);

/** Fields that are not compared or copied from the main. */
const IGNORED = new Set([
  'id',
  'children',
  'overrides',
  'exposedInstances',
  'isExposedInstance',
  'componentPropertyDefinitions',
  'interactions',
  'transitionNodeID',
  'transitionDuration',
  'transitionEasing',
  'scrollBehavior',
  'pluginData',
  'sharedPluginData',
  'boundVariables',
  'background',
  'backgroundColor',
  'layoutVersion',
  ...PLACEMENT,
]);

const TEXT_CONTENT = [
  'characters',
  'characterStyleOverrides',
  'styleOverrideTable',
  'lineTypes',
  'lineIndentations',
];

const TEXT_STYLE = new Set([
  'text',
  'inheritTextStyleId',
  'fontFamily',
  'fontPostScriptName',
  'fontWeight',
  'fontSize',
  'italic',
  'letterSpacing',
  'lineHeightPx',
  'lineHeightPercent',
  'lineHeightPercentFontSize',
  'lineHeightUnit',
  'paragraphSpacing',
  'paragraphIndent',
  'textAutoResize',
  'textAlignHorizontal',
  'textAlignVertical',
  'textDecoration',
  'textCase',
  'hyperlink',
  'openTypeFlags',
  'listSpacing',
  'leadingTrim',
]);

const RADII = [
  'topLeftRadius',
  'topRightRadius',
  'bottomLeftRadius',
  'bottomRightRadius',
];

/** Node fields that one of Figma's `overriddenFields` names covers. */
export function nodeFieldsFor(field: string): string[] {
  if (TEXT_STYLE.has(field)) {
    return ['style', 'styleOverrideTable', 'styles'];
  }
  if (TEXT_CONTENT.includes(field)) {
    return TEXT_CONTENT;
  }
  if (RADII.includes(field) || field === 'cornerRadius') {
    return ['cornerRadius', 'rectangleCornerRadii'];
  }
  switch (field) {
    case 'fills':
    case 'inheritFillStyleId':
      return ['fills', 'styles'];
    case 'strokes':
    case 'inheritStrokeStyleId':
      return ['strokes', 'styles'];
    case 'effects':
    case 'inheritEffectStyleId':
      return ['effects', 'styles'];
    case 'inheritGridStyleId':
    case 'grid':
      return ['layoutGrids', 'styles'];
    case 'width':
    case 'height':
      return ['layoutSizingHorizontal', 'layoutSizingVertical'];
    default:
      return [field];
  }
}

/** Fields a component property drives on a layer. */
export function propertyFields(node: FigmaNode): string[] {
  const refs = node.componentPropertyReferences ?? {};
  const out: string[] = [];
  if (refs.visible) {
    out.push('visible');
  }
  if (refs.characters) {
    out.push(...TEXT_CONTENT);
  }
  if (refs.mainComponent) {
    out.push('componentId', 'componentProperties', 'name');
  }
  return out;
}

/** Fields that differ because a nested instance was swapped to another main. */
const SWAP_FIELDS = ['componentId', 'componentProperties'];

export function same(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

export interface RebuildStats {
  /** Instances whose layers were rebuilt from their main. */
  linked: number;
  /** Instances whose main is not in the snapshot. */
  unlinked: number;
  /** Instances whose main was swapped (instance swap or nested variant). */
  swapped: number;
  layers: number;
  /** Fields taken from the main. */
  fromMain: number;
  /** Fields taken from the instance because Figma lists them as overridden. */
  fromOverrides: number;
  /** Fields taken from the instance because a component property drives them. */
  fromProperties: number;
  /** Fields that differ from the main with no record saying why. */
  inferred: number;
  inferredFields: Record<string, number>;
  /** Layers the instance has but the main does not, and the other way round. */
  extra: number;
  missing: number;
  /** Layers of hidden nested instances, which Figma does not export, made from the main. */
  filled: number;
}

export function emptyStats(): RebuildStats {
  return {
    linked: 0,
    unlinked: 0,
    swapped: 0,
    layers: 0,
    fromMain: 0,
    fromOverrides: 0,
    fromProperties: 0,
    inferred: 0,
    inferredFields: {},
    extra: 0,
    missing: 0,
    filled: 0,
  };
}

/** Overrides keyed by layer id, as node fields. */
type OverrideMap = Map<string, Set<string>>;

function addOverrides(into: OverrideMap, list: FigmaOverride[] | undefined) {
  for (const o of list ?? []) {
    const set = into.get(o.id) ?? new Set<string>();
    for (const f of o.overriddenFields) {
      for (const n of nodeFieldsFor(f)) {
        set.add(n);
      }
    }
    into.set(o.id, set);
  }
}

/**
 * Rebuilds an instance's layers from its main: structure and every field come
 * from the main, except fields the instance overrides or a property drives,
 * which come from Figma's expanded copy. Fields that differ without a record
 * are kept from the copy and reported as inferred overrides, and added to the
 * instance's override list so the result still reads as main + overrides.
 */
export function rebuildInstance(
  instance: FigmaNode,
  mains: Map<string, FigmaNode>,
  stats: RebuildStats,
  inherited: OverrideMap = new Map(),
): FigmaNode {
  const found = instance.componentId
    ? mains.get(instance.componentId)
    : undefined;
  // See apps/docs/figma-to-tldraw/tech.md §16.2.
  const main =
    found && !found.children?.length && instance.children?.length
      ? undefined
      : found;
  if (!main) {
    stats.unlinked++;
    return {
      ...instance,
      children: instance.children?.map((c) =>
        rebuildInside(c, mains, stats, inherited),
      ),
    };
  }
  stats.linked++;
  const overrides: OverrideMap = new Map(inherited);
  addOverrides(overrides, instance.overrides);
  const copies = new Map<string, FigmaNode>();
  for (const child of instance.children ?? []) {
    walk(child, (n) => copies.set(n.id, n));
  }
  const recorded = new Map<string, Set<string>>();
  const record = (id: string, field: string) => {
    const set = recorded.get(id) ?? new Set<string>();
    set.add(field);
    recorded.set(id, set);
  };

  function layer(
    template: FigmaNode,
    copy: FigmaNode,
    swap?: FigmaNode,
  ): FigmaNode {
    stats.layers++;
    const over = overrides.get(copy.id) ?? new Set<string>();
    const driven = new Set([
      ...propertyFields(template),
      ...propertyFields(copy),
      ...(swap ? SWAP_FIELDS : []),
    ]);
    const out: FigmaNode = { ...copy };
    const keys = new Set([...Object.keys(template), ...Object.keys(copy)]);
    for (const key of keys) {
      if (IGNORED.has(key)) {
        continue;
      }
      const k = key as keyof FigmaNode;
      if (over.has(key)) {
        stats.fromOverrides++;
      } else if (driven.has(key)) {
        stats.fromProperties++;
      } else if (same(template[k], copy[k])) {
        stats.fromMain++;
        (out as unknown as Record<string, unknown>)[key] = template[k];
      } else if (swap && same(swap[k], copy[k])) {
        stats.fromMain++;
      } else {
        stats.inferred++;
        stats.inferredFields[key] = (stats.inferredFields[key] ?? 0) + 1;
        record(copy.id, key);
      }
    }
    return out;
  }

  function build(
    template: FigmaNode,
    parent?: { template: FigmaNode; copy: FigmaNode },
  ): FigmaNode | undefined {
    const id = copyId(instance.id, template.id);
    const copy = copies.get(id);
    if (!copy) {
      // See apps/docs/figma-to-tldraw/tech.md §16.2.
      if (parent && parent.copy.visible === false) {
        stats.filled++;
        return fillFromMain(instance.id, template, parent);
      }
      stats.missing++;
      return undefined;
    }
    if (copy.type === 'INSTANCE' && copy.componentId !== template.componentId) {
      // See apps/docs/figma-to-tldraw/tech.md §16.2.
      stats.swapped++;
      const own = copy.componentId ? mains.get(copy.componentId) : undefined;
      layer(own ? { ...own, type: 'INSTANCE' } : template, copy, template);
      return rebuildInstance(copy, mains, stats, overrides);
    }
    const node = layer(template, copy);
    if (copy.type === 'INSTANCE' && copy.overrides?.length) {
      addOverrides(overrides, copy.overrides);
    }
    const children = (template.children ?? []).flatMap(
      (t) => build(t, { template, copy }) ?? [],
    );
    const covered = new Set(children.map((c) => c.id));
    for (const c of copy.children ?? []) {
      if (!covered.has(c.id)) {
        stats.extra++;
        children.push(c);
      }
    }
    return children.length || copy.children ? { ...node, children } : node;
  }

  const children = (main.children ?? []).flatMap((t) => build(t) ?? []);
  const covered = new Set(children.map((c) => c.id));
  for (const c of instance.children ?? []) {
    if (!covered.has(c.id)) {
      stats.extra++;
      children.push(c);
    }
  }
  const list = [...(instance.overrides ?? [])].map((o) => ({ ...o }));
  for (const [id, fields] of recorded) {
    const entry = list.find((o) => o.id === id);
    if (entry) {
      entry.overriddenFields = [
        ...new Set([...entry.overriddenFields, ...fields]),
      ];
    } else {
      list.push({ id, overriddenFields: [...fields] });
    }
  }
  return { ...instance, overrides: list, children };
}

function moved(rect: FigmaNode['absoluteBoundingBox'], dx: number, dy: number) {
  return rect ? { ...rect, x: rect.x + dx, y: rect.y + dy } : rect;
}

/** A copy of a main's layer for an instance, placed relative to its parent. */
function fillFromMain(
  instanceId: string,
  template: FigmaNode,
  parent: { template: FigmaNode; copy: FigmaNode },
): FigmaNode {
  const from = parent.template.absoluteBoundingBox;
  const to = parent.copy.absoluteBoundingBox;
  const dx = from && to ? to.x - from.x : 0;
  const dy = from && to ? to.y - from.y : 0;
  const copy = (node: FigmaNode): FigmaNode => ({
    ...node,
    id: copyId(instanceId, node.id),
    absoluteBoundingBox: moved(node.absoluteBoundingBox, dx, dy),
    absoluteRenderBounds: moved(node.absoluteRenderBounds, dx, dy),
    children: node.children?.map(copy),
  });
  return copy(template);
}

function rebuildInside(
  node: FigmaNode,
  mains: Map<string, FigmaNode>,
  stats: RebuildStats,
  inherited: OverrideMap,
): FigmaNode {
  if (node.type === 'INSTANCE') {
    return rebuildInstance(node, mains, stats, inherited);
  }
  if (!node.children) {
    return node;
  }
  return {
    ...node,
    children: node.children.map((c) =>
      rebuildInside(c, mains, stats, inherited),
    ),
  };
}

/** Rebuilds every outermost instance in a tree from its main. */
export function rebuildTree(
  root: FigmaNode,
  mains: Map<string, FigmaNode>,
  stats: RebuildStats = emptyStats(),
): FigmaNode {
  return rebuildInside(root, mains, stats, new Map());
}
