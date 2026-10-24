import type { TLBaseShape } from 'tldraw';

import type { FigmaNode } from './types';

// See apps/docs/figma-to-tldraw/tech.md §3.

export type FigmaShapeType =
  | 'figma-frame'
  | 'figma-rect'
  | 'figma-text'
  | 'figma-vector';

export interface FigmaShapeProps {
  w: number;
  h: number;
  node: FigmaNode;
  svg: string;
  images: Record<string, string>;
  imageSizes: Record<string, { width: number; height: number }>;
  mask: string;
  maskPath: string;
}

export type FigmaShape<T extends FigmaShapeType = FigmaShapeType> = TLBaseShape<
  T,
  FigmaShapeProps
>;
