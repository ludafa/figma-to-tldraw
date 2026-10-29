import type {
  Canvas,
  CanvasKit,
  Color,
  FontWeight,
  Paint,
  Paragraph,
  TextShadow,
  TextStyle,
} from 'canvaskit-wasm';

import type { FontRequest } from '../../engine/render/fonts';
import type { Resources } from '../../engine/render/resources';
import fontMetrics from '../font-metrics.json';
import { FONT_SUBSTITUTES } from '../fonts';
import type {
  FigmaAutoLength,
  FigmaNode,
  FigmaPaint,
  FigmaTextSegment,
  FigmaTypeStyle,
} from '../types';
import {
  color4f,
  type Disposer,
  type PaintSource,
  skiaBlend,
  skiaPaint,
  visiblePaints,
} from './paints';

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
  const baseSize = base.fontSize ?? 16;
  if (style.lineHeightUnit === 'INTRINSIC_%') {
    // See apps/docs/skia-engine/tech.md §11.2.
    const ratio =
      style.fontFamily === base.fontFamily &&
      base.lineHeightUnit === 'INTRINSIC_%' &&
      base.lineHeightPx !== undefined
        ? base.lineHeightPx / baseSize
        : (intrinsicRatio(style) ?? (style.lineHeightPx ?? size * 1.2) / size);
    return Math.round(ratio * size);
  }
  if (
    override?.lineHeightPx !== undefined ||
    style.lineHeightUnit === 'PIXELS'
  ) {
    return style.lineHeightPx ?? size * 1.2;
  }
  return ((base.lineHeightPx ?? baseSize * 1.2) / baseSize) * size;
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

function applyCase(
  text: string,
  style: FigmaTypeStyle,
  before: string,
): string {
  switch (style.textCase) {
    case 'UPPER':
      return text.toUpperCase();
    case 'LOWER':
      return text.toLowerCase();
    case 'TITLE': {
      // See apps/docs/skia-engine/tech.md §11.9.
      const midWord = before !== '' && !/[\s\u2028]/u.test(before);
      return text.replace(
        /(^|[\s\u2028])(\p{L})/gu,
        (m: string, a: string, b: string, at: number) =>
          at === 0 && midWord ? m : a + b.toUpperCase(),
      );
    }
  }
  return text;
}

// See apps/docs/figma-to-tldraw/tech.md §12.7.
export function paragraphs(runs: Run[]): Run[][] {
  const out: Run[][] = [[]];
  let before = '';
  for (const run of runs) {
    const parts = run.text.replaceAll('\r', ' ').split('\n');
    parts.forEach((part, i) => {
      if (i > 0) {
        out.push([]);
        before = '';
      }
      if (part) {
        out[out.length - 1].push({
          ...run,
          text: applyCase(part, run.style, before),
        });
        before = part.slice(-1);
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

// See apps/docs/skia-engine/tech.md §11.2.
const INTRINSIC_RATIOS: Record<string, number> = { 'Noto Sans SC': 1.2 };

function intrinsicRatio(style: FigmaTypeStyle): number | undefined {
  const family = resolveFont(style).metricsFamily;
  const m = METRICS[family];
  return (
    INTRINSIC_RATIOS[family] ??
    (m ? (m.hhea[0] + m.hhea[1] + m.hhea[2]) / m.upem : undefined)
  );
}

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
  seg?: FigmaTextSegment;
}

export interface TextLine {
  /** Single-line paragraphs: the visible text, and one mask per `fills` entry. */
  para: Paragraph;
  masks: (Paragraph | undefined)[];
  x: number;
  baseline: number;
  top: number;
  height: number;
  width: number;
  decorations: Decoration[];
  /** First UTF-16 offset of the line in `node.characters`. */
  sourceStart: number;
  /** List bullet or number, on the first line of a list item. */
  marker?: { para: Paragraph; x: number; width: number };
  /** Glyph outlines for the node's strokes, and all glyphs filled to clip them. */
  strokes?: { outline: Paragraph; glyphs?: Paragraph };
  /** All glyphs filled, for underlines that skip around them. */
  inkCut?: Paragraph;
}

export interface FigmaTextLayout {
  lines: TextLine[];
  /** Height of all lines and paragraph spacing. */
  contentHeight: number;
  /** Widest line. */
  contentWidth: number;
  /** Fills drawn through glyph masks, one list per distinct run fill. */
  fills: FigmaPaint[][];
  complete: boolean;
}

function isPlainSolid(p: FigmaPaint) {
  return (
    p.type === 'SOLID' &&
    (!p.blendMode || p.blendMode === 'NORMAL' || p.blendMode === 'PASS_THROUGH')
  );
}

// See apps/docs/skia-engine/tech.md §11.3.
function layeredFills(
  style: FigmaTypeStyle,
  node: FigmaNode,
): FigmaPaint[] | undefined {
  const fills = visiblePaints(style.fills ?? node.fills);
  return fills.every(isPlainSolid) ? undefined : fills;
}

function fillKey(fills: FigmaPaint[]) {
  return JSON.stringify(fills);
}

function solidColor(ck: CanvasKit, style: FigmaTypeStyle, node: FigmaNode) {
  let r = 0;
  let g = 0;
  let b = 0;
  let a = 0;
  for (const p of visiblePaints(style.fills ?? node.fills)) {
    if (p.type !== 'SOLID' || !p.color) {
      continue;
    }
    const pa = p.color.a * (p.opacity ?? 1);
    r = p.color.r * pa + r * (1 - pa);
    g = p.color.g * pa + g * (1 - pa);
    b = p.color.b * pa + b * (1 - pa);
    a = pa + a * (1 - pa);
  }
  return a > 0 ? ck.Color4f(r / a, g / a, b / a, a) : ck.TRANSPARENT;
}

function dropShadows(node: FigmaNode) {
  return (node.effects ?? []).filter(
    (e) => e.visible !== false && e.type === 'DROP_SHADOW',
  );
}

// See apps/docs/skia-engine/tech.md §7.6.
export function textShadows(ck: CanvasKit, node: FigmaNode): TextShadow[] {
  return dropShadows(node).map((e) => ({
    color: e.color ? color4f(ck, e.color) : ck.Color4f(0, 0, 0, 0.25),
    offset: [e.offset?.x ?? 0, e.offset?.y ?? 0],
    blurRadius: e.radius / 2,
  }));
}

export interface Edges {
  l: number;
  t: number;
  r: number;
  b: number;
}

/** Grows the box the glyphs cover so it also covers their drop shadows. */
export function withTextShadows(node: FigmaNode, box: Edges): Edges {
  const out = { ...box };
  for (const e of dropShadows(node)) {
    const blur = e.radius * 1.5;
    const dx = e.offset?.x ?? 0;
    const dy = e.offset?.y ?? 0;
    out.l = Math.min(out.l, box.l + dx - blur);
    out.t = Math.min(out.t, box.t + dy - blur);
    out.r = Math.max(out.r, box.r + dx + blur);
    out.b = Math.max(out.b, box.b + dy + blur);
  }
  return out;
}

interface BuildOptions {
  maxLines?: number;
  ellipsis?: boolean;
  /** Width of an empty box before the text (first-line indent). */
  indent?: number;
  /**
   * 'mask': runs whose layered fills match `maskKey` (or every run for
   * `ALL_GLYPHS`) opaque black, others clear. 'stroke': black glyph outlines.
   */
  pass?: 'normal' | 'mask' | 'stroke';
  maskKey?: string;
  strokeWidth?: number;
}

const ALL_GLYPHS = '*';

// See apps/docs/skia-engine/tech.md §11.6.
function textStroke(node: FigmaNode) {
  const weight = node.strokeWeight ?? 1;
  if (!visiblePaints(node.strokes).length || weight <= 0) {
    return undefined;
  }
  const align = node.strokeAlign ?? 'OUTSIDE';
  return { align, width: align === 'CENTER' ? weight : weight * 2 };
}

/** How far a text node's stroke reaches outside its glyphs. */
export function textStrokeOutset(node: FigmaNode): number {
  const stroke = textStroke(node);
  return stroke && stroke.align !== 'INSIDE' ? stroke.width / 2 : 0;
}

class TextBuilder {
  ck: CanvasKit;
  res: Resources;
  node: FigmaNode;
  complete = true;
  private shadows: TextShadow[];
  private styleCache = new Map<string, { aliases: string[] }>();

  constructor(ck: CanvasKit, res: Resources, node: FigmaNode) {
    this.ck = ck;
    this.res = res;
    this.node = node;
    this.shadows = textShadows(ck, node);
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

  textStyle(run: Run, opts: BuildOptions): TextStyle {
    const ck = this.ck;
    const style = run.style;
    const font = resolveFont(style);
    const pass = opts.pass;
    const layered = layeredFills(style, this.node);
    let color: Color;
    if (pass === 'stroke') {
      color = ck.BLACK;
    } else if (pass === 'mask') {
      color =
        opts.maskKey === ALL_GLYPHS ||
        (layered && fillKey(layered) === opts.maskKey)
          ? ck.BLACK
          : ck.TRANSPARENT;
    } else {
      color = layered ? ck.TRANSPARENT : solidColor(ck, style, this.node);
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
      shadows: pass === 'mask' || pass === 'stroke' ? [] : this.shadows,
    });
  }

  build(runs: PlacedRun[], from: number, to: number, opts: BuildOptions = {}) {
    const ck = this.ck;
    const base = runs[0]?.style ?? this.node.style ?? {};
    const ps = new ck.ParagraphStyle({
      textStyle: this.textStyle(
        { text: ' ', style: base, lineHeight: 0 },
        opts,
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
    if (opts.indent) {
      b.addPlaceholder(
        opts.indent,
        0,
        ck.PlaceholderAlignment.Baseline,
        ck.TextBaseline.Alphabetic,
        0,
      );
    }
    let fg: Paint | undefined;
    let bg: Paint | undefined;
    if (opts.pass === 'stroke') {
      fg = new ck.Paint();
      fg.setAntiAlias(true);
      fg.setStyle(ck.PaintStyle.Stroke);
      fg.setStrokeWidth(opts.strokeWidth ?? 1);
      fg.setStrokeJoin(
        this.node.strokeJoin === 'ROUND'
          ? ck.StrokeJoin.Round
          : this.node.strokeJoin === 'BEVEL'
            ? ck.StrokeJoin.Bevel
            : ck.StrokeJoin.Miter,
      );
      fg.setColor(ck.BLACK);
      bg = new ck.Paint();
      bg.setColor(ck.TRANSPARENT);
    }
    for (const r of runs) {
      const s = Math.max(r.start, from);
      const e = Math.min(r.end, to);
      if (e <= s) {
        continue;
      }
      if (fg && bg) {
        b.pushPaintStyle(this.textStyle(r, opts), fg, bg);
      } else {
        b.pushStyle(this.textStyle(r, opts));
      }
      b.addText(r.text.slice(s - r.start, e - r.start));
      b.pop();
    }
    const p = b.build();
    b.delete();
    fg?.delete();
    bg?.delete();
    return p;
  }
}

// See apps/docs/skia-engine/tech.md §11.4.
function segmentAt(node: FigmaNode, offset: number) {
  const segs = node.textSegments ?? [];
  return (
    segs.find((seg) => seg.start <= offset && offset < seg.end) ?? segs.at(-1)
  );
}

function styleAt(runs: Run[], offset: number): FigmaTypeStyle | undefined {
  let at = 0;
  for (const r of runs) {
    if (offset < at + r.text.length) {
      return r.style;
    }
    at += r.text.length;
  }
  return runs.at(-1)?.style;
}

const LIST_INDENT_EM = 1.5;

function alphaNumber(n: number) {
  let out = '';
  for (let k = n; k > 0; k = Math.floor((k - 1) / 26)) {
    out = String.fromCharCode(97 + ((k - 1) % 26)) + out;
  }
  return out;
}

function romanNumber(n: number) {
  const digits: [number, string][] = [
    [1000, 'm'],
    [900, 'cm'],
    [500, 'd'],
    [400, 'cd'],
    [100, 'c'],
    [90, 'xc'],
    [50, 'l'],
    [40, 'xl'],
    [10, 'x'],
    [9, 'ix'],
    [5, 'v'],
    [4, 'iv'],
    [1, 'i'],
  ];
  let out = '';
  let k = n;
  for (const [v, d] of digits) {
    for (; k >= v; k -= v) {
      out += d;
    }
  }
  return out;
}

// See apps/docs/skia-engine/tech.md §11.5.
export function listMarker(
  type: 'ORDERED' | 'UNORDERED',
  level: number,
  n: number,
): string {
  if (type === 'UNORDERED') {
    return '•';
  }
  const kind = (Math.max(level, 1) - 1) % 3;
  return `${kind === 1 ? alphaNumber(n) : kind === 2 ? romanNumber(n) : n}.`;
}

interface ParagraphInfo {
  start: number;
  type: 'NONE' | 'ORDERED' | 'UNORDERED';
  level: number;
  indent: number;
  firstIndent: number;
  spacing: number;
  listSpacing: number;
  marker?: { text: string; style: FigmaTypeStyle; unit: number };
}

// See apps/docs/skia-engine/tech.md §11.4.
function paragraphInfo(node: FigmaNode, count: number): ParagraphInfo[] {
  const style = node.style ?? {};
  const runs = textRuns(node);
  const chars = (node.characters ?? '').replaceAll('\r', ' ');
  const out: ParagraphInfo[] = [];
  const counters: number[] = [];
  const kinds: string[] = [];
  let start = 0;
  for (let i = 0; i < count; i++) {
    const nl = chars.indexOf('\n', start);
    const end = nl < 0 ? chars.length : nl;
    const seg = segmentAt(node, start);
    const type = node.lineTypes?.[i] ?? 'NONE';
    const level = node.lineIndentations?.[i] ?? 0;
    const markerStyle =
      styleAt(runs, end < chars.length ? end : Math.max(end - 1, start)) ??
      style;
    const unit = (markerStyle.fontSize ?? 16) * LIST_INDENT_EM;
    let marker: ParagraphInfo['marker'];
    if (type === 'NONE') {
      counters.length = 0;
      kinds.length = 0;
    } else {
      counters.length = Math.min(counters.length, level + 1);
      kinds.length = Math.min(kinds.length, level + 1);
      if (kinds[level] !== type) {
        counters[level] = 0;
        kinds[level] = type;
      }
      counters[level] = (counters[level] ?? 0) + 1;
      marker = {
        text: listMarker(type, level, counters[level]),
        style: markerStyle,
        unit,
      };
    }
    out.push({
      start,
      type,
      level,
      indent: level * unit,
      firstIndent:
        type === 'NONE'
          ? (seg?.paragraphIndent ?? style.paragraphIndent ?? 0)
          : 0,
      spacing: seg?.paragraphSpacing ?? style.paragraphSpacing ?? 0,
      listSpacing: seg?.listSpacing ?? style.listSpacing ?? 0,
      marker,
    });
    start = end + 1;
  }
  return out;
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
  const fillSets = new Map<string, FigmaPaint[]>();
  for (const r of paras.flat()) {
    const fills = layeredFills(r.style, node);
    if (fills) {
      fillSets.set(fillKey(fills), fills);
    }
  }
  const fillKeys = [...fillSets.keys()];
  const stroke = textStroke(node);

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
  let truncated = false;
  const infos = paragraphInfo(node, paras.length);

  for (const [pi, runs] of paras.entries()) {
    if (truncated) {
      break;
    }
    const info = infos[pi];
    if (pi > 0) {
      // See apps/docs/skia-engine/tech.md §11.4.
      const prev = infos[pi - 1];
      top +=
        prev.type !== 'NONE' && info.type !== 'NONE'
          ? prev.listSpacing
          : prev.spacing;
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
        masks: [],
        x: info.indent,
        baseline,
        top: baseline - baseA,
        height: baseA + baseD,
        width: 0,
        decorations: [],
        sourceStart: info.start,
      });
      if (maxLines !== undefined && lines.length >= maxLines) {
        truncated = pi < paras.length - 1;
      }
      continue;
    }
    // See apps/docs/skia-engine/tech.md §11.4.
    const full = builder.build(placed, 0, paraText.length, {
      indent: info.firstIndent,
    });
    const shift = info.firstIndent ? 1 : 0;
    const lsAt = (i: number) =>
      placed.find((r) => r.start <= i && i < r.end)?.style.letterSpacing ?? 0;
    const wrapRoom = Math.max(w - info.indent, 1);
    // See apps/docs/skia-engine/tech.md §11.7.
    let extra = Math.max(...placed.map((r) => r.style.letterSpacing ?? 0));
    let metrics = [];
    for (let attempt = 0; ; attempt++) {
      full.layout(wide ? 1e7 : wrapRoom + extra + 0.01);
      metrics = full.getLineMetrics();
      if (wide || attempt === 3) {
        break;
      }
      const over = metrics.find(
        (lm) =>
          lm.width - lsAt(lm.endExcludingWhitespaces - 1 - shift) >
          wrapRoom + 0.01,
      );
      if (!over) {
        break;
      }
      extra = Math.min(
        extra - 0.01,
        lsAt(over.endExcludingWhitespaces - 1 - shift),
      );
    }
    full.delete();
    for (const [li, lm] of metrics.entries()) {
      const last = maxLines !== undefined && lines.length === maxLines - 1;
      const more = li < metrics.length - 1 || pi < paras.length - 1;
      const start = Math.max(0, lm.startIndex - shift);
      let end = Math.max(
        start,
        (wide ? lm.endIndex : lm.endExcludingWhitespaces) - shift,
      );
      const lineIndent = info.indent + (li === 0 ? info.firstIndent : 0);
      const room = Math.max(w - lineIndent, 1);
      if (last && more) {
        end = paraText.length;
      }
      const inLine = placed.filter(
        (r) => r.end > start && r.start < Math.max(end, start + 1),
      );
      // See apps/docs/skia-engine/tech.md §11.8.
      let a = baseA;
      let d = baseD;
      let tallest = -Infinity;
      for (const r of inLine) {
        if (r.lineHeight < tallest) {
          continue;
        }
        const [ra, rd] = lineHalves(
          ck,
          res,
          r.style,
          r.lineHeight,
          builder.aliases(r.style, r.text),
        );
        if (r.lineHeight > tallest || ra > a) {
          a = ra;
          d = rd;
          tallest = r.lineHeight;
        }
      }
      const ellipsis = last && more;
      const buildLine = (opts: BuildOptions = {}) => {
        const p = builder.build(
          placed,
          start,
          end,
          ellipsis ? { ...opts, maxLines: 1, ellipsis: true } : opts,
        );
        p.layout(ellipsis ? room + 0.01 : 1e7);
        return p;
      };
      const para = buildLine();
      const lineWidth = ellipsis
        ? (para.getLineMetrics()[0]?.width ?? 0)
        : para.getMaxIntrinsicWidth();
      const masks = fillKeys.map((key) => {
        const used = inLine.some((r) => {
          const fills = layeredFills(r.style, node);
          return fills !== undefined && fillKey(fills) === key;
        });
        return used ? buildLine({ pass: 'mask', maskKey: key }) : undefined;
      });
      const strokes = stroke && {
        outline: buildLine({ pass: 'stroke', strokeWidth: stroke.width }),
        glyphs:
          stroke.align === 'CENTER'
            ? undefined
            : buildLine({ pass: 'mask', maskKey: ALL_GLYPHS }),
      };
      const decorations: Decoration[] = [];
      for (const r of inLine) {
        const deco = r.style.textDecoration;
        if (deco !== 'UNDERLINE' && deco !== 'STRIKETHROUGH') {
          continue;
        }
        // See apps/docs/skia-engine/tech.md §11.10.
        const e = Math.min(r.end, end);
        for (let s = Math.max(r.start, start); s < e;) {
          const seg = segmentAt(node, info.start + s);
          const segEnd = seg ? seg.end - info.start : e;
          const to = segEnd > s ? Math.min(segEnd, e) : e;
          decorations.push({
            kind: deco,
            start: s - start,
            end: to - start,
            style: r.style,
            aliases: builder.aliases(r.style, r.text),
            seg,
          });
          s = to;
        }
      }
      const inkCut = decorations.some(skipsInk)
        ? buildLine({ pass: 'mask', maskKey: ALL_GLYPHS })
        : undefined;
      const x =
        lineIndent +
        (align === 'CENTER'
          ? (room - lineWidth) / 2
          : align === 'RIGHT'
            ? room - lineWidth
            : 0);
      let marker: TextLine['marker'];
      if (li === 0 && info.marker) {
        // See apps/docs/skia-engine/tech.md §11.5.
        const m = info.marker;
        const mp = builder.build(
          [
            {
              text: m.text,
              style: m.style,
              lineHeight: 0,
              start: 0,
              end: m.text.length,
            },
          ],
          0,
          m.text.length,
        );
        mp.layout(1e7);
        const mw = mp.getMaxIntrinsicWidth();
        marker = { para: mp, x: info.indent - m.unit / 2 - mw / 2, width: mw };
      }
      const baseline = place(a, d);
      lines.push({
        para,
        masks,
        x,
        baseline,
        top: baseline - a,
        height: a + d,
        width: lineWidth,
        decorations,
        sourceStart: info.start + start,
        marker,
        strokes,
        inkCut,
      });
      // See apps/docs/skia-engine/tech.md §11.7.
      width = Math.max(
        width,
        lineIndent + lineWidth - (end > start ? lsAt(end - 1) : 0),
      );
      if (last) {
        truncated = more;
        break;
      }
    }
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
    Math.abs(h - contentHeight) < 0.5
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
    fills: [...fillSets.values()],
    complete: builder.complete,
  };
}

// See apps/docs/skia-engine/tech.md §11.10.
function decorationLength(
  len: FigmaAutoLength | undefined,
  size: number,
  auto: number,
) {
  if (len?.unit === 'PIXELS' && len.value !== undefined) {
    return len.value;
  }
  if (len?.unit === 'PERCENT' && len.value !== undefined) {
    return (len.value / 100) * size;
  }
  return auto;
}

function skipsInk(deco: Decoration) {
  return deco.kind === 'UNDERLINE' && deco.seg?.textDecorationSkipInk !== false;
}

/** Top of the line relative to the baseline, and its thickness. */
function decorationGeometry(ck: CanvasKit, res: Resources, deco: Decoration) {
  const size = deco.style.fontSize ?? 16;
  const tf = deco.aliases[0] ? res.fonts.typeface(deco.aliases[0]) : undefined;
  const font = tf ? new ck.Font(tf, size) : undefined;
  const m = font?.getMetrics();
  font?.delete();
  if (deco.kind === 'UNDERLINE') {
    const auto = m?.underlineThickness ?? size / 14;
    const thickness = decorationLength(
      deco.seg?.textDecorationThickness,
      size,
      auto,
    );
    const top = decorationLength(
      deco.seg?.textDecorationOffset,
      size,
      (m?.underlinePosition ?? size / 10) + auto / 2,
    );
    return { top, thickness, auto };
  }
  const auto = m?.strikeoutThickness ?? size / 14;
  const thickness = decorationLength(
    deco.seg?.textDecorationThickness,
    size,
    auto,
  );
  const center = (m?.strikeoutPosition ?? -size * 0.3) + auto / 2;
  return { top: center - thickness / 2, thickness, auto };
}

function decorationColor(ck: CanvasKit, node: FigmaNode, deco: Decoration) {
  const value = deco.seg?.textDecorationColor?.value;
  if (value && value !== 'AUTO' && value.type === 'SOLID' && value.color) {
    return ck.Color4f(
      value.color.r,
      value.color.g,
      value.color.b,
      (value.color.a ?? 1) * (value.opacity ?? 1),
    );
  }
  return solidColor(ck, deco.style, node);
}

const WAVE_LENGTH = 3.5;

/** Draws one decoration and returns the band it covers and its skip-ink padding. */
function drawDecoration(
  ck: CanvasKit,
  canvas: Canvas,
  res: Resources,
  node: FigmaNode,
  line: TextLine,
  deco: Decoration,
  d: Disposer,
  lsShift: number,
) {
  const rects = line.para.getRectsForRange(
    deco.start,
    deco.end,
    ck.RectHeightStyle.Tight,
    ck.RectWidthStyle.Tight,
  );
  if (!rects.length) {
    return undefined;
  }
  let x0 = Infinity;
  let x1 = -Infinity;
  for (const r of rects) {
    x0 = Math.min(x0, r.rect[0]);
    x1 = Math.max(x1, r.rect[2]);
  }
  x0 += line.x + lsShift;
  x1 += line.x + lsShift;
  const { top, thickness: t, auto } = decorationGeometry(ck, res, deco);
  const y = line.baseline + top;
  const p = d.keep(new ck.Paint());
  p.setAntiAlias(true);
  p.setColor(decorationColor(ck, node, deco));
  const style = deco.seg?.textDecorationStyle ?? 'SOLID';
  if (style === 'DOTTED') {
    const b = new ck.PathBuilder();
    for (let cx = x0 + t / 2; cx <= x1 - t / 2 + 0.01; cx += 2 * t) {
      b.addOval(ck.XYWHRect(cx - t / 2, y, t, t));
    }
    canvas.drawPath(d.keep(b.detachAndDelete()), p);
  } else if (style === 'WAVY') {
    const b = new ck.PathBuilder();
    const amp = t / 2;
    const width = (t * 2) / 3;
    const k = (2 * Math.PI) / (WAVE_LENGTH * t);
    const cy = y + t / 2;
    b.moveTo(x0, cy + amp);
    for (let x = x0 + 0.25; x < x1; x += 0.25) {
      b.lineTo(x, cy + amp * Math.cos(k * (x - x0)));
    }
    b.lineTo(x1, cy + amp * Math.cos(k * (x1 - x0)));
    p.setStyle(ck.PaintStyle.Stroke);
    p.setStrokeWidth(width);
    p.setStrokeCap(ck.StrokeCap.Round);
    canvas.drawPath(d.keep(b.detachAndDelete()), p);
    return {
      top: cy - amp - width / 2,
      bottom: cy + amp + width / 2,
      pad: auto,
    };
  } else {
    canvas.drawRect(ck.LTRBRect(x0, y, x1, y + t), p);
  }
  return { top: y, bottom: y + t, pad: auto };
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
    const glyphs = line.inkCut;
    if (!glyphs || !skipsInk(deco)) {
      drawDecoration(ck, canvas, res, node, line, deco, d, lsShift);
      continue;
    }
    // See apps/docs/skia-engine/tech.md §11.10.
    canvas.saveLayer();
    const band = drawDecoration(ck, canvas, res, node, line, deco, d, lsShift);
    if (band) {
      const out = d.keep(new ck.Paint());
      out.setBlendMode(ck.BlendMode.DstOut);
      out.setImageFilter(
        d.keep(
          ck.ImageFilter.MakeDilate(
            band.pad,
            band.bottom - band.top + band.pad / 4,
            null,
          ),
        ),
      );
      canvas.saveLayer(out);
      canvas.clipRect(
        ck.LTRBRect(
          -1e5,
          band.top - band.pad / 4,
          1e5,
          band.bottom + band.pad / 4,
        ),
        ck.ClipOp.Intersect,
        true,
      );
      canvas.drawParagraph(
        glyphs,
        line.x + lsShift,
        paragraphTop(line.baseline, glyphs),
      );
      canvas.restore();
    }
    canvas.restore();
  }
}

// See apps/docs/skia-engine/tech.md §11.11.
function paragraphTop(baseline: number, para: Paragraph) {
  return baseline - Math.round(para.getAlphabeticBaseline());
}

/** Draws a laid-out text box in its local space. */
export function drawText(
  ck: CanvasKit,
  canvas: Canvas,
  res: Resources,
  node: FigmaNode,
  layout: FigmaTextLayout,
  src: PaintSource,
  d: Disposer,
) {
  const shift = -(node.style?.letterSpacing ?? 0) / 2;
  for (const line of layout.lines) {
    canvas.drawParagraph(
      line.para,
      line.x + shift,
      paragraphTop(line.baseline, line.para),
    );
    const m = line.marker;
    if (m) {
      canvas.drawParagraph(
        m.para,
        m.x + shift,
        paragraphTop(line.baseline, m.para),
      );
    }
    drawDecorations(ck, canvas, res, node, line, d, shift);
  }
  // See apps/docs/skia-engine/tech.md §11.3.
  layout.fills.forEach((fills, k) => {
    for (const fill of fills) {
      const p = skiaPaint(ck, fill, src, res, d);
      if (!p) {
        continue;
      }
      p.setBlendMode(ck.BlendMode.SrcIn);
      const layer = d.keep(new ck.Paint());
      const blend = skiaBlend(ck, fill.blendMode);
      if (blend) {
        layer.setBlendMode(blend);
      }
      canvas.saveLayer(layer);
      for (const line of layout.lines) {
        const mask = line.masks[k];
        if (mask) {
          canvas.drawParagraph(
            mask,
            line.x + shift,
            paragraphTop(line.baseline, mask),
          );
        }
      }
      canvas.drawPaint(p);
      canvas.restore();
    }
  });
  drawStrokes(ck, canvas, res, node, layout, src, d, shift);
}

// See apps/docs/skia-engine/tech.md §11.6.
function drawStrokes(
  ck: CanvasKit,
  canvas: Canvas,
  res: Resources,
  node: FigmaNode,
  layout: FigmaTextLayout,
  src: PaintSource,
  d: Disposer,
  shift: number,
) {
  const draw = (pick: (line: TextLine) => Paragraph | undefined) => {
    for (const line of layout.lines) {
      const para = pick(line);
      if (para) {
        canvas.drawParagraph(
          para,
          line.x + shift,
          paragraphTop(line.baseline, para),
        );
      }
    }
  };
  const align = node.strokeAlign ?? 'OUTSIDE';
  for (const stroke of visiblePaints(node.strokes)) {
    const p = skiaPaint(ck, stroke, src, res, d);
    if (!p) {
      continue;
    }
    p.setBlendMode(ck.BlendMode.SrcIn);
    const layer = d.keep(new ck.Paint());
    const blend = skiaBlend(ck, stroke.blendMode);
    if (blend) {
      layer.setBlendMode(blend);
    }
    canvas.saveLayer(layer);
    draw((line) => line.strokes?.outline);
    if (align !== 'CENTER') {
      const cut = d.keep(new ck.Paint());
      cut.setBlendMode(
        align === 'OUTSIDE' ? ck.BlendMode.DstOut : ck.BlendMode.DstIn,
      );
      canvas.saveLayer(cut);
      draw((line) => line.strokes?.glyphs);
      canvas.restore();
    }
    canvas.drawPaint(p);
    canvas.restore();
  }
}

export function disposeLayout(layout: FigmaTextLayout) {
  for (const line of layout.lines) {
    line.para.delete();
    line.marker?.para.delete();
    line.strokes?.outline.delete();
    line.strokes?.glyphs?.delete();
    line.inkCut?.delete();
    for (const mask of line.masks) {
      mask?.delete();
    }
  }
}
