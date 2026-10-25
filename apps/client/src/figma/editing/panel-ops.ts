import type { FigmaNode, FigmaPaint, FigmaTypeStyle } from '../types';
import { isAutoLayout } from './auto-layout';

// See apps/docs/figma-to-tldraw/tech.md §13.4.

function without<T extends object, K extends keyof T>(
  value: T,
  keys: readonly K[],
): Omit<T, K> {
  const out = { ...value };
  for (const key of keys) {
    delete out[key];
  }
  return out;
}

const LINE_HEIGHT_KEYS = [
  'lineHeightPx',
  'lineHeightUnit',
  'lineHeightPercent',
  'lineHeightPercentFontSize',
] as const;

/** Figma's "auto" line height per font, read off the exported cases. */
const INTRINSIC_LINE_HEIGHT: Record<string, number> = {
  Inter: 1.2102,
  Lato: 1.2,
  'DM Sans': 1.302,
  Poppins: 1.5,
  Montserrat: 1.219,
  'Red Hat Display': 1.323,
  'Noto Sans SC': 1.2,
  'Product Sans': 1.213,
  Nunito: 1.364,
};

export function autoLineHeight(style: FigmaTypeStyle): number {
  const size = style.fontSize ?? 16;
  return size * (INTRINSIC_LINE_HEIGHT[style.fontFamily ?? 'Inter'] ?? 1.2);
}

/** Sets a text property for the whole layer, the way Figma's panel does. */
export function setTextStyle(
  node: FigmaNode,
  patch: Partial<FigmaTypeStyle>,
): FigmaNode {
  const base = node.style ?? {};
  const style = { ...base, ...patch };
  const keys = Object.keys(patch) as (keyof FigmaTypeStyle)[];
  if (patch.fontSize !== undefined && !('lineHeightPx' in patch)) {
    const ratio = patch.fontSize / (base.fontSize ?? 16);
    if (base.lineHeightUnit !== 'PIXELS' && base.lineHeightPx !== undefined) {
      style.lineHeightPx = base.lineHeightPx * ratio;
    }
    keys.push(...LINE_HEIGHT_KEYS);
  }
  if ('lineHeightPx' in patch) {
    keys.push(...LINE_HEIGHT_KEYS);
  }
  const out: FigmaNode = { ...node, style };
  if (node.styleOverrideTable) {
    out.styleOverrideTable = Object.fromEntries(
      Object.entries(node.styleOverrideTable).map(([key, value]) => [
        key,
        without(value, keys),
      ]),
    );
  }
  return out;
}

export function setLineHeight(node: FigmaNode, px: number | 'auto'): FigmaNode {
  const style = node.style ?? {};
  return setTextStyle(
    node,
    px === 'auto'
      ? { lineHeightUnit: 'INTRINSIC_%', lineHeightPx: autoLineHeight(style) }
      : { lineHeightUnit: 'PIXELS', lineHeightPx: px },
  );
}

export function setFills(node: FigmaNode, fills: FigmaPaint[]): FigmaNode {
  if (node.type !== 'TEXT') {
    return { ...node, fills };
  }
  const out = setTextStyle(node, {});
  out.fills = fills;
  if (out.style?.fills) {
    out.style = { ...out.style, fills };
  }
  if (out.styleOverrideTable) {
    out.styleOverrideTable = Object.fromEntries(
      Object.entries(out.styleOverrideTable).map(([key, value]) => [
        key,
        without(value, ['fills']),
      ]),
    );
  }
  return out;
}

export function setRadius(node: FigmaNode, radius: number): FigmaNode {
  return { ...without(node, ['rectangleCornerRadii']), cornerRadius: radius };
}

export function setStrokeWeight(node: FigmaNode, weight: number): FigmaNode {
  return {
    ...without(node, ['individualStrokeWeights']),
    strokeWeight: weight,
  };
}

/** Turns auto layout on (keeping the current size) or off. */
export function setLayoutMode(
  node: FigmaNode,
  mode: 'NONE' | 'HORIZONTAL' | 'VERTICAL',
): FigmaNode {
  if (mode === 'NONE') {
    return {
      ...node,
      layoutMode: 'NONE',
      ...(node.layoutSizingHorizontal === 'HUG' && {
        layoutSizingHorizontal: 'FIXED',
      }),
      ...(node.layoutSizingVertical === 'HUG' && {
        layoutSizingVertical: 'FIXED',
      }),
    };
  }
  if (isAutoLayout(node)) {
    return { ...node, layoutMode: mode };
  }
  return {
    ...node,
    layoutMode: mode,
    layoutWrap: 'NO_WRAP',
    itemSpacing: node.itemSpacing ?? 10,
    paddingLeft: node.paddingLeft ?? 10,
    paddingRight: node.paddingRight ?? 10,
    paddingTop: node.paddingTop ?? 10,
    paddingBottom: node.paddingBottom ?? 10,
    primaryAxisSizingMode: 'FIXED',
    counterAxisSizingMode: 'FIXED',
    layoutSizingHorizontal:
      node.layoutSizingHorizontal === 'FILL' ? 'FILL' : 'FIXED',
    layoutSizingVertical:
      node.layoutSizingVertical === 'FILL' ? 'FILL' : 'FIXED',
  };
}
