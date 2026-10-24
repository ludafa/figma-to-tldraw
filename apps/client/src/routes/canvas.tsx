import { createFileRoute } from '@tanstack/react-router';

import { CanvasPage } from '../pages/canvas';

export interface CanvasSearch {
  case?: string;
  shot?: 1;
}

export const Route = createFileRoute('/canvas')({
  validateSearch: (search: Record<string, unknown>): CanvasSearch => ({
    case: typeof search.case === 'string' ? search.case : undefined,
    shot: search.shot === 1 || search.shot === '1' ? 1 : undefined,
  }),
  component: CanvasPage,
});
