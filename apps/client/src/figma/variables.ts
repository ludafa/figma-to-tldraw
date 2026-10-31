import { cornerRadii, type Radii } from './geometry';
import type {
  FigmaColor,
  FigmaNode,
  FigmaVariable,
  FigmaVariableAlias,
  FigmaVariableCollection,
  FigmaVariableColor,
  FigmaVariableModes,
  FigmaVariableValue,
} from './types';

// See apps/docs/figma-to-tldraw/tech.md §21.4.

export interface FigmaVariableSet {
  collections: Record<string, FigmaVariableCollection>;
  variables: Record<string, FigmaVariable>;
}

export function isAlias(value: unknown): value is FigmaVariableAlias {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as FigmaVariableAlias).type === 'VARIABLE_ALIAS' &&
    typeof (value as FigmaVariableAlias).id === 'string'
  );
}

export function isVariableColor(value: unknown): value is FigmaVariableColor {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as FigmaVariableColor).r === 'number' &&
    typeof (value as FigmaVariableColor).g === 'number' &&
    typeof (value as FigmaVariableColor).b === 'number'
  );
}

/** Modes in effect for the last node of `chain`, which runs from the top layer down. */
export function effectiveModes(chain: FigmaNode[]): FigmaVariableModes {
  const modes: FigmaVariableModes = {};
  for (const node of chain) {
    Object.assign(
      modes,
      node.inheritedVariableModes,
      node.explicitVariableModes,
    );
  }
  return modes;
}

export function modeFor(
  set: FigmaVariableSet,
  collectionId: string,
  modes: FigmaVariableModes,
): string | undefined {
  const collection = set.collections[collectionId];
  const mode = modes[collectionId];
  if (
    mode &&
    (!collection || collection.modes.some((m) => m.modeId === mode))
  ) {
    return mode;
  }
  return collection?.defaultModeId;
}

/** A variable's value for a layer in `modes`, following aliases; each hop uses its own collection's mode. */
export function resolveVariable(
  set: FigmaVariableSet,
  id: string,
  modes: FigmaVariableModes,
  seen = new Set<string>(),
): Exclude<FigmaVariableValue, FigmaVariableAlias> | undefined {
  const variable = set.variables[id];
  if (!variable || seen.has(id)) {
    return undefined;
  }
  seen.add(id);
  const mode = modeFor(set, variable.variableCollectionId, modes);
  const values = variable.valuesByMode;
  const raw =
    (mode !== undefined ? values[mode] : undefined) ??
    values[Object.keys(values)[0]];
  return isAlias(raw) ? resolveVariable(set, raw.id, modes, seen) : raw;
}

// See apps/docs/figma-to-tldraw/tech.md §21.7.
export function withCollectionValues(
  set: FigmaVariableSet,
  targetId: string,
  sourceId: string,
): FigmaVariableSet {
  const target = set.collections[targetId];
  const source = set.collections[sourceId];
  if (!target || !source || target.remote) {
    return set;
  }
  const inCollection = (id: string) =>
    new Map(
      Object.values(set.variables)
        .filter((v) => v.variableCollectionId === id)
        .map((v) => [v.name, v]),
    );
  const targets = inCollection(targetId);
  const sources = inCollection(sourceId);
  const redirect = (value: FigmaVariableValue): FigmaVariableValue => {
    const to = isAlias(value) ? set.variables[value.id] : undefined;
    const mapped =
      to?.variableCollectionId === sourceId && targets.get(to.name);
    return mapped ? { type: 'VARIABLE_ALIAS', id: mapped.id } : value;
  };
  const variables = { ...set.variables };
  for (const [name, variable] of targets) {
    const from = sources.get(name);
    if (!from) {
      continue;
    }
    const valuesByMode = { ...variable.valuesByMode };
    target.modes.forEach((mode, i) => {
      const modeId = (source.modes[i] ?? source.modes[0])?.modeId;
      const value =
        modeId === undefined ? undefined : from.valuesByMode[modeId];
      if (value !== undefined) {
        valuesByMode[mode.modeId] = redirect(value);
      }
    });
    variables[variable.id] = { ...variable, valuesByMode };
  }
  return { ...set, variables };
}

type Path = (string | number)[];

type SlotKind =
  | 'number'
  | 'opacity'
  | 'boolean'
  | 'string'
  | 'color'
  | 'corner'
  | 'strokeSide'
  | 'lineHeight'
  | 'fontStyle'
  | 'width'
  | 'height';

/** One bound field of a node: where its value lives and where its binding lives. */
export interface VariableSlot {
  kind: SlotKind;
  alias: FigmaVariableAlias;
  /** The field's value (for `corner` / `strokeSide`, the corner / side index; empty for width / height). */
  value: Path;
  binding: Path;
  label: string;
}

const NODE_FIELDS: [string, SlotKind, string][] = [
  ['minWidth', 'number', '最小宽度'],
  ['maxWidth', 'number', '最大宽度'],
  ['minHeight', 'number', '最小高度'],
  ['maxHeight', 'number', '最大高度'],
  ['paddingTop', 'number', '上内边距'],
  ['paddingRight', 'number', '右内边距'],
  ['paddingBottom', 'number', '下内边距'],
  ['paddingLeft', 'number', '左内边距'],
  ['itemSpacing', 'number', '间距'],
  ['counterAxisSpacing', 'number', '行间距'],
  ['strokeWeight', 'number', '描边粗细'],
  ['opacity', 'opacity', '不透明度'],
  ['visible', 'boolean', '显示'],
  ['characters', 'string', '文字内容'],
];

const CORNERS: [string, string, number, string][] = [
  ['RECTANGLE_TOP_LEFT_CORNER_RADIUS', 'topLeftRadius', 0, '左上圆角'],
  ['RECTANGLE_TOP_RIGHT_CORNER_RADIUS', 'topRightRadius', 1, '右上圆角'],
  ['RECTANGLE_BOTTOM_RIGHT_CORNER_RADIUS', 'bottomRightRadius', 2, '右下圆角'],
  ['RECTANGLE_BOTTOM_LEFT_CORNER_RADIUS', 'bottomLeftRadius', 3, '左下圆角'],
];

const SIDES: [string, Side, number, string][] = [
  ['BORDER_TOP_WEIGHT', 'top', 0, '上'],
  ['BORDER_RIGHT_WEIGHT', 'right', 1, '右'],
  ['BORDER_BOTTOM_WEIGHT', 'bottom', 2, '下'],
  ['BORDER_LEFT_WEIGHT', 'left', 3, '左'],
];

type Side = 'top' | 'right' | 'bottom' | 'left';

const TEXT_FIELDS: [string, SlotKind, string, string][] = [
  ['fontFamily', 'string', 'fontFamily', '字体'],
  ['fontStyle', 'fontStyle', 'fontStyle', '字体样式'],
  ['fontWeight', 'number', 'fontWeight', '字重'],
  ['fontSize', 'number', 'fontSize', '字号'],
  ['lineHeight', 'lineHeight', 'lineHeightPx', '行高'],
  ['letterSpacing', 'number', 'letterSpacing', '字间距'],
  ['paragraphSpacing', 'number', 'paragraphSpacing', '段间距'],
  ['paragraphIndent', 'number', 'paragraphIndent', '首行缩进'],
];

const EFFECT_FIELDS: [string, SlotKind, Path, string][] = [
  ['color', 'color', ['color'], '颜色'],
  ['radius', 'number', ['radius'], '模糊'],
  ['spread', 'number', ['spread'], '扩展'],
  ['offsetX', 'number', ['offset', 'x'], 'X'],
  ['offsetY', 'number', ['offset', 'y'], 'Y'],
];

function paintSlots(
  out: VariableSlot[],
  paints: FigmaNode['fills'],
  at: Path,
  label: string,
) {
  paints?.forEach((paint, i) => {
    const name = paints.length > 1 ? `${label} ${i + 1}` : label;
    const color = paint.boundVariables?.color;
    if (isAlias(color)) {
      out.push({
        kind: 'color',
        alias: color,
        value: [...at, i, 'color'],
        binding: [...at, i, 'boundVariables', 'color'],
        label: name,
      });
    }
    paint.gradientStops?.forEach((stop, j) => {
      const c = stop.boundVariables?.color;
      if (isAlias(c)) {
        out.push({
          kind: 'color',
          alias: c,
          value: [...at, i, 'gradientStops', j, 'color'],
          binding: [...at, i, 'gradientStops', j, 'boundVariables', 'color'],
          label: `${name} 色标 ${j + 1}`,
        });
      }
    });
  });
}

/** Every bound field of `node`, in REST's shape (probe-variables.md §3.3). */
export function variableSlots(node: FigmaNode): VariableSlot[] {
  const out: VariableSlot[] = [];
  const bound = node.boundVariables;
  if (bound) {
    if (isAlias(bound.size?.x)) {
      out.push({
        kind: 'width',
        alias: bound.size.x,
        value: [],
        binding: ['boundVariables', 'size', 'x'],
        label: '宽',
      });
    }
    if (isAlias(bound.size?.y)) {
      out.push({
        kind: 'height',
        alias: bound.size.y,
        value: [],
        binding: ['boundVariables', 'size', 'y'],
        label: '高',
      });
    }
    for (const [field, kind, label] of NODE_FIELDS) {
      const alias = bound[field as keyof typeof bound];
      if (isAlias(alias)) {
        out.push({
          kind,
          alias,
          value: [field],
          binding: ['boundVariables', field],
          label,
        });
      }
    }
    for (const [restKey, flatKey, index, label] of CORNERS) {
      const radii = bound.rectangleCornerRadii as
        | Record<string, unknown>
        | undefined;
      const fromRadii = radii?.[restKey];
      if (isAlias(fromRadii)) {
        out.push({
          kind: 'corner',
          alias: fromRadii,
          value: [index],
          binding: ['boundVariables', 'rectangleCornerRadii', restKey],
          label,
        });
        continue;
      }
      const flat = bound[flatKey as keyof typeof bound];
      if (isAlias(flat)) {
        out.push({
          kind: 'corner',
          alias: flat,
          value: [index],
          binding: ['boundVariables', flatKey],
          label,
        });
      }
    }
    for (const [restKey, , index, label] of SIDES) {
      const alias = (
        bound.individualStrokeWeights as Record<string, unknown> | undefined
      )?.[restKey];
      if (isAlias(alias)) {
        out.push({
          kind: 'strokeSide',
          alias,
          value: [index],
          binding: ['boundVariables', 'individualStrokeWeights', restKey],
          label: `${label}描边粗细`,
        });
      }
    }
  }
  paintSlots(out, node.fills, ['fills'], '填充');
  paintSlots(out, node.strokes, ['strokes'], '描边');
  node.effects?.forEach((effect, i) => {
    for (const [field, kind, path, label] of EFFECT_FIELDS) {
      const alias =
        effect.boundVariables?.[
          field as keyof NonNullable<typeof effect.boundVariables>
        ];
      if (isAlias(alias)) {
        out.push({
          kind,
          alias,
          value: ['effects', i, ...path],
          binding: ['effects', i, 'boundVariables', field],
          label: `效果 ${i + 1} ${label}`,
        });
      }
    }
  });
  const styles: [Path, FigmaNode['style'], string][] = [
    [['style'], node.style, ''],
  ];
  for (const [key, style] of Object.entries(node.styleOverrideTable ?? {})) {
    styles.push([['styleOverrideTable', key], style, `（第 ${key} 段样式）`]);
  }
  for (const [at, style, suffix] of styles) {
    if (!style) {
      continue;
    }
    for (const [field, kind, valueKey, label] of TEXT_FIELDS) {
      const alias =
        style.boundVariables?.[
          field as keyof NonNullable<typeof style.boundVariables>
        ];
      if (isAlias(alias)) {
        out.push({
          kind,
          alias,
          value: [...at, valueKey],
          binding: [...at, 'boundVariables', field],
          label: label + suffix,
        });
      }
    }
    if (at[0] === 'styleOverrideTable') {
      paintSlots(out, style.fills, [...at, 'fills'], `文字填充${suffix}`);
    }
  }
  return out;
}

// See apps/docs/figma-to-tldraw/tech.md §21.4.
export function withTextBindings(node: FigmaNode): FigmaNode {
  const bound = node.boundVariables as Record<string, unknown> | undefined;
  if (!bound || !node.style) {
    return node;
  }
  let style = node.style;
  const rest = { ...bound };
  let changed = false;
  for (const [field] of TEXT_FIELDS) {
    const list = bound[field];
    if (!Array.isArray(list)) {
      continue;
    }
    changed = true;
    delete rest[field];
    const used = new Set(
      Object.values(node.styleOverrideTable ?? {}).flatMap((o) => {
        const a = (o.boundVariables as Record<string, unknown> | undefined)?.[
          field
        ];
        return isAlias(a) ? [a.id] : [];
      }),
    );
    const own = list.filter((a) => isAlias(a) && !used.has(a.id));
    if (own.length === 1) {
      style = {
        ...style,
        boundVariables: { ...style.boundVariables, [field]: own[0] },
      };
    }
  }
  if (!changed) {
    return node;
  }
  const { boundVariables: _b, ...without } = node;
  return {
    ...without,
    ...(Object.keys(rest).length
      ? { boundVariables: rest as FigmaNode['boundVariables'] }
      : {}),
    style,
  };
}

const HAS_VARIABLES = new WeakMap<FigmaNode, boolean>();

export function hasVariables(node: FigmaNode): boolean {
  let has = HAS_VARIABLES.get(node);
  if (has === undefined) {
    has = variableSlots(node).length > 0;
    HAS_VARIABLES.set(node, has);
  }
  return has;
}

type Obj = Record<string | number, unknown>;

function getIn(value: unknown, path: Path): unknown {
  let cur = value;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') {
      return undefined;
    }
    cur = (cur as Obj)[key];
  }
  return cur;
}

function setIn<T>(value: T, path: Path, next: unknown): T {
  if (!path.length) {
    return next as T;
  }
  const [key, ...rest] = path;
  const base = (value ?? (typeof key === 'number' ? [] : {})) as Obj;
  const copy = (Array.isArray(base) ? [...base] : { ...base }) as Obj;
  copy[key] = setIn(base[key], rest, next);
  return copy as T;
}

function deleteIn<T>(value: T, path: Path): T {
  const [key, ...rest] = path;
  if (value === null || typeof value !== 'object' || !(key in (value as Obj))) {
    return value;
  }
  const copy = (Array.isArray(value) ? [...value] : { ...value }) as Obj;
  if (rest.length) {
    const inner = deleteIn(copy[key], rest);
    if (inner && typeof inner === 'object' && !Object.keys(inner).length) {
      delete copy[key];
    } else {
      copy[key] = inner;
    }
  } else {
    delete copy[key];
  }
  return copy as T;
}

export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) < 1e-6;
  }
  if (isVariableColor(a) && isVariableColor(b)) {
    return (
      sameValue(a.r, b.r) &&
      sameValue(a.g, b.g) &&
      sameValue(a.b, b.b) &&
      sameValue(a.a ?? 1, b.a ?? 1)
    );
  }
  return false;
}

/** A resolved variable value as the field stores it, or undefined when the types don't fit. */
export function fieldValue(
  kind: SlotKind,
  value: Exclude<FigmaVariableValue, FigmaVariableAlias> | undefined,
): unknown {
  switch (kind) {
    case 'color':
      return isVariableColor(value)
        ? ({
            r: value.r,
            g: value.g,
            b: value.b,
            a: value.a ?? 1,
          } satisfies FigmaColor)
        : undefined;
    case 'boolean':
      return typeof value === 'boolean'
        ? value
        : value === 'true' || value === 'false'
          ? value === 'true'
          : undefined;
    case 'string':
    case 'fontStyle':
      return typeof value === 'string' || typeof value === 'number'
        ? String(value)
        : undefined;
    case 'opacity':
      return typeof value === 'number'
        ? Math.min(1, Math.max(0, value / 100))
        : undefined;
    default:
      return typeof value === 'number' ? value : undefined;
  }
}

/** The value a bound field holds now. */
export function slotValue(node: FigmaNode, slot: VariableSlot): unknown {
  if (slot.kind === 'corner') {
    return cornerRadii(node)[slot.value[0] as number];
  }
  if (slot.kind === 'strokeSide') {
    return strokeSides(node)[slot.value[0] as number];
  }
  if (slot.kind === 'boolean' && slot.value[0] === 'visible') {
    return node.visible ?? true;
  }
  if (slot.kind === 'opacity') {
    return node.opacity ?? 1;
  }
  return getIn(node, slot.value);
}

function withCorner(node: FigmaNode, index: number, radius: number): FigmaNode {
  const radii = [...cornerRadii(node)] as Radii;
  radii[index] = radius;
  const { rectangleCornerRadii: _r, cornerRadius: _c, ...rest } = node;
  return radii.every((r) => r === radii[0])
    ? { ...rest, cornerRadius: radii[0] }
    : { ...rest, rectangleCornerRadii: radii };
}

function strokeSides(node: FigmaNode): number[] {
  const w = node.strokeWeight ?? 0;
  return SIDES.map(([, side]) => node.individualStrokeWeights?.[side] ?? w);
}

function withStrokeSide(
  node: FigmaNode,
  index: number,
  weight: number,
): FigmaNode {
  const sides = strokeSides(node);
  sides[index] = weight;
  const { individualStrokeWeights: _i, ...rest } = node;
  if (sides.every((w) => w === sides[0])) {
    return { ...rest, strokeWeight: sides[0] };
  }
  const [top, right, bottom, left] = sides;
  return { ...rest, individualStrokeWeights: { top, right, bottom, left } };
}

function writeSlot(
  node: FigmaNode,
  slot: VariableSlot,
  value: unknown,
): FigmaNode {
  switch (slot.kind) {
    case 'corner':
      return withCorner(node, slot.value[0] as number, value as number);
    case 'strokeSide':
      return withStrokeSide(node, slot.value[0] as number, value as number);
    case 'lineHeight': {
      const at = slot.value.slice(0, -1);
      const style = getIn(node, at) as Obj;
      const {
        lineHeightPercent: _p,
        lineHeightPercentFontSize: _f,
        ...rest
      } = style;
      return setIn(node, at, {
        ...rest,
        lineHeightPx: value,
        lineHeightUnit: 'PIXELS',
      });
    }
    case 'fontStyle': {
      const at = slot.value.slice(0, -1);
      const style = getIn(node, at) as Obj;
      const weight = styleWeight(value as string);
      return setIn(node, at, {
        ...style,
        fontStyle: value,
        ...(weight === undefined ? {} : { fontWeight: weight }),
        italic: /italic/i.test(value as string),
      });
    }
    default: {
      const out = setIn(node, slot.value, value);
      const [at, field] = slot.value;
      const old = getIn(node, slot.value);
      // See apps/docs/figma-to-tldraw/tech.md §21.4.
      if (
        slot.value.length === 2 &&
        at === 'style' &&
        (field === 'paragraphSpacing' || field === 'paragraphIndent') &&
        out.textSegments
      ) {
        return {
          ...out,
          textSegments: out.textSegments.map((s) =>
            s[field] === old ? { ...s, [field]: value } : s,
          ),
        };
      }
      return out;
    }
  }
}

const STYLE_WEIGHTS: [RegExp, number][] = [
  [/thin|hairline/, 100],
  [/(extra|ultra) ?light/, 200],
  [/light/, 300],
  [/(semi|demi) ?bold|\bdemi\b/, 600],
  [/(extra|ultra) ?bold/, 800],
  [/bold/, 700],
  [/medium/, 500],
  [/black|heavy/, 900],
  [/regular|normal|book|italic/, 400],
];

// See apps/docs/figma-to-tldraw/tech.md §21.4.
function styleWeight(style: string): number | undefined {
  const name = style.toLowerCase().replace(/[-_]/g, ' ');
  return STYLE_WEIGHTS.find(([re]) => re.test(name))?.[1];
}

export interface AppliedVariables {
  node: FigmaNode;
  /** Bound sizes, for the shape's `w` / `h`. */
  w?: number;
  h?: number;
}

/** Writes each bound field's value for `modes` into the node; returns the same node when nothing changed. */
export function applyVariables(
  node: FigmaNode,
  set: FigmaVariableSet,
  modes: FigmaVariableModes,
): AppliedVariables {
  const out: AppliedVariables = { node };
  for (const slot of variableSlots(node)) {
    const value = fieldValue(
      slot.kind,
      resolveVariable(set, slot.alias.id, modes),
    );
    if (value === undefined) {
      continue;
    }
    if (slot.kind === 'width') {
      out.w = value as number;
    } else if (slot.kind === 'height') {
      out.h = value as number;
    } else if (!sameValue(slotValue(out.node, slot), value)) {
      out.node = writeSlot(out.node, slot, value);
    }
  }
  return out;
}

// See apps/docs/figma-to-tldraw/tech.md §21.4.
export function detachEdited(
  prev: FigmaNode,
  next: FigmaNode,
  resized?: { w: boolean; h: boolean },
): FigmaNode {
  let out = next;
  const before = new Map(
    variableSlots(prev).map((s) => [s.binding.join('/'), s]),
  );
  for (const slot of variableSlots(next)) {
    if (slot.kind === 'width' || slot.kind === 'height') {
      if (slot.kind === 'width' ? resized?.w : resized?.h) {
        out = deleteIn(out, slot.binding);
      }
      continue;
    }
    const old = before.get(slot.binding.join('/'));
    if (
      old &&
      old.alias.id === slot.alias.id &&
      !sameValue(slotValue(prev, old), slotValue(next, slot))
    ) {
      out = deleteIn(out, slot.binding);
    }
  }
  return out;
}

/** `node` with one binding removed. */
export function detachSlot(node: FigmaNode, slot: VariableSlot): FigmaNode {
  return deleteIn(node, slot.binding);
}

// See apps/docs/figma-to-tldraw/tech.md §21.2.
export function withBoundValues(
  target: FigmaNode,
  source: FigmaNode,
): FigmaNode {
  const from = new Map(
    variableSlots(source).map((s) => [s.binding.join('/'), s]),
  );
  let out = target;
  for (const slot of variableSlots(target)) {
    const other = from.get(slot.binding.join('/'));
    if (
      other &&
      other.alias.id === slot.alias.id &&
      slot.kind !== 'width' &&
      slot.kind !== 'height'
    ) {
      out = writeSlot(out, slot, slotValue(source, other));
    }
  }
  return out;
}
