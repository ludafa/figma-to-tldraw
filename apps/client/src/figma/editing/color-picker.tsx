import { Pipette } from 'lucide-react';
import { type KeyboardEvent, type PointerEvent, useRef, useState } from 'react';

import { rgba } from '../geometry';
import type { FigmaColor } from '../types';
import { type Hsv, hsvToRgb, rgbToHsv, sameRgb } from './paint-edit';
import {
  FIELD,
  fromHex,
  HexInput,
  NumberField,
  toHex,
  ToolButton,
} from './panel-fields';

// See apps/docs/figma-to-tldraw/tech.md §22.4.

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };
const EyeDropper = (globalThis as { EyeDropper?: EyeDropperCtor }).EyeDropper;

export const CHECKER =
  'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 0 0 / 8px 8px';

/** A flat color over the transparency checkerboard. */
export function swatchBackground(color: FigmaColor): string {
  return `linear-gradient(${rgba(color)}, ${rgba(color)}), ${CHECKER}`;
}

export interface ColorPickerProps {
  color: FigmaColor;
  /** Shown on the opacity bar: a solid paint's `opacity`, a gradient stop's `color.a`. */
  alpha: number;
  /** Called before a drag, so the drag is one undo step. */
  onMark: () => void;
  onChange: (color: FigmaColor, alpha: number, merge: boolean) => void;
}

export function ColorPicker({
  color,
  alpha,
  onMark,
  onChange,
}: ColorPickerProps) {
  const [kept, setKept] = useState<Hsv>(() => rgbToHsv(color));
  const hsv = sameRgb(hsvToRgb(kept), color) ? kept : rgbToHsv(color, kept);
  const hex = toHex(color);
  const rgb = hex
    .slice(1)
    .match(/../g)
    ?.map((d) => Number.parseInt(d, 16));

  const set = (next: Hsv, merge: boolean) => {
    setKept(next);
    onChange(hsvToRgb(next, color.a ?? 1), alpha, merge);
  };
  const pick = async () => {
    if (!EyeDropper) {
      return;
    }
    try {
      const { sRGBHex } = await new EyeDropper().open();
      const c = fromHex(sRGBHex, color.a ?? 1);
      if (c) {
        onChange(c, alpha, false);
      }
    } catch {
      // Esc cancels the eyedropper.
    }
  };

  return (
    <div className="flex flex-col gap-2 px-2 pb-3">
      <SaturationValue hsv={hsv} hex={hex} onMark={onMark} onChange={set} />
      <div className="flex items-center gap-2">
        <ToolButton
          label={EyeDropper ? '吸管' : '这个浏览器不支持吸管'}
          disabled={!EyeDropper}
          onClick={() => void pick()}
        >
          <Pipette size={14} />
        </ToolButton>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <ColorSlider
            label="色相"
            value={hsv.h}
            max={360}
            step={1}
            track="linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)"
            onMark={onMark}
            onChange={(h, merge) => set({ ...hsv, h }, merge)}
          />
          <ColorSlider
            label="不透明度"
            value={alpha}
            max={1}
            step={0.01}
            track={`linear-gradient(to right, rgb(${rgb?.join(' ')} / 0), ${hex}), ${CHECKER}`}
            onMark={onMark}
            onChange={(a, merge) => onChange(color, a, merge)}
          />
        </div>
      </div>
      <div className="flex items-center gap-1">
        <div className={`${FIELD} flex-1`}>
          <span className="shrink-0 text-foreground/45">Hex</span>
          <HexInput color={color} onCommit={(c) => onChange(c, alpha, false)} />
        </div>
        <div className="w-14 shrink-0">
          <NumberField
            label=""
            value={alpha}
            scale={100}
            min={0}
            onCommit={(a) => onChange(color, Math.min(1, a), false)}
          />
        </div>
      </div>
    </div>
  );
}

const KEY_STEPS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, 1],
  ArrowDown: [0, -1],
};

function SaturationValue({
  hsv,
  hex,
  onMark,
  onChange,
}: {
  hsv: Hsv;
  hex: string;
  onMark: () => void;
  onChange: (hsv: Hsv, merge: boolean) => void;
}) {
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const s = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    const v = 1 - Math.min(1, Math.max(0, (e.clientY - box.top) / box.height));
    onChange({ ...hsv, s, v }, true);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = KEY_STEPS[e.key];
    if (!step) {
      return;
    }
    e.preventDefault();
    const amount = e.shiftKey ? 0.1 : 0.01;
    const clamp = (x: number) => Math.min(1, Math.max(0, x));
    onChange(
      {
        ...hsv,
        s: clamp(hsv.s + step[0] * amount),
        v: clamp(hsv.v + step[1] * amount),
      },
      false,
    );
  };
  return (
    <div
      role="slider"
      tabIndex={0}
      aria-label="饱和度和明度"
      aria-valuenow={Math.round(hsv.s * 100)}
      aria-valuetext={`饱和度 ${Math.round(hsv.s * 100)}%，明度 ${Math.round(hsv.v * 100)}%`}
      className="relative aspect-square w-full cursor-crosshair touch-none rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-selected,#2f80ed)]"
      style={{
        background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))`,
      }}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        onMark();
        move(e);
      }}
      onPointerMove={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          move(e);
        }
      }}
      onKeyDown={key}
    >
      <span
        className="pointer-events-none absolute size-3 -translate-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/30%),inset_0_0_0_1px_rgb(0_0_0/30%)]"
        style={{
          left: `${hsv.s * 100}%`,
          top: `${(1 - hsv.v) * 100}%`,
          background: hex,
        }}
      />
    </div>
  );
}

function ColorSlider({
  label,
  value,
  max,
  step,
  track,
  onMark,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  step: number;
  track: string;
  onMark: () => void;
  onChange: (v: number, merge: boolean) => void;
}) {
  const dragging = useRef(false);
  return (
    <input
      type="range"
      aria-label={label}
      min={0}
      max={max}
      step={step}
      value={value}
      className="figma-color-slider w-full"
      style={{ background: track }}
      onPointerDown={() => {
        dragging.current = true;
        onMark();
        addEventListener(
          'pointerup',
          () => {
            dragging.current = false;
          },
          { once: true },
        );
      }}
      onChange={(e) =>
        onChange(Number(e.currentTarget.value), dragging.current)
      }
    />
  );
}
