import { Link, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

import { authClient } from '../lib/auth-client';

export function RegisterPage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const result = await authClient.signUp.email({ name, email, password });
      if (result.error) {
        setError(result.error.message ?? 'Sign up failed');
      } else {
        await navigate({ to: '/' });
      }
    } catch {
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <header className="space-y-2.5">
        <h1 className="font-display text-4xl leading-[1.05] tracking-tight">
          Create your <span className="italic">account</span>.
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Spin up a workspace in under a minute — no credit card.
        </p>
      </header>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <label
            htmlFor="name"
            className="text-[0.7rem] font-medium tracking-[0.16em] text-muted-foreground uppercase"
          >
            Name
          </label>
          <input
            id="name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full border-0 border-b border-foreground/15 bg-transparent py-2 text-base transition-colors focus:border-foreground focus:ring-0 focus:outline-none"
          />
        </div>
        <div className="space-y-1.5">
          <label
            htmlFor="email"
            className="text-[0.7rem] font-medium tracking-[0.16em] text-muted-foreground uppercase"
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full border-0 border-b border-foreground/15 bg-transparent py-2 text-base transition-colors focus:border-foreground focus:ring-0 focus:outline-none"
          />
        </div>
        <div className="space-y-1.5">
          <label
            htmlFor="password"
            className="flex items-baseline justify-between text-[0.7rem] font-medium tracking-[0.16em] text-muted-foreground uppercase"
          >
            <span>Password</span>
            <span className="tracking-normal text-muted-foreground/70 normal-case">
              min 8 chars
            </span>
          </label>
          <input
            id="password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="w-full border-0 border-b border-foreground/15 bg-transparent py-2 text-base transition-colors focus:border-foreground focus:ring-0 focus:outline-none"
          />
        </div>
        {error && (
          <p className="animate-in text-sm text-destructive duration-200 fade-in slide-in-from-top-1">
            {error}
          </p>
        )}
        <Button type="submit" disabled={loading} className="h-11 w-full">
          {loading ? 'Creating account…' : 'Create account'}
        </Button>
      </form>

      <p className="text-center text-xs text-muted-foreground">
        Already a member?{' '}
        <Link
          to="/login"
          className="text-foreground underline decoration-foreground/30 underline-offset-4 transition-colors hover:decoration-foreground"
        >
          Sign in
        </Link>
      </p>
    </>
  );
}
