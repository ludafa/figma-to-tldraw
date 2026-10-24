import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';

import { getApiNotes, postApiNotes } from '../gen/clients';
import type { Note } from '../gen/types';

export function DashboardPage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  useEffect(() => {
    getApiNotes()
      .then(setNotes)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) {
      return;
    }
    const note = await postApiNotes({ title, body });
    setNotes((prev) => [...prev, note]);
    setTitle('');
    setBody('');
  }

  return (
    <div className="grid gap-12 md:grid-cols-[minmax(0,1fr)_minmax(280px,360px)] md:gap-16">
      <section className="space-y-10">
        <header className="space-y-3">
          <p className="text-[0.7rem] font-medium tracking-[0.18em] text-muted-foreground uppercase">
            Workspace
          </p>
          <h1 className="font-display text-5xl leading-[1.02] tracking-tight">
            <span className="italic">Notes</span>
          </h1>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            A throwaway example wired through the full stack: Hono → OpenAPI →
            Kubb → React. Replace it with your domain.
          </p>
        </header>

        {loading ? (
          <ul className="divide-y divide-foreground/8 rounded-2xl border border-foreground/8 bg-card/40">
            {[0, 1, 2].map((i) => (
              <li
                key={i}
                className="animate-pulse space-y-2 px-5 py-4"
                style={{ animationDelay: `${i * 80}ms` }}
              >
                <div className="h-4 w-1/3 rounded bg-foreground/8" />
                <div className="h-3 w-2/3 rounded bg-foreground/6" />
              </li>
            ))}
          </ul>
        ) : notes.length === 0 ? (
          <div className="flex flex-col items-start gap-2 rounded-2xl border border-dashed border-foreground/10 px-6 py-10 text-muted-foreground">
            <p className="font-display text-2xl leading-tight text-foreground italic">
              Nothing yet.
            </p>
            <p className="text-sm">
              Use the form on the right to capture your first thought.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-foreground/8 overflow-hidden rounded-2xl border border-foreground/10 bg-card/60 shadow-[0_1px_0_0_var(--color-foreground)]/[0.02]">
            {notes.map((n, i) => (
              <li
                key={n.id}
                className="group relative animate-in px-5 py-4 duration-500 fill-mode-backwards fade-in slide-in-from-bottom-1 hover:bg-foreground/3"
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <div className="font-medium text-foreground">{n.title}</div>
                {n.body && (
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {n.body}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <aside className="md:sticky md:top-24 md:self-start">
        <form
          onSubmit={handleCreate}
          className="group flex flex-col gap-4 rounded-2xl border border-foreground/10 bg-card/70 p-5 backdrop-blur-sm transition-colors hover:border-foreground/15"
        >
          <div className="flex items-center justify-between">
            <p className="text-[0.7rem] font-medium tracking-[0.18em] text-muted-foreground uppercase">
              New note
            </p>
            <span className="font-display text-xs text-muted-foreground/60 italic">
              draft
            </span>
          </div>
          <input
            type="text"
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full border-0 border-b border-foreground/15 bg-transparent py-2 font-medium transition-colors focus:border-foreground focus:ring-0 focus:outline-none"
          />
          <textarea
            placeholder="Body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            className="w-full resize-none border-0 border-b border-foreground/15 bg-transparent py-2 text-sm leading-relaxed transition-colors focus:border-foreground focus:ring-0 focus:outline-none"
          />
          <Button
            type="submit"
            size="sm"
            disabled={!title.trim()}
            className="self-end"
          >
            Add note
          </Button>
        </form>
      </aside>
    </div>
  );
}
