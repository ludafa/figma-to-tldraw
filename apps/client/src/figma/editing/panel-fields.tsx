import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { wheelUnit } from '../../engine/react/wheel';
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

// See apps/docs/figma-to-tldraw/tech.md §13.7.
export function stepSize(keys: {
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): number {
  return keys.metaKey ? 100 : keys.shiftKey ? 10 : keys.altKey ? 0.1 : 1;
}

// See apps/docs/figma-to-tldraw/tech.md §13.7.
export function wheelAmount(e: {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
}): number {
  const d = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
  return d * wheelUnit(e.deltaMode);
}

const WHEEL_STEP_PX = 4;
const WHEEL_STEP_MS = 50;
const WHEEL_RESET_MS = 500;
const MERGE_MS = 500;
const RESELECT_MS = 250;

// See apps/docs/figma-to-tldraw/tech.md §13.7.
export function wheelStepper(): (amount: number, now: number) => number {
  let total = 0;
  let last = -Infinity;
  let lastStep = -Infinity;
  return (amount, now) => {
    if (now - last > WHEEL_RESET_MS) {
      total = 0;
    }
    last = now;
    if (amount === 0) {
      return 0;
    }
    if (Math.sign(amount) !== Math.sign(total)) {
      total = 0;
    }
    total += amount;
    if (Math.abs(total) < WHEEL_STEP_PX || now - lastStep < WHEEL_STEP_MS) {
      return 0;
    }
    const dir = total < 0 ? 1 : -1;
    total = 0;
    lastStep = now;
    return dir;
  };
}

let merging = false;
let lastWheel: { field: HTMLInputElement; time: number } | undefined;

// See apps/docs/figma-to-tldraw/tech.md §13.7.
export function isMergingSteps(): boolean {
  return merging;
}

// See apps/docs/figma-to-tldraw/tech.md §13.7.
export function stepBase(
  typed: string | undefined,
  shown: number | undefined,
): number | undefined {
  if (typed === undefined) {
    return shown;
  }
  const v = Number(typed);
  return typed.trim() !== '' && Number.isFinite(v) ? v : undefined;
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
  onStep?: (delta: number, typed: string | undefined) => boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const box = useRef<HTMLLabelElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const stepRef = useRef(onStep);
  const edited = useRef(false);
  const stepped = useRef(-Infinity);
  useLayoutEffect(() => {
    stepRef.current = onStep;
  });
  const step = useCallback((delta: number) => {
    const typed = edited.current ? input.current?.value : undefined;
    if (stepRef.current?.(delta, typed)) {
      stepped.current = performance.now();
      edited.current = false;
      setDraft(null);
    }
  }, []);
  const steps = !!onStep && !disabled;
  // See apps/docs/figma-to-tldraw/tech.md §13.7.
  useEffect(() => {
    const el = box.current;
    if (!el || !steps) {
      return;
    }
    const next = wheelStepper();
    const onWheel = (e: WheelEvent) => {
      const field = input.current;
      if (e.ctrlKey || !field || document.activeElement !== field) {
        return;
      }
      e.preventDefault();
      const now = performance.now();
      const dir = next(wheelAmount(e), now);
      if (!dir) {
        return;
      }
      merging = lastWheel?.field === field && now - lastWheel.time <= MERGE_MS;
      lastWheel = { field, time: now };
      try {
        step(dir * stepSize(e));
      } finally {
        merging = false;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [steps, step]);
  useEffect(() => {
    if (
      performance.now() - stepped.current < RESELECT_MS &&
      document.activeElement === input.current
    ) {
      input.current?.select();
    }
    stepped.current = -Infinity;
  }, [value]);
  const commit = (text: string) => {
    setDraft(null);
    edited.current = false;
    stepped.current = -Infinity;
    lastWheel = undefined;
    if (raw) {
      if (text !== value) {
        onCommit(text);
      }
    } else if (text.trim() !== '' && text !== value) {
      onCommit(text.trim());
    }
  };
  return (
    <label ref={box} className={`${FIELD} ${disabled ? 'opacity-50' : ''}`}>
      {label !== undefined && (
        <span className="shrink-0 text-black/45">{label}</span>
      )}
      <input
        ref={input}
        className="w-full min-w-0 bg-transparent outline-none"
        value={draft ?? value}
        placeholder={placeholder}
        disabled={disabled}
        onFocus={(e) => {
          edited.current = false;
          setDraft(value);
          e.currentTarget.select();
        }}
        onChange={(e) => {
          edited.current = true;
          stepped.current = -Infinity;
          setDraft(e.currentTarget.value);
        }}
        onMouseDown={() => {
          stepped.current = -Infinity;
        }}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => {
          stepped.current = -Infinity;
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          } else if (onStep && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault();
            lastWheel = undefined;
            step((e.key === 'ArrowUp' ? 1 : -1) * stepSize(e));
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
      onStep={(delta, typed) => {
        const base = stepBase(typed, shown);
        if (base === undefined) {
          return false;
        }
        commit(round(base + delta));
        return true;
      }}
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
