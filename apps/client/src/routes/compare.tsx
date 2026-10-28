import { createFileRoute } from '@tanstack/react-router';

import { ComparePage } from '../pages/compare';

export interface CompareSearch {
  id?: string;
  case?: string;
}

export const Route = createFileRoute('/compare')({
  validateSearch: (search: Record<string, unknown>): CompareSearch => ({
    id: typeof search.id === 'string' ? search.id : undefined,
    case: typeof search.case === 'string' ? search.case : undefined,
  }),
  component: ComparePage,
});
