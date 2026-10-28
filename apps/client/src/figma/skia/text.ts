import type {
  Canvas,
  CanvasKit,
  FontWeight,
  Paragraph,
  TextStyle,
} from 'canvaskit-wasm';

import type { FontRequest } from '../../engine/render/fonts';
import type { Resources } from '../../engine/render/resources';
import fontMetrics from '../font-metrics.json';
import { FONT_SUBSTITUTES } from '../fonts';
import { gradientMatrix } from '../paint-math';
import type { FigmaNode, FigmaPaint, FigmaTypeStyle } from '../types';
import { color4f, type Disposer, visiblePaints } from './paints';

// See apps/docs/skia-engine/tech.md §7.2.

interface Run {
  text: string;
  style: FigmaTypeStyle;
  lineHeight: number;
}

/** A run inside one paragraph, with its UTF-16 range there. */
interface PlacedRun extends Run {
  start: number;
  end: number;
}

// See apps/docs/figma-to-tldraw/tech.md §6.4.
export function resolvedLineHeight(
  base: FigmaTypeStyle,
  override?: FigmaTypeStyle,
): number {
  const style = { ...base, ...override };
  const size = style.fontSize ?? 16;
  let px: number;
  // See apps/docs/skia-engine/tech.md §7.2.
  const sameFont =
    style.lineHeightUnit === 'INTRINSIC_%' &&
    (override?.fontFamily ?? base.fontFamily) === base.fontFamily;
  if (
    (override?.lineHeightPx !== undefined && !sameFont) ||
    style.lineHeightUnit === 'PIXELS'
  ) {
    px = style.lineHeightPx ?? size * 1.2;
  } else {
    const baseSize = base.fontSize ?? 16;
    px = ((base.lineHeightPx ?? baseSize * 1.2) / baseSize) * size;
  }
  return style.lineHeightUnit === 'INTRINSIC_%' ? Math.round(px) : px;
}

// See apps/docs/skia-engine/tech.md §7.2.
function overrideStyle(
  base: FigmaTypeStyle,
  override: FigmaTypeStyle,
): FigmaTypeStyle {
  const style = { ...base, ...override };
  const ls = base.letterSpacing ?? 0;
  const size = base.fontSize ?? 16;
  const percent = (ls / size) * 100;
  if (
    ls &&
    override.letterSpacing === undefined &&
    override.fontSize !== undefined &&
    override.fontSize !== size &&
    Math.abs(percent * 10 - Math.round(percent * 10)) < 1e-3
  ) {
    style.letterSpacing = (percent / 100) * override.fontSize;
  }
  return style;
}

export function textRuns(node: FigmaNode): Run[] {
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
        style: override ? overrideStyle(base, override) : base,
        lineHeight: resolvedLineHeight(base, override),
      });
      start = i;
    }
  }
  return runs;
}

function applyCase(text: string, style: FigmaTypeStyle): string {
  switch (style.textCase) {
    case 'UPPER':
      return text.toUpperCase();
    case 'LOWER':
      return text.toLowerCase();
    case 'TITLE':
      return text.replace(
        /(^|[\s\u2028])(\p{L})/gu,
        (_, a: string, b: string) => a + b.toUpperCase(),
      );
  }
  return text;
}

// See apps/docs/figma-to-tldraw/tech.md §12.7.
export function paragraphs(runs: Run[]): Run[][] {
  const out: Run[][] = [[]];
  for (const run of runs) {
    const parts = run.text.replaceAll('\r', ' ').split('\n');
    parts.forEach((part, i) => {
      if (i > 0) {
        out.push([]);
      }
      if (part) {
        out[out.length - 1].push({ ...run, text: applyCase(part, run.style) });
      }
    });
  }
  return out;
}

// See apps/docs/figma-to-tldraw/tech.md §15.1.
function trimTrailingSpaces(paras: Run[][]): Run[][] {
  return paras.map((para) => {
    const out = [...para];
    while (out.length) {
      const last = out[out.length - 1];
      const text = last.text.replace(/[ \u2028]+$/, '');
      if (text) {
        out[out.length - 1] = { ...last, text };
        break;
      }
      out.pop();
    }
    return out;
  });
}

interface TypoMetrics {
  upem: number;
  typo: number[];
  hhea: number[];
}

const METRICS = fontMetrics as Record<string, TypoMetrics>;

interface ResolvedFont {
  requests: FontRequest[];
  variations: { axis: string; value: number }[];
  /** Family whose metrics place the baseline. */
  metricsFamily: string;
  italicFace: boolean;
}

function parseVariations(css: string): { axis: string; value: number }[] {
  return [...css.matchAll(/"(\w{4})"\s+([-\d.]+)/g)].map((m) => ({
    axis: m[1],
    value: Number(m[2]),
  }));
}

export function resolveFont(style: FigmaTypeStyle): ResolvedFont {
  const family = style.fontFamily ?? 'Inter';
  const weight = style.fontWeight ?? 400;
  const italic = !!style.italic;
  // See apps/docs/skia-engine/tech.md §7.2.
  const variations: { axis: string; value: number }[] = [];
  const requests: FontRequest[] = [];
  let metricsFamily = family;
  if (family === 'Inter' && italic) {
    requests.push({ family: 'InterVariable', weight, italic: true });
    variations.push(
      { axis: 'wght', value: weight },
      { axis: 'slnt', value: -10 },
    );
    metricsFamily = 'InterVariable';
  } else {
    requests.push({ family, weight, italic });
  }
  const sub = FONT_SUBSTITUTES[family];
  if (sub) {
    requests.push({ family: sub.family, weight, italic });
    variations.push(
      { axis: 'wght', value: weight },
      ...parseVariations(sub.variation),
    );
    if (!METRICS[family]) {
      metricsFamily = sub.family;
    }
  }
  requests.push(
    { family: 'Inter', weight, italic: false },
    { family: 'Noto Sans SC', weight: 400, italic: false },
  );
  return {
    requests,
    variations,
    metricsFamily,
    italicFace: italic && family !== 'Inter',
  };
}

/** Figma's half-leading split: [ascent part, descent part] of a line. */
function lineHalves(
  ck: CanvasKit,
  res: Resources,
  style: FigmaTypeStyle,
  lineHeight: number,
  aliases: string[],
): [number, number] {
  const size = style.fontSize ?? 16;
  const font = resolveFont(style);
  const m = METRICS[font.metricsFamily];
  let a: number;
  let d: number;
  if (m) {
    // See apps/docs/skia-engine/tech.md §7.2.
    const [asc, desc] = m.typo[2] > 0 ? m.hhea : m.typo;
    a = asc / m.upem;
    d = desc / m.upem;
  } else {
    const tf = aliases[0] ? res.fonts.typeface(aliases[0]) : undefined;
    const fm = tf ? new ck.Font(tf, size) : undefined;
    const metrics = fm?.getMetrics();
    fm?.delete();
    a = metrics ? -metrics.ascent / size : 0.9;
    d = metrics ? metrics.descent / size : 0.25;
  }
  const ascent = a * size + (lineHeight - (a + d) * size) / 2;
  return [ascent, lineHeight - ascent];
}

interface Decoration {
  kind: 'UNDERLINE' | 'STRIKETHROUGH';
  start: number;
  end: number;
  style: FigmaTypeStyle;
  aliases: string[];
}

export interface TextLine {
  /** Single-line paragraphs: the visible text, and the gradient mask pass. */
  para: Paragraph;
  mask?: Paragraph;
  x: number;
  baseline: number;
  top: number;
  height: number;
  width: number;
  decorations: Decoration[];
  /** First UTF-16 offset of the line in `node.characters`. */
  sourceStart: number;
}

export interface FigmaTextLayout {
  lines: TextLine[];
  /** Height of all lines and paragraph spacing. */
  contentHeight: number;
  /** Widest line. */
  contentWidth: number;
  gradient?: FigmaPaint;
  complete: boolean;
}

// See apps/docs/figma-to-tldraw/tech.md §6.7.
function gradientFill(style: FigmaTypeStyle, node: FigmaNode) {
  const fills = visiblePaints(style.fills ?? node.fills);
  if (fills.some((p) => p.type === 'SOLID')) {
    return undefined;
  }
  return fills.find((p) => p.type.startsWith('GRADIENT_'));
}

function solidColor(ck: CanvasKit, style: FigmaTypeStyle, node: FigmaNode) {
  const solid = visiblePaints(style.fills ?? node.fills).find(
    (p) => p.type === 'SOLID',
  );
  return solid?.color
    ? color4f(ck, solid.color, solid.opacity ?? 1)
    : ck.TRANSPARENT;
}

interface BuildOptions {
  maxLines?: number;
  ellipsis?: boolean;
  /** 'mask': gradient runs opaque black, others clear. */
  pass?: 'normal' | 'mask';
}

class TextBuilder {
  ck: CanvasKit;
  res: Resources;
  node: FigmaNode;
  complete = true;
  private styleCache = new Map<string, { aliases: string[] }>();

  constructor(ck: CanvasKit, res: Resources, node: FigmaNode) {
    this.ck = ck;
    this.res = res;
    this.node = node;
  }

  aliases(style: FigmaTypeStyle, text: string): string[] {
    const font = resolveFont(style);
    const key = `${JSON.stringify(font.requests)}|${text}`;
    const hit = this.styleCache.get(key);
    if (hit) {
      return hit.aliases;
    }
    const { aliases, ready } = this.res.fonts.aliasesFor(font.requests, text);
    if (!ready) {
      this.complete = false;
      this.res.markIncomplete();
    }
    this.styleCache.set(key, { aliases });
    return aliases;
  }

  textStyle(run: Run, pass: BuildOptions['pass']): TextStyle {
    const ck = this.ck;
    const style = run.style;
    const font = resolveFont(style);
    const gradient = gradientFill(style, this.node);
    let color = solidColor(ck, style, this.node);
    if (pass === 'mask') {
      color = gradient ? ck.BLACK : ck.TRANSPARENT;
    } else if (gradient) {
      color = ck.TRANSPARENT;
    }
    return new ck.TextStyle({
      color,
      fontFamilies: this.aliases(style, run.text),
      fontSize: style.fontSize ?? 16,
      fontStyle: {
        weight: { value: style.fontWeight ?? 400 } as FontWeight,
        slant: font.italicFace ? ck.FontSlant.Italic : ck.FontSlant.Upright,
      },
      fontVariations: font.variations,
      letterSpacing: style.letterSpacing ?? 0,
      fontFeatures:
        style.textCase === 'SMALL_CAPS' ? [{ name: 'smcp', value: 1 }] : [],
    });
  }

  build(runs: PlacedRun[], from: number, to: number, opts: BuildOptions = {}) {
    const ck = this.ck;
    const base = runs[0]?.style ?? this.node.style ?? {};
    const ps = new ck.ParagraphStyle({
      textStyle: this.textStyle(
        { text: ' ', style: base, lineHeight: 0 },
        opts.pass,
      ),
      applyRoundingHack: false,
      maxLines: opts.maxLines,
      ellipsis: opts.ellipsis ? '…' : undefined,
      textAlign: ck.TextAlign.Left,
    });
    const b = ck.ParagraphBuilder.MakeFromFontCollection(
      ps,
      this.res.fonts.getCollection(),
    );
    for (const r of runs) {
      const s = Math.max(r.start, from);
      const e = Math.min(r.end, to);
      if (e <= s) {
        continue;
      }
      b.pushStyle(this.textStyle(r, opts.pass));
      b.addText(r.text.slice(s - r.start, e - r.start));
      b.pop();
    }
    const p = b.build();
    b.delete();
    return p;
  }
}

export function layoutText(
  ck: CanvasKit,
  res: Resources,
  node: FigmaNode,
  w: number,
  h: number,
): FigmaTextLayout {
  const style = node.style ?? {};
  const autoResize = style.textAutoResize ?? 'NONE';
  const align = style.textAlignHorizontal ?? 'LEFT';
  const wide = autoResize === 'WIDTH_AND_HEIGHT';
  const builder = new TextBuilder(ck, res, node);
  let paras = paragraphs(textRuns(node));
  if (!wide && (align === 'CENTER' || align === 'RIGHT')) {
    paras = trimTrailingSpaces(paras);
  }
  const baseLH = resolvedLineHeight(style);
  const baseAliases = builder.aliases(style, node.characters || ' ');
  const [baseA, baseD] = lineHalves(ck, res, style, baseLH, baseAliases);
  const truncate = style.textTruncation === 'ENDING';
  const maxLines = truncate
    ? (style.maxLines ??
      (autoResize === 'TRUNCATE' || autoResize === 'NONE'
        ? Math.max(1, Math.floor(h / baseLH))
        : undefined))
    : undefined;
  const gradient = paras
    .flat()
    .map((r) => gradientFill(r.style, node))
    .find((p) => p !== undefined);

  const lines: TextLine[] = [];
  // See apps/docs/skia-engine/tech.md §7.2.
  let top = 0;
  let lastD: number | undefined;
  const place = (a: number, d: number) => {
    if (lastD !== undefined) {
      top += d;
    }
    lastD = d;
    const baseline = top + a;
    top += a;
    return baseline;
  };
  let width = 0;
  let sourceOffset = 0;
  const spacing = style.paragraphSpacing ?? 0;
  let truncated = false;

  for (const [pi, runs] of paras.entries()) {
    if (truncated) {
      break;
    }
    if (pi > 0) {
      top += spacing;
    }
    const placed: PlacedRun[] = [];
    let at = 0;
    for (const r of runs) {
      placed.push({ ...r, start: at, end: at + r.text.length });
      at += r.text.length;
    }
    const paraText = placed.map((r) => r.text).join('');
    if (!placed.length) {
      const empty = builder.build([], 0, 0);
      const baseline = place(baseA, baseD);
      lines.push({
        para: empty,
        x: 0,
        baseline,
        top: baseline - baseA,
        height: baseA + baseD,
        width: 0,
        decorations: [],
        sourceStart: sourceOffset,
      });
      sourceOffset += 1;
      if (maxLines !== undefined && lines.length >= maxLines) {
        truncated = pi < paras.length - 1;
      }
      continue;
    }
    const full = builder.build(placed, 0, paraText.length);
    full.layout(wide ? 1e7 : Math.max(w, 1) + 0.01);
    const metrics = full.getLineMetrics();
    full.delete();
    for (const [li, lm] of metrics.entries()) {
      const last = maxLines !== undefined && lines.length === maxLines - 1;
      const more = li < metrics.length - 1 || pi < paras.length - 1;
      const start = lm.startIndex;
      let end = wide ? lm.endIndex : lm.endExcludingWhitespaces;
      if (last && more) {
        end = paraText.length;
      }
      const inLine = placed.filter(
        (r) => r.end > start && r.start < Math.max(end, start + 1),
      );
      let a = baseA;
      let d = baseD;
      for (const r of inLine) {
        if (r.lineHeight > baseLH) {
          const [ra, rd] = lineHalves(
            ck,
            res,
            r.style,
            r.lineHeight,
            builder.aliases(r.style, r.text),
          );
          a = Math.max(a, ra);
          d = Math.max(d, rd);
        }
      }
      const para =
        last && more
          ? builder.build(placed, start, end, { maxLines: 1, ellipsis: true })
          : builder.build(placed, start, end);
      para.layout(last && more ? Math.max(w, 1) + 0.01 : 1e7);
      const lineWidth =
        last && more
          ? (para.getLineMetrics()[0]?.width ?? 0)
          : para.getMaxIntrinsicWidth();
      let mask: Paragraph | undefined;
      if (gradient) {
        mask =
          last && more
            ? builder.build(placed, start, end, {
                maxLines: 1,
                ellipsis: true,
                pass: 'mask',
              })
            : builder.build(placed, start, end, { pass: 'mask' });
        mask.layout(last && more ? Math.max(w, 1) + 0.01 : 1e7);
      }
      const decorations: Decoration[] = [];
      for (const r of inLine) {
        const deco = r.style.textDecoration;
        if (deco === 'UNDERLINE' || deco === 'STRIKETHROUGH') {
          decorations.push({
            kind: deco,
            start: Math.max(r.start, start) - start,
            end: Math.min(r.end, end) - start,
            style: r.style,
            aliases: builder.aliases(r.style, r.text),
          });
        }
      }
      const x =
        align === 'CENTER'
          ? (w - lineWidth) / 2
          : align === 'RIGHT'
            ? w - lineWidth
            : 0;
      const baseline = place(a, d);
      lines.push({
        para,
        mask,
        x,
        baseline,
        top: baseline - a,
        height: a + d,
        width: lineWidth,
        decorations,
        sourceStart: sourceOffset + start,
      });
      width = Math.max(width, lineWidth);
      if (last) {
        truncated = more;
        break;
      }
    }
    sourceOffset += paraText.length + 1;
  }

  const contentHeight = top + (lastD ?? 0);
  const vertical = style.textAlignVertical ?? 'TOP';
  let offset = 0;
  if (vertical === 'CENTER') {
    offset = (h - contentHeight) / 2;
  } else if (vertical === 'BOTTOM') {
    offset = h - contentHeight;
  } else if (
    (autoResize === 'HEIGHT' || wide) &&
    Math.abs(h - contentHeight) <= 0.5
  ) {
    offset = (h - contentHeight) / 2;
  }
  for (const line of lines) {
    line.top += offset;
    line.baseline = Math.round(line.baseline + offset);
  }
  return {
    lines,
    contentHeight,
    contentWidth: width,
    gradient,
    complete: builder.complete,
  };
}

function drawDecorations(
  ck: CanvasKit,
  canvas: Canvas,
  res: Resources,
  node: FigmaNode,
  line: TextLine,
  d: Disposer,
  lsShift: number,
) {
  for (const deco of line.decorations) {
    const rects = line.para.getRectsForRange(
      deco.start,
      deco.end,
      ck.RectHeightStyle.Tight,
      ck.RectWidthStyle.Tight,
    );
    if (!rects.length) {
      continue;
    }
    let x0 = Infinity;
    let x1 = -Infinity;
    for (const r of rects) {
      x0 = Math.min(x0, r.rect[0]);
      x1 = Math.max(x1, r.rect[2]);
    }
    const size = deco.style.fontSize ?? 16;
    const tf = deco.aliases[0]
      ? res.fonts.typeface(deco.aliases[0])
      : undefined;
    const font = tf ? new ck.Font(tf, size) : undefined;
    const m = font?.getMetrics();
    font?.delete();
    let y: number;
    let thickness: number;
    if (deco.kind === 'UNDERLINE') {
      thickness = m?.underlineThickness ?? size / 14;
      y = line.baseline + (m?.underlinePosition ?? size / 10) + thickness / 2;
    } else {
      thickness = m?.strikeoutThickness ?? size / 14;
      y = line.baseline + (m?.strikeoutPosition ?? -size * 0.3);
    }
    const p = d.keep(new ck.Paint());
    p.setAntiAlias(true);
    p.setColor(solidColor(ck, deco.style, node));
    canvas.drawRect(
      ck.LTRBRect(
        line.x + x0 + lsShift,
        y,
        line.x + x1 + lsShift,
        y + thickness,
      ),
      p,
    );
  }
}

/** Draws a laid-out text box in its local space. */
export function drawText(
  ck: CanvasKit,
  canvas: Canvas,
  res: Resources,
  node: FigmaNode,
  layout: FigmaTextLayout,
  w: number,
  h: number,
  d: Disposer,
) {
  for (const line of layout.lines) {
    const ls = node.style?.letterSpacing ?? 0;
    const shift = -ls / 2;
    canvas.drawParagraph(
      line.para,
      line.x + shift,
      line.baseline - line.para.getAlphabeticBaseline(),
    );
    drawDecorations(ck, canvas, res, node, line, d, shift);
  }
  const gradient = layout.gradient;
  if (!gradient) {
    return;
  }
  const g = gradientMatrix(gradient, w, h);
  const stops = gradient.gradientStops ?? [];
  const colors = stops.map((s) => color4f(ck, s.color));
  const pos = stops.map((s) => s.position);
  const m = [g[0][0], g[0][1], g[0][2], g[1][0], g[1][1], g[1][2], 0, 0, 1];
  const shader =
    gradient.type === 'GRADIENT_RADIAL'
      ? ck.Shader.MakeRadialGradient(
          [0, 0],
          1,
          colors,
          pos,
          ck.TileMode.Clamp,
          m,
        )
      : gradient.type === 'GRADIENT_ANGULAR'
        ? ck.Shader.MakeSweepGradient(0, 0, colors, pos, ck.TileMode.Clamp, m)
        : ck.Shader.MakeLinearGradient(
            [0, 0],
            [1, 0],
            colors,
            pos,
            ck.TileMode.Clamp,
            m,
          );
  d.keep(shader);
  canvas.saveLayer();
  for (const line of layout.lines) {
    if (line.mask) {
      const ls = node.style?.letterSpacing ?? 0;
      canvas.drawParagraph(
        line.mask,
        line.x - ls / 2,
        line.baseline - line.mask.getAlphabeticBaseline(),
      );
    }
  }
  const p = d.keep(new ck.Paint());
  p.setShader(shader);
  p.setAlphaf(gradient.opacity ?? 1);
  p.setBlendMode(ck.BlendMode.SrcIn);
  canvas.drawPaint(p);
  canvas.restore();
}

export function disposeLayout(layout: FigmaTextLayout) {
  for (const line of layout.lines) {
    line.para.delete();
    line.mask?.delete();
  }
}
