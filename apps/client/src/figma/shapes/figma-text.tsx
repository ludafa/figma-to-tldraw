import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import {
  RichTextArea,
  type TLRichText,
  useAtom,
  useEditableRichText,
  useEditor,
  useValue,
} from 'tldraw';

import { isFigmaEditing } from '../editing/engine';
import { fromRichText, toRichText } from '../editing/rich-text';
import { layerBlurCss, textShadowCss } from '../effects';
import { fontFamilyCss, fontStyleCss, fontVariationCss } from '../fonts';
import { rgba } from '../geometry';
import { gradientImageCss, visiblePaints } from '../paint';
import type { FigmaShape } from '../shape-types';
import type { FigmaNode, FigmaPaint, FigmaTypeStyle } from '../types';
import { FigmaShapeContainer, FigmaShapeUtil } from './base';

// See apps/docs/figma-to-tldraw/tech.md §6.4.

// See apps/docs/figma-to-tldraw/tech.md §6.7.
function gradientFill(
  style: FigmaTypeStyle,
  node: FigmaNode,
): FigmaPaint | undefined {
  const fills = visiblePaints(style.fills ?? node.fills);
  if (fills.some((p) => p.type === 'SOLID')) {
    return undefined;
  }
  return fills.find(
    (p) => p.type === 'GRADIENT_LINEAR' || p.type === 'GRADIENT_RADIAL',
  );
}

function fillColor(style: FigmaTypeStyle, node: FigmaNode): string | undefined {
  if (gradientFill(style, node)) {
    return 'transparent';
  }
  const fills = visiblePaints(style.fills ?? node.fills);
  const solid = fills.find((p) => p.type === 'SOLID');
  return solid?.color ? rgba(solid.color, solid.opacity ?? 1) : undefined;
}

const TEXT_TRANSFORM: Partial<
  Record<
    NonNullable<FigmaTypeStyle['textCase']>,
    CSSProperties['textTransform']
  >
> = {
  UPPER: 'uppercase',
  LOWER: 'lowercase',
  TITLE: 'capitalize',
};

// See apps/docs/figma-to-tldraw/tech.md §6.4.
function resolvedLineHeight(
  base: FigmaTypeStyle,
  override?: FigmaTypeStyle,
): number {
  const style = { ...base, ...override };
  const size = style.fontSize ?? 16;
  let px: number;
  if (
    override?.lineHeightPx !== undefined ||
    style.lineHeightUnit === 'PIXELS'
  ) {
    px = style.lineHeightPx ?? size * 1.2;
  } else {
    const baseSize = base.fontSize ?? 16;
    px = ((base.lineHeightPx ?? baseSize * 1.2) / baseSize) * size;
  }
  return style.lineHeightUnit === 'INTRINSIC_%' ? Math.round(px) : px;
}

function runStyle(style: FigmaTypeStyle, node: FigmaNode): CSSProperties {
  const css: CSSProperties = {
    fontFamily: fontFamilyCss(style),
    fontVariationSettings: fontVariationCss(style),
    // See apps/docs/figma-to-tldraw/tech.md §6.9.
    fontFeatureSettings: 'normal',
    fontWeight: style.fontWeight,
    fontStyle: fontStyleCss(style),
    fontSize: style.fontSize,
    color: fillColor(style, node),
    letterSpacing: style.letterSpacing ? `${style.letterSpacing}px` : undefined,
    textTransform: style.textCase ? TEXT_TRANSFORM[style.textCase] : undefined,
    fontVariant: style.textCase === 'SMALL_CAPS' ? 'small-caps' : undefined,
  };
  // See apps/docs/figma-to-tldraw/tech.md §6.4.
  const metrics = FONT_METRICS[style.fontFamily ?? 'Inter'];
  if (style.textDecoration === 'UNDERLINE') {
    css.textDecorationLine = 'underline';
    css.textDecorationThickness = 'from-font';
    css.textUnderlinePosition = 'from-font';
    if (metrics) {
      css.textUnderlineOffset = `${metrics.underline[1] / 2}em`;
    }
  } else if (style.textDecoration === 'STRIKETHROUGH') {
    if (metrics) {
      const [position, size] = metrics.strike;
      Object.assign(css, {
        backgroundImage: 'linear-gradient(currentColor, currentColor)',
        backgroundRepeat: 'no-repeat',
        backgroundSize: `100% ${size}em`,
        backgroundPositionY: `${metrics.chrome[0] - position}em`,
      } satisfies CSSProperties);
    } else {
      css.textDecorationLine = 'line-through';
      css.textDecorationThickness = 'from-font';
    }
  }
  return css;
}

interface Run {
  text: string;
  style: FigmaTypeStyle;
  lineHeight: number;
}

function textRuns(node: FigmaNode): Run[] {
  const chars = node.characters ?? '';
  const overrides = node.characterStyleOverrides ?? [];
  const table = node.styleOverrideTable ?? {};
  const base = node.style ?? {};
  const runs: Run[] = [];
  let start = 0;
  for (let i = 1; i <= chars.length; i++) {
    const prev = overrides[i - 1] ?? 0;
    const cur = i < chars.length ? (overrides[i] ?? 0) : -1;
    if (cur !== prev) {
      const override = prev ? table[String(prev)] : undefined;
      runs.push({
        text: chars.slice(start, i),
        style: override ? { ...base, ...override } : base,
        lineHeight: resolvedLineHeight(base, override),
      });
      start = i;
    }
  }
  return runs;
}

function paragraphs(runs: Run[]): Run[][] {
  const out: Run[][] = [[]];
  for (const run of runs) {
    const parts = run.text.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) {
        out.push([]);
      }
      if (part) {
        // See apps/docs/figma-to-tldraw/tech.md §12.5.
        out[out.length - 1].push({
          ...run,
          text: part.replaceAll(' ', '\n'),
        });
      }
    });
  }
  return out;
}

// See apps/docs/figma-to-tldraw/tech.md §6.4.
const FONT_METRICS: Record<
  string,
  {
    figma: [number, number];
    chrome: [number, number];
    underline: [number, number];
    strike: [number, number];
  }
> = {
  Inter: {
    figma: [2728 / 2816, 680 / 2816],
    chrome: [2728 / 2816, 680 / 2816],
    underline: [464 / 2816, 192 / 2816],
    strike: [922 / 2816, 192 / 2816],
  },
  'Noto Sans SC': {
    figma: [0.88, 0.12],
    chrome: [1.16, 0.288],
    underline: [0.125, 0.05],
    strike: [0.325, 0.05],
  },
};

// See apps/docs/figma-to-tldraw/tech.md §6.4.
function baselineShift(
  style: FigmaTypeStyle,
  boxH: number,
  paragraphCount: number,
  dpr: number,
): number {
  const metrics = FONT_METRICS[style.fontFamily ?? 'Inter'];
  if (!metrics || (style.textAlignVertical ?? 'TOP') !== 'TOP') {
    return 0;
  }
  const size = style.fontSize ?? 16;
  const lh = resolvedLineHeight(style);
  const ad = Math.round(metrics.chrome[0] * size * dpr);
  const dd = Math.round(metrics.chrome[1] * size * dpr);
  const chrome = (ad + Math.floor((lh * dpr - ad - dd) / 2)) / dpr;
  const a = metrics.figma[0] * size;
  const d = metrics.figma[1] * size;
  const auto =
    style.textAutoResize === 'HEIGHT' ||
    style.textAutoResize === 'WIDTH_AND_HEIGHT';
  const content = boxH - (paragraphCount - 1) * (style.paragraphSpacing ?? 0);
  const rest = content - Math.max(1, Math.round(content / lh)) * lh;
  const figma =
    a + (lh - a - d) / 2 + (auto && Math.abs(rest) <= 0.5 ? rest / 2 : 0);
  return Math.round(figma) - chrome;
}

// See apps/docs/figma-to-tldraw/tech.md §6.4.
function runLineStyle(
  run: Run,
  base: FigmaTypeStyle,
  baseLineHeight: number,
): CSSProperties {
  const metrics = FONT_METRICS[run.style.fontFamily ?? 'Inter'];
  const baseMetrics = FONT_METRICS[base.fontFamily ?? 'Inter'];
  if (run.lineHeight <= baseLineHeight || !metrics || !baseMetrics) {
    return { lineHeight: `${run.lineHeight}px` };
  }
  const half = ([a, d]: [number, number], size: number, lineHeight: number) =>
    a * size + (lineHeight - (a + d) * size) / 2;
  const size = run.style.fontSize ?? 16;
  const ascent = half(metrics.chrome, size, run.lineHeight);
  const baseDescent =
    baseLineHeight -
    half(baseMetrics.chrome, base.fontSize ?? 16, baseLineHeight);
  const lineHeight = ascent + baseDescent;
  const raise = ascent - half(metrics.chrome, size, lineHeight);
  return {
    lineHeight: `${lineHeight}px`,
    verticalAlign: `${raise}px`,
    position: 'relative',
    top: raise,
  };
}

interface TextLayout {
  style: FigmaTypeStyle;
  lineHeight: number;
  paras: Run[][];
  gradient: FigmaPaint | undefined;
  outer: CSSProperties;
  inner: CSSProperties;
}

function textBody(
  node: FigmaNode,
  layout: TextLayout,
  gradientLayer: boolean,
): ReactNode[] {
  const { paras, style, lineHeight } = layout;
  return paras.map((runs, i) => (
    <div
      key={i}
      style={{
        marginBottom:
          i < paras.length - 1 && style.paragraphSpacing
            ? style.paragraphSpacing
            : undefined,
      }}
    >
      {runs.length ? (
        runs.map((run, j) => (
          <span
            key={j}
            style={{
              ...runStyle(run.style, node),
              ...runLineStyle(run, style, lineHeight),
              visibility:
                gradientLayer && !gradientFill(run.style, node)
                  ? 'hidden'
                  : undefined,
            }}
          >
            {run.text}
          </span>
        ))
      ) : (
        <br />
      )}
    </div>
  ));
}

function textLayout(node: FigmaNode, w: number, h: number): TextLayout {
  const style = node.style ?? {};
  const lineHeight = resolvedLineHeight(style);
  const autoResize = style.textAutoResize ?? 'NONE';
  const truncate = style.textTruncation === 'ENDING';
  const clampLines = truncate
    ? (style.maxLines ??
      (autoResize === 'TRUNCATE' || autoResize === 'NONE'
        ? Math.max(1, Math.floor(h / lineHeight))
        : undefined))
    : undefined;

  const paras = paragraphs(textRuns(node));
  const gradient = paras
    .flat()
    .map((run) => gradientFill(run.style, node))
    .find((p) => p !== undefined);

  const justify =
    style.textAlignVertical === 'CENTER'
      ? 'center'
      : style.textAlignVertical === 'BOTTOM'
        ? 'flex-end'
        : 'flex-start';

  const inner: CSSProperties = {
    ...runStyle(style, node),
    lineHeight: `${lineHeight}px`,
    position: 'relative',
    top: baselineShift(style, h, paras.length, window.devicePixelRatio || 1),
    textAlign:
      style.textAlignHorizontal === 'JUSTIFIED'
        ? 'justify'
        : ((style.textAlignHorizontal?.toLowerCase() ??
            'left') as CSSProperties['textAlign']),
    whiteSpace: autoResize === 'WIDTH_AND_HEIGHT' ? 'pre' : 'pre-wrap',
    overflowWrap: 'break-word',
    textShadow: textShadowCss(node.effects),
    WebkitFontSmoothing: 'antialiased',
    fontKerning: 'normal',
    textRendering: 'geometricPrecision',
  };
  if (clampLines) {
    Object.assign(inner, {
      display: '-webkit-box',
      WebkitBoxOrient: 'vertical',
      WebkitLineClamp: clampLines,
      overflow: 'hidden',
    } satisfies CSSProperties);
  }

  const outer: CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: w,
    height: h,
    display: 'flex',
    flexDirection: 'column',
    justifyContent: justify,
    filter: layerBlurCss(node.effects),
  };

  return { style, lineHeight, paras, gradient, outer, inner };
}

/** The text block alone, for measuring; see tech.md §13.3. */
export function TextInner({
  node,
  w,
  h,
}: {
  node: FigmaNode;
  w: number;
  h: number;
}) {
  const layout = textLayout(node, w, h);
  return <div style={layout.inner}>{textBody(node, layout, false)}</div>;
}

export function TextContent({ shape }: { shape: FigmaShape }) {
  const { w, h, node } = shape.props;
  const layout = textLayout(node, w, h);
  const { gradient, outer, inner } = layout;

  return (
    <>
      <div style={outer}>
        <div style={inner}>{textBody(node, layout, false)}</div>
      </div>
      {gradient && (
        // See apps/docs/figma-to-tldraw/tech.md §6.7.
        <div
          style={{
            ...outer,
            backgroundImage: gradientImageCss(gradient, w, h),
            backgroundRepeat: 'no-repeat',
            backgroundClip: 'text',
            WebkitBackgroundClip: 'text',
          }}
        >
          <div style={{ ...inner, textShadow: undefined }}>
            {textBody(node, layout, true)}
          </div>
        </div>
      )}
    </>
  );
}

// See apps/docs/figma-to-tldraw/tech.md §13.3.

const UNITLESS = new Set(['fontWeight', 'lineHeight', 'opacity', 'zIndex']);

function cssText(css: CSSProperties): string {
  return Object.entries(css)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => {
      const prop = k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
      return `${prop}:${typeof v === 'number' && !UNITLESS.has(k) ? `${v}px` : v}`;
    })
    .join(';');
}

function editingColor(
  style: FigmaTypeStyle,
  node: FigmaNode,
): string | undefined {
  const gradient = gradientFill(style, node);
  const stop = gradient?.gradientStops?.[0];
  return stop
    ? rgba(stop.color, gradient.opacity ?? 1)
    : fillColor(style, node);
}

function runCss(node: FigmaNode, key: number): string {
  const base = node.style ?? {};
  const override = node.styleOverrideTable?.[String(key)];
  const style = { ...base, ...override };
  return cssText({
    ...runStyle(style, node),
    color: editingColor(style, node),
    lineHeight: `${resolvedLineHeight(base, override)}px`,
  });
}

function contentKey(node: FigmaNode): string {
  return JSON.stringify([
    node.characters,
    node.characterStyleOverrides,
    node.styleOverrideTable,
    node.style,
    node.fills,
  ]);
}

function EditableText({ shape }: { shape: FigmaShape }) {
  const editor = useEditor();
  const { w, h, node } = shape.props;
  const {
    rInput,
    isEditing,
    isReadyForEditing,
    handleFocus,
    handleBlur,
    handleKeyDown,
    handleInputPointerDown,
    handleDoubleClick,
    handlePaste,
  } = useEditableRichText(shape.id, shape.type);
  const isSelected = useValue(
    'figma text selected',
    () => editor.getOnlySelectedShapeId() === shape.id,
    [editor, shape.id],
  );
  const emitted = useAtom<{ key: string; richText: TLRichText } | null>(
    'figma emitted text',
    null,
  );
  const last = useValue(emitted);
  const fresh = useMemo(() => toRichText(node, (k) => runCss(node, k)), [node]);
  const richText = last?.key === contentKey(node) ? last.richText : fresh;

  const handleChange = useCallback(
    ({ richText }: { richText?: TLRichText }) => {
      const current = editor.getShape<FigmaShape>(shape.id);
      if (!richText || !current || editor.getEditingShapeId() !== shape.id) {
        return;
      }
      const next = fromRichText(richText, current.props.node);
      emitted.set({ key: contentKey(next), richText });
      editor.updateShape<FigmaShape>({
        id: shape.id,
        type: shape.type,
        props: { node: next },
      });
    },
    [editor, emitted, shape.id, shape.type],
  );

  const hasArea = isFigmaEditing(editor) && (isSelected || isReadyForEditing);
  const hadArea = useRef(hasArea || isEditing);
  useLayoutEffect(() => {
    if (isEditing && !hadArea.current) {
      editor.emit('select-all-text', { shapeId: shape.id });
    }
    hadArea.current = hasArea || isEditing;
  }, [editor, shape.id, isEditing, hasArea]);

  if (!isEditing && !hasArea) {
    return <TextContent shape={shape} />;
  }
  const layout = textLayout(node, w, h);
  return (
    <>
      {!isEditing && <TextContent shape={shape} />}
      <div
        style={{
          ...layout.outer,
          filter: undefined,
          pointerEvents: isEditing ? 'all' : 'none',
        }}
      >
        <div
          className="figma-text-editing"
          style={
            {
              ...layout.inner,
              display: 'block',
              WebkitLineClamp: undefined,
              overflow: 'visible',
              color: editingColor(layout.style, node),
              '--figma-paragraph-spacing': `${layout.style.paragraphSpacing ?? 0}px`,
            } as CSSProperties
          }
        >
          <RichTextArea
            ref={rInput}
            shapeId={shape.id}
            isEditing={isEditing}
            richText={richText}
            handleFocus={handleFocus}
            handleBlur={handleBlur}
            handleKeyDown={handleKeyDown}
            handleChange={handleChange}
            handleInputPointerDown={handleInputPointerDown}
            handleDoubleClick={handleDoubleClick}
            handlePaste={handlePaste}
          />
        </div>
      </div>
    </>
  );
}

export class FigmaTextShapeUtil extends FigmaShapeUtil<'figma-text'> {
  static override type = 'figma-text' as const;

  override canEdit() {
    return isFigmaEditing(this.editor);
  }

  override onEditEnd(shape: FigmaShape<'figma-text'>) {
    if (!shape.props.node.characters) {
      this.editor.deleteShapes([shape.id]);
    }
  }

  component(shape: FigmaShape<'figma-text'>) {
    return (
      <FigmaShapeContainer shape={shape}>
        <EditableText shape={shape} />
      </FigmaShapeContainer>
    );
  }
}
