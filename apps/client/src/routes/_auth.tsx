import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';

import { AuthLayout } from '../layouts/auth-layout';

// See apps/docs/auth/tech.md §2.
export const Route = createFileRoute('/_auth')({
  component: () => (
    <AuthLayout>
      <Outlet />
    </AuthLayout>
  ),
  beforeLoad: () => {
    throw redirect({ to: '/' });
  },
});
