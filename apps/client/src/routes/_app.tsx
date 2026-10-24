import { createFileRoute, Outlet } from '@tanstack/react-router';

import { AppLayout } from '../layouts/app-layout';
import { ensureTestSession } from '../lib/auth-client';

export const Route = createFileRoute('/_app')({
  component: () => (
    <AppLayout>
      <Outlet />
    </AppLayout>
  ),
  beforeLoad: ensureTestSession,
});
