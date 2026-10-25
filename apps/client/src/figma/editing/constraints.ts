import type { FigmaLayoutConstraint } from '../types';
import type { Box } from './auto-layout';

// See apps/docs/figma-to-tldraw/tech.md §13.1.

type Rule = 'MIN' | 'MAX' | 'CENTER' | 'STRETCH' | 'SCALE';

const HORIZONTAL: Record<FigmaLayoutConstraint['horizontal'], Rule> = {
  LEFT: 'MIN',
  RIGHT: 'MAX',
  CENTER: 'CENTER',
  LEFT_RIGHT: 'STRETCH',
  SCALE: 'SCALE',
};

const VERTICAL: Record<FigmaLayoutConstraint['vertical'], Rule> = {
  TOP: 'MIN',
  BOTTOM: 'MAX',
  CENTER: 'CENTER',
  TOP_BOTTOM: 'STRETCH',
  SCALE: 'SCALE',
};

function along(
  rule: Rule,
  pos: number,
  size: number,
  from: number,
  to: number,
  rigid: boolean,
): [number, number] {
  const delta = to - from;
  switch (rule) {
    case 'MAX':
      return [pos + delta, size];
    case 'CENTER':
      return [pos + delta / 2, size];
    case 'STRETCH':
      return rigid ? [pos + delta / 2, size] : [pos, Math.max(0, size + delta)];
    case 'SCALE': {
      const k = from > 0 ? to / from : 1;
      return rigid
        ? [(pos + size / 2) * k - size / 2, size]
        : [pos * k, size * k];
    }
    default:
      return [pos, size];
  }
}

/** Where a child of a resized frame goes, following its Figma constraints. */
export function constrain(
  box: Box,
  constraints: FigmaLayoutConstraint | undefined,
  from: { w: number; h: number },
  to: { w: number; h: number },
  rigid = false,
): Box {
  const [x, w] = along(
    HORIZONTAL[constraints?.horizontal ?? 'LEFT'],
    box.x,
    box.w,
    from.w,
    to.w,
    rigid,
  );
  const [y, h] = along(
    VERTICAL[constraints?.vertical ?? 'TOP'],
    box.y,
    box.h,
    from.h,
    to.h,
    rigid,
  );
  return { x, y, w, h };
}
