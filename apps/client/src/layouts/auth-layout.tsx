import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { ThemeToggle } from '@/components/theme-toggle';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative isolate min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 -z-10 bg-grain" />
      <div className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] bg-gradient-to-b from-foreground/4 to-transparent" />

      <header className="absolute inset-x-0 top-0 z-10 flex items-center justify-between px-6 py-5 sm:px-10">
        <Link
          to="/"
          className="group flex items-baseline gap-1.5 text-sm tracking-tight"
        >
          <span className="font-display text-base leading-none italic">
            hono
          </span>
          <span className="leading-none text-muted-foreground/70">·</span>
          <span className="leading-none text-muted-foreground lowercase">
            mono
          </span>
        </Link>
        <ThemeToggle />
      </header>

      <main className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-24 sm:px-8">
        <div className="animate-in space-y-8 duration-500 fill-mode-backwards fade-in slide-in-from-bottom-2">
          {children}
        </div>
      </main>
    </div>
  );
}
