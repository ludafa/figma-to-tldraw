import type { CSSProperties, ReactNode } from 'react';

import { layerBlurCss, textShadowCss } from '../effects';
import { fontFamilyCss, fontStyleCss } from '../fonts';
import { rgba } from '../geometry';
import { visiblePaints } from '../paint';
import type { FigmaShape } from '../shape-types';
import type { FigmaNode, FigmaTypeStyle } from '../types';
import { FigmaShapeContainer, FigmaShapeUtil } from './base';

// See apps/docs/figma-to-tldraw/tech.md §6.4.

function fillColor(style: FigmaTypeStyle, node: FigmaNode): string | undefined {
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
function lineHeightCss(style: FigmaTypeStyle): string | number {
  const size = style.fontSize ?? 16;
  const px = style.lineHeightPx ?? size * 1.2;
  return style.lineHeightUnit === 'PIXELS' ? `${px}px` : px / size;
}

function runStyle(style: FigmaTypeStyle, node: FigmaNode): CSSProperties {
  const css: CSSProperties = {
    fontFamily: fontFamilyCss(style),
    fontWeight: style.fontWeight,
    fontStyle: fontStyleCss(style),
    fontSize: style.fontSize,
    color: fillColor(style, node),
    letterSpacing: style.letterSpacing ? `${style.letterSpacing}px` : undefined,
    textTransform: style.textCase ? TEXT_TRANSFORM[style.textCase] : undefined,
    fontVariant: style.textCase === 'SMALL_CAPS' ? 'small-caps' : undefined,
  };
  if (style.textDecoration === 'UNDERLINE') {
    css.textDecorationLine = 'underline';
  } else if (style.textDecoration === 'STRIKETHROUGH') {
    css.textDecorationLine = 'line-through';
  }
  if (css.textDecorationLine) {
    css.textDecorationThickness = 'from-font';
    css.textUnderlinePosition = 'from-font';
  }
  return css;
}

interface Run {
  text: string;
  style: FigmaTypeStyle;
  ownLineHeight?: boolean;
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
        ownLineHeight: override?.lineHeightPx !== undefined,
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
        out[out.length - 1].push({ ...run, text: part });
      }
    });
  }
  return out;
}

const INTER_ASCENT = 2728 / 2816;
const INTER_DESCENT = 680 / 2816;

// See apps/docs/figma-to-tldraw/tech.md §6.4.
function baselineShift(
  style: FigmaTypeStyle,
  boxH: number,
  paragraphCount: number,
  dpr: number,
): number {
  if (
    (style.fontFamily ?? 'Inter') !== 'Inter' ||
    (style.textAlignVertical ?? 'TOP') !== 'TOP'
  ) {
    return 0;
  }
  const size = style.fontSize ?? 16;
  const lh = style.lineHeightPx ?? size * 1.2;
  const a = INTER_ASCENT * size;
  const d = INTER_DESCENT * size;
  const ad = Math.round(a * dpr);
  const dd = Math.round(d * dpr);
  const chrome = (ad + Math.floor((lh * dpr - ad - dd) / 2)) / dpr;
  const auto =
    style.textAutoResize === 'HEIGHT' ||
    style.textAutoResize === 'WIDTH_AND_HEIGHT';
  const content = boxH - (paragraphCount - 1) * (style.paragraphSpacing ?? 0);
  const rest = content - Math.max(1, Math.round(content / lh)) * lh;
  const figma =
    a + (lh - a - d) / 2 + (auto && Math.abs(rest) <= 0.5 ? rest / 2 : 0);
  return Math.round(figma) - chrome;
}

export function TextContent({ shape }: { shape: FigmaShape }) {
  const { w, h, node } = shape.props;
  const style = node.style ?? {};
  const lineHeight = style.lineHeightPx ?? (style.fontSize ?? 16) * 1.2;
  const autoResize = style.textAutoResize ?? 'NONE';
  const truncate = style.textTruncation === 'ENDING';
  const clampLines = truncate
    ? (style.maxLines ??
      (autoResize === 'TRUNCATE' || autoResize === 'NONE'
        ? Math.max(1, Math.floor(h / lineHeight))
        : undefined))
    : undefined;

  const paras = paragraphs(textRuns(node));
  const body: ReactNode[] = paras.map((runs, i) => (
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
              lineHeight: run.ownLineHeight
                ? lineHeightCss(run.style)
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

  const justify =
    style.textAlignVertical === 'CENTER'
      ? 'center'
      : style.textAlignVertical === 'BOTTOM'
        ? 'flex-end'
        : 'flex-start';

  const inner: CSSProperties = {
    ...runStyle(style, node),
    lineHeight: lineHeightCss(style),
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

  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: w,
        height: h,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: justify,
        filter: layerBlurCss(node.effects),
      }}
    >
      <div style={inner}>{body}</div>
    </div>
  );
}

export class FigmaTextShapeUtil extends FigmaShapeUtil<'figma-text'> {
  static override type = 'figma-text' as const;

  component(shape: FigmaShape<'figma-text'>) {
    return (
      <FigmaShapeContainer shape={shape}>
        <TextContent shape={shape} />
      </FigmaShapeContainer>
    );
  }
}
