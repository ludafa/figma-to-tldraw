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
  boundVariables?: { color?: FigmaVariableAlias };
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
  boundVariables?: { color?: FigmaVariableAlias };
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
  boundVariables?: Partial<
    Record<
      'radius' | 'spread' | 'color' | 'offsetX' | 'offsetY',
      FigmaVariableAlias
    >
  >;
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
  listSpacing?: number;
  fills?: FigmaPaint[];
  boundVariables?: Partial<Record<FigmaTextVariableField, FigmaVariableAlias>>;
}

/** A length that Figma can also leave on "auto". */
export interface FigmaAutoLength {
  unit: 'AUTO' | 'PIXELS' | 'PERCENT';
  value?: number;
}

// See apps/docs/skia-engine/tech.md §11.4.
export interface FigmaTextSegment {
  start: number;
  end: number;
  paragraphSpacing?: number;
  paragraphIndent?: number;
  listSpacing?: number;
  textDecorationStyle?: 'SOLID' | 'WAVY' | 'DOTTED';
  textDecorationOffset?: FigmaAutoLength;
  textDecorationThickness?: FigmaAutoLength;
  textDecorationColor?: { value: 'AUTO' | FigmaPaint };
  textDecorationSkipInk?: boolean;
}

export interface FigmaArcData {
  startingAngle: number;
  endingAngle: number;
  innerRadius: number;
}

export type FigmaLayoutSizing = 'FIXED' | 'HUG' | 'FILL';

export interface FigmaLayoutConstraint {
  horizontal: 'LEFT' | 'RIGHT' | 'CENTER' | 'LEFT_RIGHT' | 'SCALE';
  vertical: 'TOP' | 'BOTTOM' | 'CENTER' | 'TOP_BOTTOM' | 'SCALE';
}

// See apps/docs/figma-to-tldraw/tech.md §13.2.
export interface FigmaLayoutProps {
  layoutMode?: 'NONE' | 'HORIZONTAL' | 'VERTICAL' | 'GRID';
  layoutWrap?: 'NO_WRAP' | 'WRAP';
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  itemSpacing?: number;
  primaryAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'SPACE_BETWEEN';
  counterAxisAlignItems?: 'MIN' | 'CENTER' | 'MAX' | 'BASELINE';
  primaryAxisSizingMode?: 'FIXED' | 'AUTO';
  counterAxisSizingMode?: 'FIXED' | 'AUTO';
  strokesIncludedInLayout?: boolean;
  layoutAlign?: 'INHERIT' | 'STRETCH' | 'MIN' | 'CENTER' | 'MAX';
  layoutGrow?: number;
  layoutPositioning?: 'AUTO' | 'ABSOLUTE';
  layoutSizingHorizontal?: FigmaLayoutSizing;
  layoutSizingVertical?: FigmaLayoutSizing;
  minWidth?: number | null;
  maxWidth?: number | null;
  minHeight?: number | null;
  maxHeight?: number | null;
  constraints?: FigmaLayoutConstraint;
}

export interface FigmaNode extends FigmaLayoutProps {
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
  /** Text layers whose name follows their content (Figma's `autoRename`). */
  autoRename?: boolean;
  style?: FigmaTypeStyle;
  characterStyleOverrides?: number[];
  styleOverrideTable?: Record<string, FigmaTypeStyle>;
  /** Not in REST: per-range text properties the plugin exports (`snapshot.textSegments`). */
  textSegments?: FigmaTextSegment[];
  lineTypes?: ('NONE' | 'ORDERED' | 'UNORDERED')[];
  lineIndentations?: number[];
  styles?: Record<string, string>;
  /** Instances: the main component's node id. */
  componentId?: string;
  componentProperties?: Record<string, FigmaComponentProperty>;
  componentPropertyDefinitions?: Record<
    string,
    FigmaComponentPropertyDefinition
  >;
  /** Which of this layer's fields a component property drives. */
  componentPropertyReferences?: Record<string, string>;
  overrides?: FigmaOverride[];
  uniformScaleFactor?: number;
  /** Component sets exported with only the variants a page uses. */
  partial?: boolean;
  variantCount?: number;
  boundVariables?: FigmaBoundVariables;
  explicitVariableModes?: FigmaVariableModes;
  /** Not in REST: modes the export root (or an exported main) inherits from layers outside the export. */
  inheritedVariableModes?: FigmaVariableModes;
  children?: FigmaNode[];
}

export type FigmaComponentPropertyType =
  | 'BOOLEAN'
  | 'TEXT'
  | 'INSTANCE_SWAP'
  | 'VARIANT'
  | 'SLOT';

export interface FigmaComponentProperty {
  type: FigmaComponentPropertyType;
  value: string | boolean;
  preferredValues?: { type: string; key: string }[];
}

export interface FigmaComponentPropertyDefinition {
  type: FigmaComponentPropertyType;
  defaultValue?: string | boolean;
  variantOptions?: string[];
  preferredValues?: { type: string; key: string }[];
}

/** Fields an instance changed on one of its layers (or on itself). */
export interface FigmaOverride {
  id: string;
  overriddenFields: string[];
}

export interface FigmaComponentMeta {
  key: string;
  name: string;
  description?: string;
  remote?: boolean;
  componentSetId?: string;
}

// See apps/docs/figma-to-tldraw/tech.md §21.2.
export interface FigmaVariableAlias {
  type: 'VARIABLE_ALIAS';
  id: string;
}

export type FigmaVariableType =
  | 'COLOR'
  | 'FLOAT'
  | 'STRING'
  | 'BOOLEAN'
  | 'EASING'
  | 'TIMING';

export interface FigmaVariableColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

export type FigmaVariableValue =
  | boolean
  | number
  | string
  | FigmaVariableColor
  | FigmaVariableAlias;

export interface FigmaVariable {
  id: string;
  name: string;
  key?: string;
  remote?: boolean;
  description?: string;
  variableCollectionId: string;
  resolvedType: FigmaVariableType;
  valuesByMode: Record<string, FigmaVariableValue>;
  scopes?: string[];
  codeSyntax?: Record<string, string>;
  hiddenFromPublishing?: boolean;
}

export interface FigmaVariableCollection {
  id: string;
  name: string;
  key?: string;
  remote?: boolean;
  modes: { modeId: string; name: string }[];
  defaultModeId: string;
  hiddenFromPublishing?: boolean;
  isExtension?: boolean;
}

/** Collection id → mode id. */
export type FigmaVariableModes = Record<string, string>;

export interface SnapshotVariables {
  collections: Record<string, FigmaVariableCollection>;
  variables: Record<string, FigmaVariable>;
  /** Node id → the modes that layer sets itself. */
  modes: Record<string, FigmaVariableModes>;
  /** Export root / main id → modes inherited from layers outside the export. */
  inherited: Record<string, FigmaVariableModes>;
  /** Variable ids the plugin could not read (library variables, deleted ones). */
  missing: string[];
}

export type FigmaTextVariableField =
  | 'fontFamily'
  | 'fontSize'
  | 'fontStyle'
  | 'fontWeight'
  | 'letterSpacing'
  | 'lineHeight'
  | 'paragraphSpacing'
  | 'paragraphIndent';

export type FigmaCornerVariableField =
  | 'RECTANGLE_TOP_LEFT_CORNER_RADIUS'
  | 'RECTANGLE_TOP_RIGHT_CORNER_RADIUS'
  | 'RECTANGLE_BOTTOM_RIGHT_CORNER_RADIUS'
  | 'RECTANGLE_BOTTOM_LEFT_CORNER_RADIUS';

/** `boundVariables` on a node, in REST's shape (field names differ from the plugin API). */
export type FigmaStrokeVariableField =
  | 'BORDER_TOP_WEIGHT'
  | 'BORDER_RIGHT_WEIGHT'
  | 'BORDER_BOTTOM_WEIGHT'
  | 'BORDER_LEFT_WEIGHT';

export interface FigmaBoundVariables {
  size?: { x?: FigmaVariableAlias; y?: FigmaVariableAlias };
  individualStrokeWeights?: Partial<
    Record<FigmaStrokeVariableField, FigmaVariableAlias>
  >;
  rectangleCornerRadii?: Partial<
    Record<FigmaCornerVariableField, FigmaVariableAlias>
  >;
  topLeftRadius?: FigmaVariableAlias;
  topRightRadius?: FigmaVariableAlias;
  bottomRightRadius?: FigmaVariableAlias;
  bottomLeftRadius?: FigmaVariableAlias;
  characters?: FigmaVariableAlias;
  itemSpacing?: FigmaVariableAlias;
  counterAxisSpacing?: FigmaVariableAlias;
  paddingLeft?: FigmaVariableAlias;
  paddingRight?: FigmaVariableAlias;
  paddingTop?: FigmaVariableAlias;
  paddingBottom?: FigmaVariableAlias;
  minWidth?: FigmaVariableAlias;
  maxWidth?: FigmaVariableAlias;
  minHeight?: FigmaVariableAlias;
  maxHeight?: FigmaVariableAlias;
  visible?: FigmaVariableAlias;
  opacity?: FigmaVariableAlias;
  strokeWeight?: FigmaVariableAlias;
  fills?: FigmaVariableAlias[];
  strokes?: FigmaVariableAlias[];
  effects?: FigmaVariableAlias[];
  layoutGrids?: FigmaVariableAlias[];
  textRangeFills?: FigmaVariableAlias[];
  componentProperties?: Record<string, FigmaVariableAlias>;
  fontFamily?: FigmaVariableAlias[];
  fontSize?: FigmaVariableAlias[];
  fontStyle?: FigmaVariableAlias[];
  fontWeight?: FigmaVariableAlias[];
  letterSpacing?: FigmaVariableAlias[];
  lineHeight?: FigmaVariableAlias[];
  paragraphSpacing?: FigmaVariableAlias[];
  paragraphIndent?: FigmaVariableAlias[];
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
  /** Main components and sets exported next to the page. */
  mains?: number;
  mainFonts?: string[];
}

export interface Snapshot {
  meta: SnapshotMeta;
  rest: {
    document: FigmaNode;
    components?: Record<string, FigmaComponentMeta>;
    componentSets?: Record<string, FigmaComponentMeta>;
  };
  svgs: Record<string, string>;
  transforms?: Record<string, NodeTransform>;
  textSegments?: Record<string, FigmaTextSegment[]>;
  /** Main components (or whole component sets) the page's instances use, by node id. */
  mains?: Record<string, FigmaNode>;
  variables?: SnapshotVariables;
  /** Render bounds of hidden vectors whose visibility is bound to a variable (REST gives them none). */
  hiddenRenderBounds?: Record<string, FigmaRect>;
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
