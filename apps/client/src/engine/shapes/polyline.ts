import { Box, Geometry2d, Vec, type VecLike } from '../geometry';

// See apps/docs/skia-engine/tech.md §6.8.

function distToSegment(p: VecLike, a: VecLike, b: VecLike) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2
    ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
    : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** An open line through points; hit when within `width / 2 + margin`. */
export class Polyline2d extends Geometry2d {
  readonly points: Vec[];
  readonly width: number;

  constructor(opts: { points: VecLike[]; width: number }) {
    super({ isFilled: false });
    this.points = opts.points.map((p) => new Vec(p.x, p.y));
    this.width = opts.width;
  }

  get bounds() {
    if (!this.points.length) {
      return new Box();
    }
    return Box.FromPoints(this.points);
  }

  get vertices() {
    return this.points;
  }

  override distanceToPoint(point: VecLike) {
    if (this.points.length === 1) {
      return Vec.Dist(point, this.points[0]);
    }
    let best = Infinity;
    for (let i = 1; i < this.points.length; i++) {
      best = Math.min(
        best,
        distToSegment(point, this.points[i - 1], this.points[i]),
      );
    }
    return best;
  }

  hitTestPoint(point: VecLike, margin = 0) {
    return this.distanceToPoint(point) <= this.width / 2 + margin;
  }
}
