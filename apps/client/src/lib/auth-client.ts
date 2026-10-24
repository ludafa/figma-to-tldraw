import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL || undefined,
});

// See apps/docs/auth/tech.md §1.
const TEST_USER = {
  name: 'Test',
  email: 'test@test.com',
  password: 'test1234',
};

export async function ensureTestSession() {
  const session = await authClient.getSession();
  if (session.data) {
    return;
  }

  const signIn = await authClient.signIn.email({
    email: TEST_USER.email,
    password: TEST_USER.password,
  });
  if (!signIn.error) {
    return;
  }

  const signUp = await authClient.signUp.email(TEST_USER);
  if (signUp.error) {
    throw new Error(
      `Cannot sign in as ${TEST_USER.email}: ${signUp.error.message ?? signIn.error.message}`,
    );
  }
}
