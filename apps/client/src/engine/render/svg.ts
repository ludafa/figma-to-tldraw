import type {
  BlendMode,
  Canvas,
  CanvasKit,
  ImageFilter,
  Paint,
  Path,
  Shader,
  SkPicture,
} from 'canvaskit-wasm';

import type { Resources } from './resources';

// See apps/docs/skia-engine/tech.md §5.3.

export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeEntities(s: string): string {
  if (!s.includes('&')) {
    return s;
  }
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const cp =
        e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1);
      return String.fromCodePoint(cp);
    }
    return ENTITIES[e] ?? m;
  });
}

const TAG_RE =
  /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>|<(\/?)([a-zA-Z_][\w:.-]*)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
const ATTR_RE = /([^\s=>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

export function parseXml(src: string): XmlNode | undefined {
  const root: XmlNode = { tag: '#root', attrs: {}, children: [] };
  const stack: XmlNode[] = [root];
  TAG_RE.lastIndex = 0;
  for (let m = TAG_RE.exec(src); m; m = TAG_RE.exec(src)) {
    if (!m[2]) {
      continue;
    }
    if (m[1]) {
      if (stack.length > 1) {
        stack.pop();
      }
      continue;
    }
    const attrs: Record<string, string> = {};
    ATTR_RE.lastIndex = 0;
    for (let a = ATTR_RE.exec(m[3]); a; a = ATTR_RE.exec(m[3])) {
      attrs[a[1]] = decodeEntities(a[2] ?? a[3] ?? '');
    }
    const node: XmlNode = { tag: m[2], attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!m[4]) {
      stack.push(node);
    }
  }
  return root.children[0];
}

const NAMED: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  yellow: [255, 255, 0],
};

/** CSS/SVG colour → [r, g, b, a] in 0..1, or undefined for none/url. */
export function parseColor(
  value: string | undefined,
): [number, number, number, number] | undefined {
  if (!value) {
    return undefined;
  }
  const v = value.trim().toLowerCase();
  if (v === 'none' || v === 'transparent' || v.startsWith('url(')) {
    return v === 'transparent' ? [0, 0, 0, 0] : undefined;
  }
  if (v[0] === '#') {
    let hex = v.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      hex = [...hex].map((c) => c + c).join('');
    }
    const n = (i: number) => parseInt(hex.slice(i, i + 2), 16) / 255;
    return [n(0), n(2), n(4), hex.length >= 8 ? n(6) : 1];
  }
  const fn = /^rgba?\(([^)]*)\)/.exec(v);
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean);
    const c = (s: string) =>
      s.endsWith('%') ? parseFloat(s) / 100 : parseFloat(s) / 255;
    const a =
      parts[3] === undefined
        ? 1
        : parts[3].endsWith('%')
          ? parseFloat(parts[3]) / 100
          : parseFloat(parts[3]);
    return [c(parts[0]), c(parts[1]), c(parts[2]), a];
  }
  const named = NAMED[v];
  return named
    ? [named[0] / 255, named[1] / 255, named[2] / 255, 1]
    : undefined;
}

/** 3×3 row-major [a c e; b d f; 0 0 1] as Skia wants it. */
export type M33 = number[];

const IDENTITY: M33 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function mul(m: M33, n: M33): M33 {
  return [
    m[0] * n[0] + m[1] * n[3],
    m[0] * n[1] + m[1] * n[4],
    m[0] * n[2] + m[1] * n[5] + m[2],
    m[3] * n[0] + m[4] * n[3],
    m[3] * n[1] + m[4] * n[4],
    m[3] * n[2] + m[4] * n[5] + m[5],
    0,
    0,
    1,
  ];
}

export function parseTransform(value: string | undefined): M33 {
  if (!value) {
    return IDENTITY;
  }
  let m = IDENTITY;
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  for (let t = re.exec(value); t; t = re.exec(value)) {
    const n = t[2]
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);
    let next: M33 = IDENTITY;
    switch (t[1]) {
      case 'matrix':
        next = [n[0], n[2], n[4], n[1], n[3], n[5], 0, 0, 1];
        break;
      case 'translate':
        next = [1, 0, n[0], 0, 1, n[1] ?? 0, 0, 0, 1];
        break;
      case 'scale':
        next = [n[0], 0, 0, 0, n[1] ?? n[0], 0, 0, 0, 1];
        break;
      case 'rotate': {
        const r = (n[0] * Math.PI) / 180;
        const c = Math.cos(r);
        const s = Math.sin(r);
        const cx = n[1] ?? 0;
        const cy = n[2] ?? 0;
        next = [
          c,
          -s,
          cx - c * cx + s * cy,
          s,
          c,
          cy - s * cx - c * cy,
          0,
          0,
          1,
        ];
        break;
      }
      case 'skewX':
        next = [1, Math.tan((n[0] * Math.PI) / 180), 0, 0, 1, 0, 0, 0, 1];
        break;
      case 'skewY':
        next = [1, 0, 0, Math.tan((n[0] * Math.PI) / 180), 1, 0, 0, 0, 1];
        break;
    }
    m = mul(m, next);
  }
  return m;
}

function isIdentity(m: M33) {
  return m === IDENTITY || m.every((v, i) => v === IDENTITY[i]);
}

function num(v: string | undefined, fallback = 0): number {
  if (v === undefined || v === '') {
    return fallback;
  }
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

function styleMap(node: XmlNode): Record<string, string> {
  const s = node.attrs.style;
  if (!s) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const decl of s.split(';')) {
    const i = decl.indexOf(':');
    if (i > 0) {
      out[decl.slice(0, i).trim()] = decl.slice(i + 1).trim();
    }
  }
  return out;
}

function attr(node: XmlNode, name: string): string | undefined {
  return styleMap(node)[name] ?? node.attrs[name];
}

/** The id in `url(#id)`, used by fill, stroke, clip-path, mask and filter. */
function urlId(value: string | undefined): string | undefined {
  const m = value && /url\(\s*['"]?#([^'")]+)['"]?\s*\)/.exec(value);
  return m ? m[1] : undefined;
}

/** The id in an `href` (`#id` or `url(#id)`). */
function refId(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return urlId(value) ?? (value.startsWith('#') ? value.slice(1) : undefined);
}

interface Inherited {
  fill: string;
  fillOpacity: number;
  fillRule: string;
  stroke: string;
  strokeOpacity: number;
  strokeWidth: number;
  linecap: string;
  linejoin: string;
  miterlimit: number;
  dasharray: string;
  dashoffset: number;
  clipRule: string;
}

const ROOT_STYLE: Inherited = {
  fill: 'black',
  fillOpacity: 1,
  fillRule: 'nonzero',
  stroke: 'none',
  strokeOpacity: 1,
  strokeWidth: 1,
  linecap: 'butt',
  linejoin: 'miter',
  miterlimit: 4,
  dasharray: 'none',
  dashoffset: 0,
  clipRule: 'nonzero',
};

function inherit(node: XmlNode, parent: Inherited): Inherited {
  const a = (n: string) => attr(node, n);
  return {
    fill: a('fill') ?? parent.fill,
    fillOpacity:
      a('fill-opacity') !== undefined
        ? num(a('fill-opacity'), 1)
        : parent.fillOpacity,
    fillRule: a('fill-rule') ?? parent.fillRule,
    stroke: a('stroke') ?? parent.stroke,
    strokeOpacity:
      a('stroke-opacity') !== undefined
        ? num(a('stroke-opacity'), 1)
        : parent.strokeOpacity,
    strokeWidth:
      a('stroke-width') !== undefined
        ? num(a('stroke-width'), 1)
        : parent.strokeWidth,
    linecap: a('stroke-linecap') ?? parent.linecap,
    linejoin: a('stroke-linejoin') ?? parent.linejoin,
    miterlimit:
      a('stroke-miterlimit') !== undefined
        ? num(a('stroke-miterlimit'), 4)
        : parent.miterlimit,
    dasharray: a('stroke-dasharray') ?? parent.dasharray,
    dashoffset:
      a('stroke-dashoffset') !== undefined
        ? num(a('stroke-dashoffset'))
        : parent.dashoffset,
    clipRule: a('clip-rule') ?? parent.clipRule,
  };
}

const BLEND_NAMES: Record<string, keyof CanvasKit['BlendMode'] & string> = {
  normal: 'SrcOver',
  multiply: 'Multiply',
  screen: 'Screen',
  overlay: 'Overlay',
  darken: 'Darken',
  lighten: 'Lighten',
  'color-dodge': 'ColorDodge',
  'color-burn': 'ColorBurn',
  'hard-light': 'HardLight',
  'soft-light': 'SoftLight',
  difference: 'Difference',
  exclusion: 'Exclusion',
  hue: 'Hue',
  saturation: 'Saturation',
  color: 'Color',
  luminosity: 'Luminosity',
};

export function blendModeOf(
  ck: CanvasKit,
  name: string | undefined,
): BlendMode | undefined {
  const key = name ? BLEND_NAMES[name.toLowerCase()] : undefined;
  return key && key !== 'SrcOver'
    ? (ck.BlendMode[key] as BlendMode)
    : undefined;
}

interface Deletable {
  delete(): void;
}

/** Filter graph value: a Skia filter, the source graphic (null) or nothing at all. */
type FilterValue = { f: ImageFilter | null } | 'empty';

class SvgPainter {
  private ck: CanvasKit;
  private canvas: Canvas;
  private res: Resources;
  private ids = new Map<string, XmlNode>();
  private trash: Deletable[] = [];

  constructor(ck: CanvasKit, canvas: Canvas, res: Resources, root: XmlNode) {
    this.ck = ck;
    this.canvas = canvas;
    this.res = res;
    const index = (n: XmlNode) => {
      if (n.attrs.id) {
        this.ids.set(n.attrs.id, n);
      }
      n.children.forEach(index);
    };
    index(root);
  }

  dispose() {
    for (const t of this.trash) {
      t.delete();
    }
    this.trash = [];
  }

  private keep<T extends Deletable>(obj: T): T {
    this.trash.push(obj);
    return obj;
  }

  private paint(): Paint {
    const p = this.keep(new this.ck.Paint());
    p.setAntiAlias(true);
    return p;
  }

  paintChildren(node: XmlNode, inh: Inherited) {
    for (const child of node.children) {
      this.paintNode(child, inh);
    }
  }

  paintNode(node: XmlNode, parent: Inherited) {
    switch (node.tag) {
      case 'defs':
      case 'clipPath':
      case 'mask':
      case 'pattern':
      case 'linearGradient':
      case 'radialGradient':
      case 'filter':
      case 'title':
      case 'desc':
      case 'metadata':
      case 'style':
        return;
    }
    if (
      attr(node, 'display') === 'none' ||
      attr(node, 'visibility') === 'hidden'
    ) {
      return;
    }
    const inh = inherit(node, parent);
    this.withLayers(node, inh, () => this.paintContent(node, inh));
  }

  /** transform → opacity/blend → mask → clip → filter, as SVG composites them. */
  private withLayers(
    node: XmlNode,
    inh: Inherited,
    draw: () => void,
    skipTransform = false,
  ) {
    const c = this.canvas;
    const ck = this.ck;
    const saved = c.getSaveCount();
    const transform = skipTransform
      ? IDENTITY
      : parseTransform(node.attrs.transform);
    if (!isIdentity(transform)) {
      c.save();
      c.concat(transform);
    }
    const opacity = num(attr(node, 'opacity'), 1);
    const blend = blendModeOf(ck, attr(node, 'mix-blend-mode'));
    const isShape = SHAPE_TAGS.has(node.tag);
    const foldOpacity = isShape && !blend && !this.hasFillAndStroke(inh);
    if ((opacity < 1 && !foldOpacity) || blend) {
      const p = this.paint();
      p.setAlphaf(opacity);
      if (blend) {
        p.setBlendMode(blend);
      }
      c.saveLayer(p);
    }
    const mask = urlId(attr(node, 'mask'));
    const maskNode = mask ? this.ids.get(mask) : undefined;
    const beforeMask = c.getSaveCount();
    if (maskNode) {
      c.saveLayer();
    }
    const clip = urlId(attr(node, 'clip-path'));
    const clipPath = clip ? this.clipPathOf(clip) : undefined;
    if (clipPath) {
      c.save();
      c.clipPath(clipPath, ck.ClipOp.Intersect, true);
    }
    const filter = urlId(attr(node, 'filter'));
    const filterNode = filter ? this.ids.get(filter) : undefined;
    const beforeFilter = c.getSaveCount();
    if (filterNode) {
      const f = this.buildFilter(filterNode);
      if (f) {
        const p = this.paint();
        p.setImageFilter(f);
        const bounds =
          filterNode.attrs.filterUnits === 'userSpaceOnUse' &&
          filterNode.attrs.width
            ? ck.XYWHRect(
                num(filterNode.attrs.x),
                num(filterNode.attrs.y),
                num(filterNode.attrs.width),
                num(filterNode.attrs.height),
              )
            : null;
        if (bounds) {
          c.save();
          c.clipRect(bounds, ck.ClipOp.Intersect, false);
        }
        c.saveLayer(p, bounds);
      }
    }
    this.opacityFold = foldOpacity ? opacity : 1;
    draw();
    this.opacityFold = 1;
    c.restoreToCount(beforeFilter);
    if (maskNode) {
      c.restoreToCount(beforeMask + 1);
      this.applyMask(maskNode);
      c.restoreToCount(beforeMask);
    }
    c.restoreToCount(saved);
  }

  private opacityFold = 1;

  private hasFillAndStroke(inh: Inherited) {
    return inh.fill !== 'none' && inh.stroke !== 'none' && inh.strokeWidth > 0;
  }

  private applyMask(mask: XmlNode) {
    const c = this.canvas;
    const ck = this.ck;
    const p = this.paint();
    p.setBlendMode(ck.BlendMode.DstIn);
    p.setColorFilter(this.keep(ck.ColorFilter.MakeLuma()));
    c.saveLayer(p);
    if (mask.attrs.maskUnits === 'userSpaceOnUse' && mask.attrs.width) {
      c.clipRect(
        ck.XYWHRect(
          num(mask.attrs.x),
          num(mask.attrs.y),
          num(mask.attrs.width),
          num(mask.attrs.height),
        ),
        ck.ClipOp.Intersect,
        false,
      );
    }
    const inh = inherit(mask, ROOT_STYLE);
    this.paintChildren(mask, inh);
    c.restore();
  }

  private clipPathOf(id: string): Path | undefined {
    const node = this.ids.get(id);
    if (!node) {
      return undefined;
    }
    const ck = this.ck;
    const transform = parseTransform(node.attrs.transform);
    let out: Path | undefined;
    for (const child of node.children) {
      const inh = inherit(child, inherit(node, ROOT_STYLE));
      const geom = this.geometry(child);
      if (!geom) {
        continue;
      }
      const t = mul(transform, parseTransform(child.attrs.transform));
      const b = new ck.PathBuilder(geom);
      if (!isIdentity(t)) {
        b.transform(t);
      }
      b.setFillType(
        inh.clipRule === 'evenodd' ? ck.FillType.EvenOdd : ck.FillType.Winding,
      );
      const path = b.detachAndDelete();
      if (!out) {
        out = path;
      } else {
        const union = out.makeCombined(path, ck.PathOp.Union);
        path.delete();
        if (union) {
          out.delete();
          out = union;
        }
      }
    }
    return out ? this.keep(out) : undefined;
  }

  private geomCache = new Map<XmlNode, Path | null>();

  /** Local geometry of a basic shape; owned by the painter. */
  private geometry(node: XmlNode): Path | undefined {
    const hit = this.geomCache.get(node);
    if (hit !== undefined) {
      return hit ?? undefined;
    }
    const ck = this.ck;
    const a = node.attrs;
    let path: Path | null = null;
    const b = new ck.PathBuilder();
    switch (node.tag) {
      case 'path':
        path = a.d ? ck.Path.MakeFromSVGString(a.d) : null;
        break;
      case 'rect': {
        const w = num(a.width);
        const h = num(a.height);
        if (w > 0 && h > 0) {
          const rx = a.rx !== undefined ? num(a.rx) : num(a.ry);
          const ry = a.ry !== undefined ? num(a.ry) : rx;
          const rect = ck.XYWHRect(num(a.x), num(a.y), w, h);
          if (rx > 0 || ry > 0) {
            b.addRRect(
              ck.RRectXY(rect, Math.min(rx, w / 2), Math.min(ry, h / 2)),
            );
          } else {
            b.addRect(rect);
          }
          path = b.snapshot();
        }
        break;
      }
      case 'circle': {
        const r = num(a.r);
        if (r > 0) {
          b.addOval(ck.XYWHRect(num(a.cx) - r, num(a.cy) - r, r * 2, r * 2));
          path = b.snapshot();
        }
        break;
      }
      case 'ellipse': {
        const rx = num(a.rx);
        const ry = num(a.ry);
        if (rx > 0 && ry > 0) {
          b.addOval(
            ck.XYWHRect(num(a.cx) - rx, num(a.cy) - ry, rx * 2, ry * 2),
          );
          path = b.snapshot();
        }
        break;
      }
      case 'line':
        b.moveTo(num(a.x1), num(a.y1));
        b.lineTo(num(a.x2), num(a.y2));
        path = b.snapshot();
        break;
      case 'polygon':
      case 'polyline': {
        const pts = (a.points ?? '')
          .trim()
          .split(/[\s,]+/)
          .map(Number);
        if (pts.length >= 4) {
          b.moveTo(pts[0], pts[1]);
          for (let i = 2; i + 1 < pts.length; i += 2) {
            b.lineTo(pts[i], pts[i + 1]);
          }
          if (node.tag === 'polygon') {
            b.close();
          }
          path = b.snapshot();
        }
        break;
      }
    }
    b.delete();
    if (path) {
      this.keep(path);
    }
    this.geomCache.set(node, path);
    return path ?? undefined;
  }

  private paintContent(node: XmlNode, inh: Inherited) {
    switch (node.tag) {
      case 'svg':
      case 'g':
      case 'a':
      case 'switch':
        this.paintChildren(node, inh);
        return;
      case 'use':
        this.paintUse(node, inh);
        return;
      case 'image':
        this.paintImage(node);
        return;
      case 'foreignObject':
        this.paintForeignObject(node);
        return;
    }
    if (SHAPE_TAGS.has(node.tag)) {
      this.paintShape(node, inh);
    }
  }

  private paintUse(node: XmlNode, inh: Inherited) {
    const id = refId(node.attrs['xlink:href'] ?? node.attrs.href);
    const target = id ? this.ids.get(id) : undefined;
    if (!target) {
      return;
    }
    const x = num(node.attrs.x);
    const y = num(node.attrs.y);
    const c = this.canvas;
    c.save();
    if (x || y) {
      c.translate(x, y);
    }
    if (target.tag === 'symbol') {
      this.paintChildren(target, inherit(target, inh));
    } else {
      const targetInh = inherit(target, inh);
      this.withLayers(target, targetInh, () =>
        this.paintContent(target, targetInh),
      );
    }
    c.restore();
  }

  private paintImage(node: XmlNode) {
    const href = node.attrs['xlink:href'] ?? node.attrs.href;
    if (!href) {
      return;
    }
    const image = href.startsWith('data:')
      ? this.res.getDataImage(href)
      : this.res.getImage(href);
    if (!image) {
      return;
    }
    const ck = this.ck;
    const w = num(node.attrs.width, image.width());
    const h = num(node.attrs.height, image.height());
    const p = this.paint();
    p.setAlphaf(this.opacityFold);
    this.canvas.drawImageRectOptions(
      image,
      ck.XYWHRect(0, 0, image.width(), image.height()),
      ck.XYWHRect(num(node.attrs.x), num(node.attrs.y), w, h),
      ck.FilterMode.Linear,
      ck.MipmapMode.Linear,
      p,
    );
  }

  private paintForeignObject(node: XmlNode) {
    const div = node.children.find((c) => c.tag === 'div');
    if (!div) {
      return;
    }
    const ck = this.ck;
    const c = this.canvas;
    const x = num(node.attrs.x);
    const y = num(node.attrs.y);
    const w = num(node.attrs.width);
    const h = num(node.attrs.height);
    const style = styleMap(div);
    const backdrop = /blur\(([\d.]+)px\)/.exec(style['backdrop-filter'] ?? '');
    if (backdrop) {
      c.save();
      c.translate(x, y);
      const clip = urlId(style['clip-path']);
      const clipPath = clip ? this.clipPathOf(clip) : undefined;
      c.clipRect(ck.XYWHRect(0, 0, w, h), ck.ClipOp.Intersect, true);
      if (clipPath) {
        c.clipPath(clipPath, ck.ClipOp.Intersect, true);
      }
      const sigma = parseFloat(backdrop[1]);
      const blur = this.keep(
        ck.ImageFilter.MakeBlur(sigma, sigma, ck.TileMode.Clamp, null),
      );
      c.saveLayer(undefined, null, blur, 0, ck.TileMode.Clamp);
      c.restore();
      c.restore();
      return;
    }
    const conic = /conic-gradient\(from\s+([-\d.]+)deg\s*,(.*)\)\s*$/.exec(
      style.background ?? '',
    );
    if (conic) {
      const stops = [...conic[2].matchAll(/(rgba?\([^)]*\))\s*([-\d.]+)deg/g)];
      const colors = stops.map((s) => {
        const [r, g, b, a] = parseColor(s[1]) ?? [0, 0, 0, 0];
        return ck.Color4f(r, g, b, a);
      });
      const pos = stops.map((s) => parseFloat(s[2]) / 360);
      const cx = x + w / 2;
      const cy = y + h / 2;
      const from = parseFloat(conic[1]);
      const shader = this.keep(
        ck.Shader.MakeSweepGradient(
          cx,
          cy,
          colors,
          pos,
          ck.TileMode.Clamp,
          ck.Matrix.rotated(((from - 90) * Math.PI) / 180, cx, cy),
        ),
      );
      const p = this.paint();
      p.setShader(shader);
      p.setAlphaf(num(style.opacity, 1) * this.opacityFold);
      c.drawRect(ck.XYWHRect(x, y, w, h), p);
    }
  }

  private paintShape(node: XmlNode, inh: Inherited) {
    const geom = this.geometry(node);
    if (!geom) {
      return;
    }
    const ck = this.ck;
    const c = this.canvas;
    const bounds = geom.getBounds();
    if (inh.fill !== 'none') {
      const p = this.paintFor(
        inh.fill,
        inh.fillOpacity * this.opacityFold,
        bounds,
      );
      if (p) {
        const fillType =
          inh.fillRule === 'evenodd'
            ? ck.FillType.EvenOdd
            : ck.FillType.Winding;
        if (geom.getFillType() !== fillType) {
          geom.setFillType(fillType);
        }
        c.drawPath(geom, p);
      }
    }
    if (inh.stroke !== 'none' && inh.strokeWidth > 0) {
      const p = this.paintFor(
        inh.stroke,
        inh.strokeOpacity * this.opacityFold,
        bounds,
      );
      if (p) {
        p.setStyle(ck.PaintStyle.Stroke);
        p.setStrokeWidth(inh.strokeWidth);
        p.setStrokeCap(
          inh.linecap === 'round'
            ? ck.StrokeCap.Round
            : inh.linecap === 'square'
              ? ck.StrokeCap.Square
              : ck.StrokeCap.Butt,
        );
        p.setStrokeJoin(
          inh.linejoin === 'round'
            ? ck.StrokeJoin.Round
            : inh.linejoin === 'bevel'
              ? ck.StrokeJoin.Bevel
              : ck.StrokeJoin.Miter,
        );
        p.setStrokeMiter(inh.miterlimit);
        if (inh.dasharray !== 'none') {
          const dashes = inh.dasharray
            .split(/[\s,]+/)
            .filter(Boolean)
            .map(Number);
          const list = dashes.length % 2 ? [...dashes, ...dashes] : dashes;
          if (list.length && list.some((d) => d > 0)) {
            p.setPathEffect(
              this.keep(ck.PathEffect.MakeDash(list, inh.dashoffset)),
            );
          }
        }
        c.drawPath(geom, p);
      }
    }
  }

  /** A paint for a fill/stroke value; undefined when nothing should be drawn. */
  private paintFor(
    value: string,
    opacity: number,
    bbox: Float32Array,
  ): Paint | undefined {
    const ck = this.ck;
    const id = urlId(value);
    if (id) {
      const ref = this.ids.get(id);
      if (!ref) {
        return undefined;
      }
      const shader = this.shaderFor(ref, bbox);
      if (!shader) {
        return undefined;
      }
      const p = this.paint();
      p.setShader(shader);
      p.setAlphaf(opacity);
      return p;
    }
    const color = parseColor(value);
    if (!color) {
      return undefined;
    }
    const a = color[3] * opacity;
    if (a <= 0) {
      return undefined;
    }
    const p = this.paint();
    p.setColor(ck.Color4f(color[0], color[1], color[2], a));
    return p;
  }

  private shaderFor(ref: XmlNode, bbox: Float32Array): Shader | undefined {
    if (ref.tag === 'linearGradient' || ref.tag === 'radialGradient') {
      return this.gradient(ref, bbox);
    }
    if (ref.tag === 'pattern') {
      return this.pattern(ref, bbox);
    }
    return undefined;
  }

  /** Gradient attributes may come from an `xlink:href`-ed gradient. */
  private gradientAttr(node: XmlNode, name: string): string | undefined {
    for (let n: XmlNode | undefined = node, i = 0; n && i < 8; i++) {
      if (n.attrs[name] !== undefined) {
        return n.attrs[name];
      }
      const href = refId(n.attrs['xlink:href'] ?? n.attrs.href);
      n = href ? this.ids.get(href) : undefined;
    }
    return undefined;
  }

  private gradientStops(node: XmlNode): XmlNode[] {
    for (let n: XmlNode | undefined = node, i = 0; n && i < 8; i++) {
      const stops = n.children.filter((c) => c.tag === 'stop');
      if (stops.length) {
        return stops;
      }
      const href = refId(n.attrs['xlink:href'] ?? n.attrs.href);
      n = href ? this.ids.get(href) : undefined;
    }
    return [];
  }

  private gradient(node: XmlNode, bbox: Float32Array): Shader | undefined {
    const ck = this.ck;
    const stops = this.gradientStops(node);
    if (!stops.length) {
      return undefined;
    }
    const colors: Float32Array[] = [];
    const pos: number[] = [];
    let last = 0;
    for (const s of stops) {
      const [r, g, b, a] = parseColor(attr(s, 'stop-color') ?? 'black') ?? [
        0, 0, 0, 1,
      ];
      const o = num(attr(s, 'stop-opacity'), 1);
      colors.push(ck.Color4f(r, g, b, a * o));
      const off = s.attrs.offset ?? '0';
      let p = off.endsWith('%') ? parseFloat(off) / 100 : num(off);
      p = Math.max(last, Math.min(1, Math.max(0, p)));
      pos.push(p);
      last = p;
    }
    if (colors.length === 1) {
      colors.push(colors[0]);
      pos.push(1);
    }
    const units =
      this.gradientAttr(node, 'gradientUnits') ?? 'objectBoundingBox';
    let m = parseTransform(this.gradientAttr(node, 'gradientTransform'));
    if (units === 'objectBoundingBox') {
      const [l, t, r, b] = bbox;
      m = mul([r - l, 0, l, 0, b - t, t, 0, 0, 1], m);
    }
    const len = (name: string, fallback: string) => {
      const v = this.gradientAttr(node, name) ?? fallback;
      return v.endsWith('%') ? parseFloat(v) / 100 : num(v);
    };
    if (node.tag === 'linearGradient') {
      return this.keep(
        ck.Shader.MakeLinearGradient(
          [len('x1', '0'), len('y1', '0')],
          [len('x2', '1'), len('y2', '0')],
          colors,
          pos,
          ck.TileMode.Clamp,
          m,
        ),
      );
    }
    const cx = len('cx', '0.5');
    const cy = len('cy', '0.5');
    const r = len('r', '0.5');
    const fx = this.gradientAttr(node, 'fx');
    const fy = this.gradientAttr(node, 'fy');
    if (fx !== undefined || fy !== undefined) {
      return this.keep(
        ck.Shader.MakeTwoPointConicalGradient(
          [
            fx !== undefined ? len('fx', '0') : cx,
            fy !== undefined ? len('fy', '0') : cy,
          ],
          0,
          [cx, cy],
          r,
          colors,
          pos,
          ck.TileMode.Clamp,
          m,
        ),
      );
    }
    return this.keep(
      ck.Shader.MakeRadialGradient(
        [cx, cy],
        r,
        colors,
        pos,
        ck.TileMode.Clamp,
        m,
      ),
    );
  }

  private pattern(node: XmlNode, bbox: Float32Array): Shader | undefined {
    const ck = this.ck;
    const [l, t, r, b] = bbox;
    const bw = r - l;
    const bh = b - t;
    const objectUnits =
      (node.attrs.patternUnits ?? 'objectBoundingBox') === 'objectBoundingBox';
    const contentBox = node.attrs.patternContentUnits === 'objectBoundingBox';
    const px = num(node.attrs.x);
    const py = num(node.attrs.y);
    const pw = num(node.attrs.width);
    const ph = num(node.attrs.height);
    const tile = objectUnits
      ? [l + px * bw, t + py * bh, pw * bw, ph * bh]
      : [px, py, pw, ph];
    if (tile[2] <= 0 || tile[3] <= 0) {
      return undefined;
    }
    let content: M33 = contentBox
      ? [bw, 0, l, 0, bh, t, 0, 0, 1]
      : [1, 0, tile[0], 0, 1, tile[1], 0, 0, 1];
    content = mul(content, parseTransform(node.attrs.patternTransform));
    // Fast path: a single <use> of an <image>.
    if (node.children.length === 1 && node.children[0].tag === 'use') {
      const use = node.children[0];
      const id = refId(use.attrs['xlink:href'] ?? use.attrs.href);
      const img = id ? this.ids.get(id) : undefined;
      const href = img?.attrs['xlink:href'] ?? img?.attrs.href;
      if (img?.tag === 'image' && href) {
        const image = href.startsWith('data:')
          ? this.res.getDataImage(href)
          : this.res.getImage(href);
        if (!image) {
          return undefined;
        }
        const iw = num(img.attrs.width, image.width());
        const ih = num(img.attrs.height, image.height());
        const m = mul(mul(content, parseTransform(use.attrs.transform)), [
          iw / image.width(),
          0,
          num(img.attrs.x),
          0,
          ih / image.height(),
          num(img.attrs.y),
          0,
          0,
          1,
        ]);
        return this.keep(
          image.makeShaderOptions(
            ck.TileMode.Decal,
            ck.TileMode.Decal,
            ck.FilterMode.Linear,
            ck.MipmapMode.Linear,
            m,
          ),
        );
      }
    }
    const rec = this.keep(new ck.PictureRecorder());
    const pc = rec.beginRecording(ck.XYWHRect(0, 0, tile[2], tile[3]));
    const inner = new SvgPainter(ck, pc, this.res, node);
    inner.ids = this.ids;
    pc.translate(-tile[0], -tile[1]);
    pc.concat(content);
    inner.paintChildren(node, inherit(node, ROOT_STYLE));
    const pic = this.keep(rec.finishRecordingAsPicture());
    inner.dispose();
    return this.keep(
      pic.makeShader(
        ck.TileMode.Repeat,
        ck.TileMode.Repeat,
        ck.FilterMode.Linear,
        [1, 0, tile[0], 0, 1, tile[1], 0, 0, 1],
        ck.XYWHRect(0, 0, tile[2], tile[3]),
      ),
    );
  }

  private buildFilter(node: XmlNode): ImageFilter | null {
    const ck = this.ck;
    const results = new Map<string, FilterValue>();
    const source: FilterValue = { f: null };
    let sourceAlpha: FilterValue | undefined;
    let prev: FilterValue = source;
    const input = (name: string | undefined): FilterValue => {
      if (!name) {
        return prev;
      }
      if (name === 'SourceGraphic') {
        return source;
      }
      if (name === 'SourceAlpha') {
        sourceAlpha ??= {
          f: this.keep(
            ck.ImageFilter.MakeColorFilter(
              this.keep(
                ck.ColorFilter.MakeMatrix([
                  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0,
                ]),
              ),
              null,
            ),
          ),
        };
        return sourceAlpha;
      }
      return results.get(name) ?? prev;
    };
    const blend = (
      mode: BlendMode,
      bg: FilterValue,
      fg: FilterValue,
    ): FilterValue => {
      if (bg === 'empty' && fg === 'empty') {
        return 'empty';
      }
      if (bg === 'empty') {
        return mode === ck.BlendMode.SrcIn || mode === ck.BlendMode.SrcATop
          ? 'empty'
          : fg;
      }
      if (fg === 'empty') {
        return mode === ck.BlendMode.SrcIn || mode === ck.BlendMode.SrcOut
          ? 'empty'
          : bg;
      }
      return { f: this.keep(ck.ImageFilter.MakeBlend(mode, bg.f, fg.f)) };
    };
    for (const prim of node.children) {
      const a = prim.attrs;
      let out: FilterValue = prev;
      const inA = input(a.in);
      switch (prim.tag) {
        case 'feFlood': {
          const [r, g, b, al] = parseColor(a['flood-color'] ?? 'black') ?? [
            0, 0, 0, 1,
          ];
          const alpha = al * num(a['flood-opacity'], 1);
          out =
            alpha <= 0
              ? 'empty'
              : {
                  f: this.keep(
                    ck.ImageFilter.MakeShader(
                      this.keep(
                        ck.Shader.MakeColor(
                          ck.Color4f(r, g, b, alpha),
                          ck.ColorSpace.SRGB,
                        ),
                      ),
                    ),
                  ),
                };
          break;
        }
        case 'feColorMatrix': {
          if (inA === 'empty') {
            out = 'empty';
            break;
          }
          const type = a.type ?? 'matrix';
          let values: number[] | undefined;
          if (type === 'matrix') {
            values = (a.values ?? '')
              .split(/[\s,]+/)
              .filter(Boolean)
              .map(Number);
          } else if (type === 'saturate') {
            const s = num(a.values, 1);
            values = [
              0.213 + 0.787 * s,
              0.715 - 0.715 * s,
              0.072 - 0.072 * s,
              0,
              0,
              0.213 - 0.213 * s,
              0.715 + 0.285 * s,
              0.072 - 0.072 * s,
              0,
              0,
              0.213 - 0.213 * s,
              0.715 - 0.715 * s,
              0.072 + 0.928 * s,
              0,
              0,
              0,
              0,
              0,
              1,
              0,
            ];
          } else if (type === 'luminanceToAlpha') {
            values = [
              0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.2125, 0.7154,
              0.0721, 0, 0,
            ];
          }
          if (!values || values.length !== 20) {
            out = inA;
            break;
          }
          out = {
            f: this.keep(
              ck.ImageFilter.MakeColorFilter(
                this.keep(ck.ColorFilter.MakeMatrix(values)),
                inA.f,
              ),
            ),
          };
          break;
        }
        case 'feOffset':
          out =
            inA === 'empty'
              ? 'empty'
              : {
                  f: this.keep(
                    ck.ImageFilter.MakeOffset(num(a.dx), num(a.dy), inA.f),
                  ),
                };
          break;
        case 'feGaussianBlur': {
          const [sx, sy] = (a.stdDeviation ?? '0').split(/[\s,]+/).map(Number);
          out =
            inA === 'empty'
              ? 'empty'
              : {
                  f: this.keep(
                    ck.ImageFilter.MakeBlur(
                      sx,
                      sy ?? sx,
                      ck.TileMode.Decal,
                      inA.f,
                    ),
                  ),
                };
          break;
        }
        case 'feMorphology': {
          const [rx, ry] = (a.radius ?? '0').split(/[\s,]+/).map(Number);
          if (inA === 'empty') {
            out = 'empty';
            break;
          }
          out = {
            f: this.keep(
              a.operator === 'dilate'
                ? ck.ImageFilter.MakeDilate(rx, ry ?? rx, inA.f)
                : ck.ImageFilter.MakeErode(rx, ry ?? rx, inA.f),
            ),
          };
          break;
        }
        case 'feBlend': {
          const mode = blendModeOf(ck, a.mode) ?? ck.BlendMode.SrcOver;
          out = blend(mode, input(a.in2), inA);
          break;
        }
        case 'feComposite': {
          const op = a.operator ?? 'over';
          const mode =
            op === 'in'
              ? ck.BlendMode.SrcIn
              : op === 'out'
                ? ck.BlendMode.SrcOut
                : op === 'atop'
                  ? ck.BlendMode.SrcATop
                  : op === 'xor'
                    ? ck.BlendMode.Xor
                    : ck.BlendMode.SrcOver;
          out = blend(mode, input(a.in2), inA);
          break;
        }
        case 'feMerge': {
          let acc: FilterValue = 'empty';
          for (const n of prim.children) {
            acc = blend(ck.BlendMode.SrcOver, acc, input(n.attrs.in));
          }
          out = acc;
          break;
        }
        default:
          out = inA;
      }
      if (a.result) {
        results.set(a.result, out);
      }
      prev = out;
    }
    if (prev === 'empty') {
      return this.keep(
        ck.ImageFilter.MakeShader(
          this.keep(ck.Shader.MakeColor(ck.TRANSPARENT, ck.ColorSpace.SRGB)),
        ),
      );
    }
    return prev.f;
  }
}

const SHAPE_TAGS = new Set([
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polygon',
  'polyline',
]);

export interface SvgPicture {
  picture: SkPicture;
  width: number;
  height: number;
}

/** Records an SVG into a picture in its width × height space. */
export function recordSvg(
  ck: CanvasKit,
  svg: string,
  res: Resources,
): SvgPicture | null {
  const root = parseXml(svg);
  if (!root || root.tag !== 'svg') {
    return null;
  }
  const vb = (root.attrs.viewBox ?? '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number);
  const width = num(root.attrs.width, vb[2] ?? 0);
  const height = num(root.attrs.height, vb[3] ?? 0);
  const rec = new ck.PictureRecorder();
  const pad = Math.max(width, height, 100);
  const canvas = rec.beginRecording(
    ck.XYWHRect(-pad, -pad, width + pad * 2, height + pad * 2),
  );
  if (
    vb.length === 4 &&
    vb[2] > 0 &&
    vb[3] > 0 &&
    (vb[2] !== width || vb[3] !== height || vb[0] || vb[1])
  ) {
    canvas.scale(width / vb[2], height / vb[3]);
    canvas.translate(-vb[0], -vb[1]);
  }
  const painter = new SvgPainter(ck, canvas, res, root);
  painter.paintChildren(root, inherit(root, ROOT_STYLE));
  const picture = rec.finishRecordingAsPicture();
  painter.dispose();
  rec.delete();
  return { picture, width, height };
}
