import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { ThemeToggle } from '@/components/theme-toggle';

import { authClient } from '../lib/auth-client';

export function AppLayout({ children }: { children: ReactNode }) {
  const { data: session } = authClient.useSession();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b border-foreground/8 bg-background/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3.5 sm:px-8">
          <Link
            to="/"
            className="flex items-baseline gap-1.5 text-base tracking-tight"
          >
            <span className="font-display text-lg leading-none italic">
              hono
            </span>
            <span className="leading-none text-muted-foreground/70">·</span>
            <span className="leading-none text-muted-foreground lowercase">
              mono
            </span>
          </Link>
          <div className="flex items-center gap-2 sm:gap-3">
            {session?.user && (
              <span className="hidden text-xs text-muted-foreground sm:inline">
                {session.user.email}
              </span>
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-10 sm:px-8 sm:py-14">
        <div className="animate-in duration-500 fill-mode-backwards fade-in slide-in-from-bottom-1">
          {children}
        </div>
      </main>
    </div>
  );
}
