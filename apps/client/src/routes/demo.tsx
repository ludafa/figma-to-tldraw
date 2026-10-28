import { createFileRoute } from '@tanstack/react-router';

import { DemoPage } from '../pages/demo';

export interface DemoSearch {
  copies?: number;
}

export const Route = createFileRoute('/demo')({
  validateSearch: (search: Record<string, unknown>): DemoSearch => {
    const n = Number(search.copies);
    return {
      copies: Number.isInteger(n) && n > 1 ? Math.min(n, 4) : undefined,
    };
  },
  component: DemoPage,
});
