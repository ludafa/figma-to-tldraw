import { type ReactNode, useState } from 'react';

import type { FigmaColor } from '../types';

// See apps/docs/figma-to-tldraw/tech.md §13.4.

export const MIXED = Symbol('mixed');

export type Shown<T> = T | typeof MIXED | undefined;

export function same<T>(values: (T | typeof MIXED)[]): Shown<T> {
  if (!values.length) {
    return undefined;
  }
  if (values.includes(MIXED)) {
    return MIXED;
  }
  const first = JSON.stringify(values[0]);
  return values.every((v) => JSON.stringify(v) === first)
    ? (values[0] as T)
    : MIXED;
}

export function round(v: number): number {
  return Math.round(v * 100) / 100;
}

export function toHex(c: FigmaColor | undefined): string {
  if (!c) {
    return '#000000';
  }
  return `#${[c.r, c.g, c.b]
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

export function fromHex(hex: string, a: number): FigmaColor | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) {
    return undefined;
  }
  const n = Number.parseInt(m[1], 16);
  return {
    r: ((n >> 16) & 255) / 255,
    g: ((n >> 8) & 255) / 255,
    b: (n & 255) / 255,
    a,
  };
}

export const FIELD =
  'flex h-6 min-w-0 items-center gap-1 rounded-sm bg-black/[0.04] px-1.5 focus-within:ring-1 focus-within:ring-[var(--color-selected,#2f80ed)]';

export function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="border-t border-black/10 px-3 py-2">
      <div className="mb-1.5 flex h-5 items-center justify-between font-semibold">
        <span>{title}</span>
        {action}
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </div>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-1.5">{children}</div>;
}

export function TextField({
  label,
  value,
  placeholder,
  disabled,
  raw,
  onCommit,
  onStep,
}: {
  label?: ReactNode;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  // See apps/docs/figma-to-tldraw/tech.md §21.6.
  raw?: boolean;
  onCommit: (text: string) => void;
  onStep?: (delta: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (text: string) => {
    setDraft(null);
    if (raw) {
      if (text !== value) {
        onCommit(text);
      }
    } else if (text.trim() !== '' && text !== value) {
      onCommit(text.trim());
    }
  };
  return (
    <label className={`${FIELD} ${disabled ? 'opacity-50' : ''}`}>
      {label !== undefined && (
        <span className="shrink-0 text-black/45">{label}</span>
      )}
      <input
        className="w-full min-w-0 bg-transparent outline-none"
        value={draft ?? value}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={(e) => {
          setDraft(value);
          e.currentTarget.select();
        }}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          } else if (onStep && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            setDraft(null);
            onStep((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1));
          }
        }}
      />
    </label>
  );
}

export function NumberField({
  label,
  value,
  disabled,
  min,
  scale = 1,
  onCommit,
}: {
  label: ReactNode;
  value: Shown<number>;
  disabled?: boolean;
  min?: number;
  scale?: number;
  onCommit: (v: number) => void;
}) {
  const shown = typeof value === 'number' ? round(value * scale) : undefined;
  const commit = (v: number) => onCommit(Math.max(min ?? -Infinity, v) / scale);
  return (
    <TextField
      label={label}
      value={shown === undefined ? '' : String(shown)}
      placeholder={value === MIXED ? '混合' : ''}
      disabled={disabled}
      onCommit={(text) => {
        const v = Number(text);
        if (Number.isFinite(v)) {
          commit(v);
        }
      }}
      onStep={(delta) => commit((shown ?? 0) + delta)}
    />
  );
}

export function SelectField<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label?: string;
  value: Shown<T>;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  const known = options.some(([v]) => v === value);
  return (
    <label className={FIELD}>
      {label && <span className="shrink-0 text-black/45">{label}</span>}
      <select
        className="w-full min-w-0 bg-transparent outline-none"
        value={known ? String(value) : ''}
        onChange={(e) => {
          const hit = options.find(
            ([v]) => String(v) === e.currentTarget.value,
          );
          if (hit) {
            onChange(hit[0]);
          }
        }}
      >
        {!known && (
          <option value="" disabled>
            {value === MIXED
              ? '混合'
              : value === undefined
                ? ''
                : String(value)}
          </option>
        )}
        {options.map(([v, text]) => (
          <option key={String(v)} value={String(v)}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

export function ColorField({
  color,
  onMark,
  onChange,
}: {
  color: FigmaColor | undefined;
  /** Called before a color drag, so the drag is one undo step. */
  onMark: () => void;
  onChange: (c: FigmaColor, merge: boolean) => void;
}) {
  const hex = toHex(color);
  const a = color?.a ?? 1;
  return (
    <div className={FIELD}>
      <input
        type="color"
        className="size-4 shrink-0 cursor-pointer rounded-sm border border-black/10 bg-transparent p-0"
        value={hex}
        onPointerDown={onMark}
        onChange={(e) => {
          const c = fromHex(e.currentTarget.value, a);
          if (c) {
            onChange(c, true);
          }
        }}
      />
      <input
        className="w-full min-w-0 bg-transparent uppercase outline-none"
        defaultValue={hex.slice(1)}
        key={hex}
        onFocus={(e) => e.currentTarget.select()}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        onBlur={(e) => {
          const c = fromHex(e.currentTarget.value, a);
          if (c && toHex(c) !== hex) {
            onChange(c, false);
          }
        }}
      />
    </div>
  );
}
