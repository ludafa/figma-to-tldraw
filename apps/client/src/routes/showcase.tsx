import { createFileRoute } from '@tanstack/react-router';

import { ShowcasePage } from '../pages/showcase';

export interface ShowcaseSearch {
  case?: string;
}

export const Route = createFileRoute('/showcase')({
  validateSearch: (search: Record<string, unknown>): ShowcaseSearch => ({
    case: typeof search.case === 'string' ? search.case : undefined,
  }),
  component: ShowcasePage,
});
