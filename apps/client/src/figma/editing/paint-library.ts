import type {
  FigmaColor,
  FigmaPaint,
  FigmaVariable,
  FigmaVariableCollection,
  FigmaVariableModes,
} from '../types';
import {
  type FigmaVariableSet,
  isVariableColor,
  resolveVariable,
} from '../variables';
import { convertPaint } from './paint-edit';

// See apps/docs/figma-to-tldraw/tech.md §22.6.

export type PaintTarget = 'fill' | 'stroke';

const FRAME_TYPES = new Set([
  'FRAME',
  'COMPONENT',
  'COMPONENT_SET',
  'INSTANCE',
  'SECTION',
]);

export function scopeAllows(
  scopes: string[] | undefined,
  target: PaintTarget,
  nodeType: string,
): boolean {
  if (!scopes || scopes.includes('ALL_SCOPES')) {
    return true;
  }
  if (target === 'stroke') {
    return scopes.includes('STROKE_COLOR');
  }
  const own =
    nodeType === 'TEXT'
      ? 'TEXT_FILL'
      : FRAME_TYPES.has(nodeType)
        ? 'FRAME_FILL'
        : 'SHAPE_FILL';
  return scopes.includes('ALL_FILLS') || scopes.includes(own);
}

export interface ColorGroup {
  id: string;
  collection: FigmaVariableCollection | undefined;
  entries: { variable: FigmaVariable; color: FigmaColor }[];
}

/** Color variables the paint can use, grouped by collection, valued for `modes`. */
export function colorVariables(
  set: FigmaVariableSet,
  modes: FigmaVariableModes,
  filter: { query: string; target: PaintTarget; nodeType: string },
): ColorGroup[] {
  const query = filter.query.trim().toLowerCase();
  const groups = new Map<string, ColorGroup>();
  for (const variable of Object.values(set.variables)) {
    if (
      variable.resolvedType !== 'COLOR' ||
      !scopeAllows(variable.scopes, filter.target, filter.nodeType)
    ) {
      continue;
    }
    const id = variable.variableCollectionId;
    const collection = set.collections[id];
    const path = `${collection?.name ?? ''}/${variable.name}`.toLowerCase();
    const value = resolveVariable(set, variable.id, modes);
    if ((query && !path.includes(query)) || !isVariableColor(value)) {
      continue;
    }
    const group = groups.get(id) ?? { id, collection, entries: [] };
    group.entries.push({ variable, color: { ...value, a: value.a ?? 1 } });
    groups.set(id, group);
  }
  return [...groups.values()];
}

/** A solid paint bound to the variable, showing its current value. */
export function bindColor(
  paint: FigmaPaint,
  id: string,
  color: FigmaColor,
): FigmaPaint {
  const solid = paint.type === 'SOLID' ? paint : convertPaint(paint, 'SOLID');
  return {
    ...solid,
    color,
    boundVariables: {
      ...solid.boundVariables,
      color: { type: 'VARIABLE_ALIAS', id },
    },
  };
}
