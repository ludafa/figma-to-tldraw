import { createFileRoute } from '@tanstack/react-router';

import { CanvasPage } from '../pages/canvas';

export interface CanvasSearch {
  case?: string;
  shot?: 1;
  select?: string;
  /** Variable modes to switch the root frame to, as `Collection:Mode,Collection:Mode`. */
  modes?: string;
  /** Collections to give another collection's values, as `Target:Source,Target:Source`. */
  values?: string;
}

export const Route = createFileRoute('/canvas')({
  validateSearch: (search: Record<string, unknown>): CanvasSearch => ({
    case: typeof search.case === 'string' ? search.case : undefined,
    shot: search.shot === 1 || search.shot === '1' ? 1 : undefined,
    select: typeof search.select === 'string' ? search.select : undefined,
    modes: typeof search.modes === 'string' ? search.modes : undefined,
    values: typeof search.values === 'string' ? search.values : undefined,
  }),
  component: CanvasPage,
});
