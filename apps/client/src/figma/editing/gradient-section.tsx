import { ArrowLeftRight, Minus, Plus, RotateCw } from 'lucide-react';
import { type KeyboardEvent, type PointerEvent, useRef, useState } from 'react';

import { rgba } from '../geometry';
import type { FigmaColorStop, FigmaPaint } from '../types';
import { CHECKER, ColorPicker, swatchBackground } from './color-picker';
import {
  addStop,
  flipGradient,
  freePosition,
  GRADIENT_TYPES,
  MIN_STOPS,
  moveStop,
  removeStop,
  rotateGradient,
  setStopColor,
} from './paint-edit';
import {
  FIELD,
  HexInput,
  NumberField,
  SelectField,
  ToolButton,
} from './panel-fields';

// See apps/docs/figma-to-tldraw/tech.md §22.5.

const HANDLE = 12;

const GRADIENT_LABELS: Record<(typeof GRADIENT_TYPES)[number], string> = {
  GRADIENT_LINEAR: '线性',
  GRADIENT_RADIAL: '径向',
  GRADIENT_ANGULAR: '角度',
  GRADIENT_DIAMOND: '菱形',
};

function ramp(stops: FigmaColorStop[]): string {
  const parts = stops.map((s) => `${rgba(s.color)} ${s.position * 100}%`);
  return `linear-gradient(to right, ${parts.join(', ')})`;
}

export function GradientSection({
  paint,
  onChange,
  onMark,
}: {
  paint: FigmaPaint;
  onChange: (paint: FigmaPaint, merge: boolean) => void;
  onMark: () => void;
}) {
  const stops = paint.gradientStops ?? [];
  const [picked, setPicked] = useState(0);
  const selected = Math.min(picked, stops.length - 1);
  const stop = stops[selected];
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<{
    index: number;
    paint: FigmaPaint;
    marked: boolean;
  }>(undefined);

  const positionAt = (clientX: number) => {
    const box = bar.current?.getBoundingClientRect();
    return box ? (clientX - box.left - HANDLE / 2) / (box.width - HANDLE) : 0;
  };
  const startDrag = (
    e: PointerEvent,
    index: number,
    from: FigmaPaint,
    marked: boolean,
  ) => {
    e.preventDefault();
    bar.current?.setPointerCapture(e.pointerId);
    drag.current = { index, paint: from, marked };
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) {
      return;
    }
    if (!d.marked) {
      onMark();
      d.marked = true;
    }
    const r = moveStop(d.paint, d.index, positionAt(e.clientX));
    drag.current = { ...d, index: r.index, paint: r.paint };
    setPicked(r.index);
    onChange(r.paint, true);
  };
  const remove = (i: number) => {
    onChange(removeStop(paint, i), false);
    setPicked(
      i < selected || (i === selected && i > 0) ? selected - 1 : selected,
    );
  };
  const onHandleKey = (e: KeyboardEvent, i: number) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const r = moveStop(
        paint,
        i,
        stops[i].position + (e.key === 'ArrowLeft' ? -step : step),
      );
      setPicked(r.index);
      onChange(r.paint, false);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove(i);
    }
  };

  return (
    <>
      <div className="flex items-center gap-1 px-2">
        <div className="min-w-0 flex-1">
          <SelectField
            value={paint.type as (typeof GRADIENT_TYPES)[number]}
            options={GRADIENT_TYPES.map((t) => [t, GRADIENT_LABELS[t]])}
            onChange={(type) => onChange({ ...paint, type }, false)}
          />
        </div>
        <ToolButton
          label="翻转"
          onClick={() => {
            onChange(flipGradient(paint), false);
            setPicked(stops.length - 1 - selected);
          }}
        >
          <ArrowLeftRight size={14} />
        </ToolButton>
        <ToolButton
          label="旋转 90°"
          onClick={() => onChange(rotateGradient(paint), false)}
        >
          <RotateCw size={14} />
        </ToolButton>
      </div>
      <div className="px-2 py-2">
        <div
          ref={bar}
          role="group"
          aria-label="色标条"
          className="relative h-4 cursor-copy touch-none rounded-sm shadow-[inset_0_0_0_1px_rgb(0_0_0/10%)]"
          style={{ background: `${ramp(stops)}, ${CHECKER}` }}
          onPointerDown={(e) => {
            if (e.target !== e.currentTarget) {
              return;
            }
            onMark();
            const r = addStop(paint, positionAt(e.clientX));
            setPicked(r.index);
            onChange(r.paint, true);
            startDrag(e, r.index, r.paint, true);
          }}
          onPointerMove={onMove}
          onPointerUp={() => {
            drag.current = undefined;
          }}
          onLostPointerCapture={() => {
            drag.current = undefined;
          }}
        >
          {stops.map((s, i) => (
            <button
              key={i}
              type="button"
              aria-label={`色标 ${Math.round(s.position * 100)}%`}
              aria-pressed={i === selected}
              className={`absolute top-1/2 -translate-1/2 cursor-grab rounded-[3px] border-2 shadow-[0_0_0_1px_rgb(0_0_0/30%)] outline-none ${i === selected ? 'z-10 border-[var(--color-selected,#2f80ed)]' : 'border-white'}`}
              style={{
                width: HANDLE,
                height: HANDLE + 4,
                left: `calc(${HANDLE / 2}px + ${s.position} * (100% - ${HANDLE}px))`,
                background: swatchBackground(s.color),
              }}
              onPointerDown={(e) => {
                setPicked(i);
                startDrag(e, i, paint, false);
                e.currentTarget.focus();
              }}
              onKeyDown={(e) => onHandleKey(e, i)}
            />
          ))}
        </div>
      </div>
      {stop && (
        <ColorPicker
          key={selected}
          color={stop.color}
          alpha={stop.color.a ?? 1}
          onMark={onMark}
          onChange={(color, a, merge) =>
            onChange(setStopColor(paint, selected, { ...color, a }), merge)
          }
        />
      )}
      <div className="flex items-center justify-between border-t border-foreground/10 py-1 pr-1.5 pl-3">
        <span className="font-medium">色标</span>
        <ToolButton
          label="添加色标"
          onClick={() => {
            const r = addStop(paint, freePosition(stops));
            setPicked(r.index);
            onChange(r.paint, false);
          }}
        >
          <Plus size={14} />
        </ToolButton>
      </div>
      <div className="flex flex-col gap-1 px-2 pb-3">
        {stops.map((s, i) => (
          <div
            key={i}
            className={`-mx-1 flex items-center gap-1 rounded-sm px-1 py-0.5 ${i === selected ? 'bg-foreground/[0.06]' : ''}`}
            onPointerDown={() => setPicked(i)}
          >
            <div className="w-11 shrink-0">
              <NumberField
                label=""
                value={s.position}
                scale={100}
                min={0}
                onCommit={(v) => {
                  const r = moveStop(paint, i, v);
                  setPicked(r.index);
                  onChange(r.paint, false);
                }}
              />
            </div>
            <div className={`${FIELD} flex-1`}>
              <button
                type="button"
                aria-label={`选中色标 ${Math.round(s.position * 100)}%`}
                className="size-4 shrink-0 rounded-sm border border-foreground/10"
                style={{
                  background: swatchBackground(s.color),
                }}
                onClick={() => setPicked(i)}
              />
              <HexInput
                color={s.color}
                onCommit={(c) =>
                  onChange(
                    setStopColor(paint, i, { ...c, a: s.color.a ?? 1 }),
                    false,
                  )
                }
              />
            </div>
            <div className="w-11 shrink-0">
              <NumberField
                label=""
                value={s.color.a ?? 1}
                scale={100}
                min={0}
                onCommit={(a) =>
                  onChange(
                    setStopColor(paint, i, { ...s.color, a: Math.min(1, a) }),
                    false,
                  )
                }
              />
            </div>
            <ToolButton
              label="删除色标"
              disabled={stops.length <= MIN_STOPS}
              onClick={() => remove(i)}
            >
              <Minus size={14} />
            </ToolButton>
          </div>
        ))}
      </div>
    </>
  );
}
