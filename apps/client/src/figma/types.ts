// See apps/docs/figma-to-tldraw/tech.md §1.2.

export interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface FigmaVector {
  x: number;
  y: number;
}

export interface FigmaRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type FigmaBlendMode =
  | 'PASS_THROUGH'
  | 'NORMAL'
  | 'DARKEN'
  | 'MULTIPLY'
  | 'LINEAR_BURN'
  | 'COLOR_BURN'
  | 'LIGHTEN'
  | 'SCREEN'
  | 'LINEAR_DODGE'
  | 'COLOR_DODGE'
  | 'OVERLAY'
  | 'SOFT_LIGHT'
  | 'HARD_LIGHT'
  | 'DIFFERENCE'
  | 'EXCLUSION'
  | 'HUE'
  | 'SATURATION'
  | 'COLOR'
  | 'LUMINOSITY';

export interface FigmaColorStop {
  position: number;
  color: FigmaColor;
}

export type FigmaTransform = [
  [number, number, number],
  [number, number, number],
];

export interface FigmaImageFilters {
  exposure?: number;
  contrast?: number;
  saturation?: number;
  temperature?: number;
  tint?: number;
  highlights?: number;
  shadows?: number;
}

export interface FigmaPaint {
  type:
    | 'SOLID'
    | 'GRADIENT_LINEAR'
    | 'GRADIENT_RADIAL'
    | 'GRADIENT_ANGULAR'
    | 'GRADIENT_DIAMOND'
    | 'IMAGE'
    | 'EMOJI'
    | 'VIDEO';
  visible?: boolean;
  opacity?: number;
  blendMode?: FigmaBlendMode;
  color?: FigmaColor;
  gradientHandlePositions?: FigmaVector[];
  gradientStops?: FigmaColorStop[];
  scaleMode?: 'FILL' | 'FIT' | 'TILE' | 'STRETCH';
  imageRef?: string;
  imageTransform?: FigmaTransform;
  scalingFactor?: number;
  rotation?: number;
  filters?: FigmaImageFilters;
}

export interface FigmaEffect {
  type: 'DROP_SHADOW' | 'INNER_SHADOW' | 'LAYER_BLUR' | 'BACKGROUND_BLUR';
  visible: boolean;
  radius: number;
  color?: FigmaColor;
  offset?: FigmaVector;
  spread?: number;
  blendMode?: FigmaBlendMode;
  showShadowBehindNode?: boolean;
}

export interface FigmaTypeStyle {
  fontFamily?: string;
  fontPostScriptName?: string | null;
  fontStyle?: string;
  fontWeight?: number;
  italic?: boolean;
  fontSize?: number;
  textCase?: 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE' | 'SMALL_CAPS';
  textDecoration?: 'NONE' | 'UNDERLINE' | 'STRIKETHROUGH';
  textAutoResize?: 'NONE' | 'HEIGHT' | 'WIDTH_AND_HEIGHT' | 'TRUNCATE';
  textTruncation?: 'DISABLED' | 'ENDING';
  maxLines?: number;
  textAlignHorizontal?: 'LEFT' | 'RIGHT' | 'CENTER' | 'JUSTIFIED';
  textAlignVertical?: 'TOP' | 'CENTER' | 'BOTTOM';
  letterSpacing?: number;
  lineHeightPx?: number;
  lineHeightPercent?: number;
  lineHeightPercentFontSize?: number;
  lineHeightUnit?: 'PIXELS' | 'FONT_SIZE_%' | 'INTRINSIC_%';
  paragraphSpacing?: number;
  paragraphIndent?: number;
  fills?: FigmaPaint[];
}

export interface FigmaArcData {
  startingAngle: number;
  endingAngle: number;
  innerRadius: number;
}

export interface FigmaNode {
  id: string;
  name: string;
  type: string;
  visible?: boolean;
  opacity?: number;
  blendMode?: FigmaBlendMode;
  isMask?: boolean;
  maskType?: 'ALPHA' | 'VECTOR' | 'LUMINANCE';
  absoluteBoundingBox?: FigmaRect | null;
  absoluteRenderBounds?: FigmaRect | null;
  rotation?: number;
  fills?: FigmaPaint[];
  strokes?: FigmaPaint[];
  strokeWeight?: number;
  strokeAlign?: 'INSIDE' | 'OUTSIDE' | 'CENTER';
  strokeCap?: string;
  strokeJoin?: string;
  strokeDashes?: number[];
  individualStrokeWeights?: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  cornerRadius?: number;
  rectangleCornerRadii?: [number, number, number, number];
  cornerSmoothing?: number;
  arcData?: FigmaArcData;
  effects?: FigmaEffect[];
  clipsContent?: boolean;
  itemReverseZIndex?: boolean;
  characters?: string;
  style?: FigmaTypeStyle;
  characterStyleOverrides?: number[];
  styleOverrideTable?: Record<string, FigmaTypeStyle>;
  children?: FigmaNode[];
}

// See apps/docs/figma-to-tldraw/tech.md §4.2.
export type Matrix2x3 = FigmaTransform;

export interface NodeTransform {
  m: Matrix2x3;
  w: number;
  h: number;
}

export interface SnapshotMeta {
  name: string;
  nodeId: string;
  type: string;
  width: number;
  height: number;
  expectedScale: number;
  fonts: string[];
  images: Record<string, string>;
  filteredImages?: Record<string, string>;
  imageSizes?: Record<string, { width: number; height: number }>;
  masks?: Record<string, string>;
  warnings: string[];
}

export interface Snapshot {
  meta: SnapshotMeta;
  rest: { document: FigmaNode };
  svgs: Record<string, string>;
  transforms?: Record<string, NodeTransform>;
}

export interface CaseSummary {
  name: string;
  dir: string;
  nodeId: string;
  width: number;
  height: number;
  svgCount: number;
  imageCount: number;
  fonts: string[];
  warnings: string[];
  source?: { figmaFile?: string; page?: string; exportedAt?: string };
}

export interface CaseIndex {
  exportedAt: string;
  figmaFile: string;
  page: string;
  expectedScale: number;
  cases: CaseSummary[];
  errors: { name: string; error: string }[];
}
