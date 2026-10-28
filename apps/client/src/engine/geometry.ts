// See apps/docs/skia-engine/tech.md §3.4.

export interface VecLike {
  x: number;
  y: number;
  z?: number;
}

export class Vec implements VecLike {
  x: number;
  y: number;
  z: number;
  constructor(x = 0, y = 0, z = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  clone() {
    return new Vec(this.x, this.y, this.z);
  }

  static From(v: VecLike) {
    return new Vec(v.x, v.y, v.z ?? 1);
  }

  static Add(a: VecLike, b: VecLike) {
    return new Vec(a.x + b.x, a.y + b.y);
  }

  static Sub(a: VecLike, b: VecLike) {
    return new Vec(a.x - b.x, a.y - b.y);
  }

  static Mul(a: VecLike, n: number) {
    return new Vec(a.x * n, a.y * n);
  }

  static Dist(a: VecLike, b: VecLike) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  static Len(a: VecLike) {
    return Math.hypot(a.x, a.y);
  }

  static Rot(a: VecLike, r: number) {
    const c = Math.cos(r);
    const s = Math.sin(r);
    return new Vec(a.x * c - a.y * s, a.x * s + a.y * c);
  }

  static Angle(a: VecLike, b: VecLike) {
    return Math.atan2(b.y - a.y, b.x - a.x);
  }
}

export interface BoxLike {
  x: number;
  y: number;
  w: number;
  h: number;
}

export class Box implements BoxLike {
  x: number;
  y: number;
  w: number;
  h: number;
  constructor(x = 0, y = 0, w = 0, h = 0) {
    this.x = x;
    this.y = y;
    this.w = w;
    this.h = h;
  }

  get minX() {
    return this.x;
  }
  get minY() {
    return this.y;
  }
  get maxX() {
    return this.x + this.w;
  }
  get maxY() {
    return this.y + this.h;
  }
  get width() {
    return this.w;
  }
  get height() {
    return this.h;
  }
  get midX() {
    return this.x + this.w / 2;
  }
  get midY() {
    return this.y + this.h / 2;
  }
  get center() {
    return new Vec(this.midX, this.midY);
  }
  get point() {
    return new Vec(this.x, this.y);
  }
  get corners() {
    return [
      new Vec(this.minX, this.minY),
      new Vec(this.maxX, this.minY),
      new Vec(this.maxX, this.maxY),
      new Vec(this.minX, this.maxY),
    ];
  }

  clone() {
    return new Box(this.x, this.y, this.w, this.h);
  }

  includes(other: BoxLike) {
    return Box.Contains(this, other);
  }

  collides(other: BoxLike) {
    return Box.Collides(this, other);
  }

  containsPoint(p: VecLike, margin = 0) {
    return (
      p.x >= this.minX - margin &&
      p.x <= this.maxX + margin &&
      p.y >= this.minY - margin &&
      p.y <= this.maxY + margin
    );
  }

  expandBy(n: number) {
    return new Box(this.x - n, this.y - n, this.w + n * 2, this.h + n * 2);
  }

  static From(b: BoxLike) {
    return new Box(b.x, b.y, b.w, b.h);
  }

  static FromPoints(points: VecLike[]) {
    if (!points.length) {
      return new Box();
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return new Box(minX, minY, maxX - minX, maxY - minY);
  }

  static Common(boxes: BoxLike[]) {
    if (!boxes.length) {
      return new Box();
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const b of boxes) {
      minX = Math.min(minX, b.x);
      minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w);
      maxY = Math.max(maxY, b.y + b.h);
    }
    return new Box(minX, minY, maxX - minX, maxY - minY);
  }

  static Contains(a: BoxLike, b: BoxLike) {
    return (
      a.x <= b.x &&
      a.y <= b.y &&
      a.x + a.w >= b.x + b.w &&
      a.y + a.h >= b.y + b.h
    );
  }

  static Collides(a: BoxLike, b: BoxLike) {
    return !(
      a.x + a.w < b.x ||
      b.x + b.w < a.x ||
      a.y + a.h < b.y ||
      b.y + b.h < a.y
    );
  }

  /** The overlap of two boxes, or null when they don't overlap. */
  static Intersect(a: BoxLike, b: BoxLike): Box | null {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    const r = Math.min(a.x + a.w, b.x + b.w);
    const btm = Math.min(a.y + a.h, b.y + b.h);
    return r < x || btm < y ? null : new Box(x, y, r - x, btm - y);
  }
}

export interface MatModel {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/** CSS `matrix(a, b, c, d, e, f)` order. */
export class Mat implements MatModel {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
  constructor(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
  }

  static Identity() {
    return new Mat();
  }

  static Translate(x: number, y: number) {
    return new Mat(1, 0, 0, 1, x, y);
  }

  static Rotate(r: number, cx = 0, cy = 0) {
    const c = Math.cos(r);
    const s = Math.sin(r);
    return new Mat(c, s, -s, c, cx - c * cx + s * cy, cy - s * cx - c * cy);
  }

  static Scale(sx: number, sy = sx) {
    return new Mat(sx, 0, 0, sy, 0, 0);
  }

  static Multiply(m: MatModel, n: MatModel) {
    return new Mat(
      m.a * n.a + m.c * n.b,
      m.b * n.a + m.d * n.b,
      m.a * n.c + m.c * n.d,
      m.b * n.c + m.d * n.d,
      m.a * n.e + m.c * n.f + m.e,
      m.b * n.e + m.d * n.f + m.f,
    );
  }

  static Compose(...mats: MatModel[]) {
    let out = new Mat();
    for (const m of mats) {
      out = Mat.Multiply(out, m);
    }
    return out;
  }

  static Inverse(m: MatModel) {
    const det = m.a * m.d - m.b * m.c;
    if (!det) {
      return new Mat();
    }
    return new Mat(
      m.d / det,
      -m.b / det,
      -m.c / det,
      m.a / det,
      (m.c * m.f - m.d * m.e) / det,
      (m.b * m.e - m.a * m.f) / det,
    );
  }

  static applyToPoint(m: MatModel, p: VecLike) {
    return new Vec(m.a * p.x + m.c * p.y + m.e, m.b * p.x + m.d * p.y + m.f);
  }

  static applyToPoints(m: MatModel, points: VecLike[]) {
    return points.map((p) => Mat.applyToPoint(m, p));
  }

  static applyToBounds(m: MatModel, b: BoxLike) {
    return Box.FromPoints(
      Mat.applyToPoints(m, [
        { x: b.x, y: b.y },
        { x: b.x + b.w, y: b.y },
        { x: b.x + b.w, y: b.y + b.h },
        { x: b.x, y: b.y + b.h },
      ]),
    );
  }

  static Decompose(m: MatModel) {
    const scaleX = Math.hypot(m.a, m.b);
    const det = m.a * m.d - m.b * m.c;
    return {
      x: m.e,
      y: m.f,
      scaleX,
      scaleY: scaleX ? det / scaleX : 0,
      rotation: Math.atan2(m.b, m.a),
    };
  }

  static From(m: MatModel) {
    return new Mat(m.a, m.b, m.c, m.d, m.e, m.f);
  }

  multiply(m: MatModel) {
    return Mat.Multiply(this, m);
  }

  invert() {
    return Mat.Inverse(this);
  }

  applyToPoint(p: VecLike) {
    return Mat.applyToPoint(this, p);
  }

  applyToPoints(points: VecLike[]) {
    return Mat.applyToPoints(this, points);
  }

  rotation() {
    return Math.atan2(this.b, this.a);
  }

  point() {
    return new Vec(this.e, this.f);
  }

  decompose() {
    return Mat.Decompose(this);
  }

  clone() {
    return Mat.From(this);
  }

  /** Skia's 3×3 row-major matrix. */
  toSkia(): number[] {
    return [this.a, this.c, this.e, this.b, this.d, this.f, 0, 0, 1];
  }
}

export abstract class Geometry2d {
  readonly isFilled: boolean;
  constructor(opts: { isFilled?: boolean } = {}) {
    this.isFilled = opts.isFilled ?? true;
  }

  abstract get bounds(): Box;
  abstract hitTestPoint(
    point: VecLike,
    margin?: number,
    hitInside?: boolean,
  ): boolean;
  abstract get vertices(): Vec[];

  distanceToPoint(point: VecLike, hitInside = false) {
    return this.hitTestPoint(point, 0, hitInside) ? 0 : Infinity;
  }
}

export class Rectangle2d extends Geometry2d {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
  constructor(opts: {
    x?: number;
    y?: number;
    width: number;
    height: number;
    isFilled?: boolean;
  }) {
    super(opts);
    this.x = opts.x ?? 0;
    this.y = opts.y ?? 0;
    this.w = opts.width;
    this.h = opts.height;
  }

  get bounds() {
    return new Box(this.x, this.y, this.w, this.h);
  }

  get vertices() {
    return this.bounds.corners;
  }

  hitTestPoint(point: VecLike, margin = 0, hitInside = false) {
    const inside = this.bounds.containsPoint(point, margin);
    if (!inside) {
      return false;
    }
    if (this.isFilled || hitInside) {
      return true;
    }
    const inner = this.bounds.expandBy(-margin);
    return !(inner.w > 0 && inner.h > 0 && inner.containsPoint(point));
  }
}

export class Ellipse2d extends Geometry2d {
  readonly w: number;
  readonly h: number;
  constructor(opts: { width: number; height: number; isFilled?: boolean }) {
    super(opts);
    this.w = opts.width;
    this.h = opts.height;
  }

  get bounds() {
    return new Box(0, 0, this.w, this.h);
  }

  get vertices() {
    const out: Vec[] = [];
    for (let i = 0; i < 32; i++) {
      const t = (i / 32) * Math.PI * 2;
      out.push(
        new Vec(
          this.w / 2 + (Math.cos(t) * this.w) / 2,
          this.h / 2 + (Math.sin(t) * this.h) / 2,
        ),
      );
    }
    return out;
  }

  hitTestPoint(point: VecLike, margin = 0, hitInside = false) {
    const rx = this.w / 2 + margin;
    const ry = this.h / 2 + margin;
    if (rx <= 0 || ry <= 0) {
      return false;
    }
    const dx = (point.x - this.w / 2) / rx;
    const dy = (point.y - this.h / 2) / ry;
    const inside = dx * dx + dy * dy <= 1;
    if (!inside || this.isFilled || hitInside) {
      return inside;
    }
    const ix = (point.x - this.w / 2) / Math.max(1e-6, this.w / 2 - margin);
    const iy = (point.y - this.h / 2) / Math.max(1e-6, this.h / 2 - margin);
    return ix * ix + iy * iy > 1;
  }
}

export function approximately(a: number, b: number, eps = 1e-6) {
  return Math.abs(a - b) < eps;
}
