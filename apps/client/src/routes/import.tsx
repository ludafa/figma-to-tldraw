import { createFileRoute } from '@tanstack/react-router';

import { ImportPage } from '../pages/import';

export interface ImportSearch {
  id?: string;
  case?: string;
}

export const Route = createFileRoute('/import')({
  validateSearch: (search: Record<string, unknown>): ImportSearch => ({
    id: typeof search.id === 'string' ? search.id : undefined,
    case: typeof search.case === 'string' ? search.case : undefined,
  }),
  component: ImportPage,
});
