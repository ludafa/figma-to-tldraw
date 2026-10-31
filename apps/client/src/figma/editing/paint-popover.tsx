import { Droplet, Image as ImageIcon, RotateCw, X } from 'lucide-react';
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

import type { FigmaShape } from '../shape-types';
import type { FigmaPaint } from '../types';
import { ColorPicker } from './color-picker';
import { GradientSection } from './gradient-section';
import { LibrarySection } from './library-section';
import {
  BLEND_MODES,
  convertPaint,
  FILTERS,
  filterValue,
  type LocalImage,
  paintKind,
  type PaintKind,
  readImageFile,
  rotateImage,
  setScaleMode,
  withFilter,
} from './paint-edit';
import type { PaintTarget } from './paint-library';
import { NumberField, SelectField, ToolButton } from './panel-fields';

// See apps/docs/figma-to-tldraw/tech.md §22.

const WIDTH = 240;
const GAP = 8;
const CHECKER =
  'bg-[repeating-conic-gradient(#e5e5e5_0%_25%,#fff_0%_50%)] bg-size-[16px_16px]';

const BLACK = { r: 0, g: 0, b: 0, a: 1 };

type Size = { width: number; height: number };

export interface PaintPopoverProps {
  /** The panel row the popover belongs to; clicks on it don't close it. */
  anchor: HTMLElement;
  paint: FigmaPaint;
  images: Record<string, string>;
  imageSizes: Record<string, Size>;
  node: { w: number; h: number };
  /** The first selected layer: its type and modes pick the library's variables. */
  shapeId: FigmaShape['id'];
  target: PaintTarget;
  onChange: (paint: FigmaPaint, merge: boolean) => void;
  /** Called before a drag, so the drag is one undo step. */
  onMark: () => void;
  onImage: (image: LocalImage, paint: FigmaPaint) => void;
  onClose: () => void;
}

const KINDS: [PaintKind, string][] = [
  ['SOLID', '纯色'],
  ['GRADIENT', '渐变'],
  ['IMAGE', '图片'],
];

function KindIcon({ kind }: { kind: PaintKind }) {
  if (kind === 'IMAGE') {
    return <ImageIcon size={14} />;
  }
  return (
    <span
      className={`size-3 rounded-[2px] ${kind === 'SOLID' ? 'bg-current' : 'border border-current bg-linear-to-r from-current to-transparent'}`}
    />
  );
}

const SCALE_MODES: [NonNullable<FigmaPaint['scaleMode']>, string][] = [
  ['FILL', '填充'],
  ['FIT', '适应'],
  ['STRETCH', '裁剪'],
  ['TILE', '平铺'],
];

export function PaintPopover(props: PaintPopoverProps) {
  const { anchor, paint, onChange, onClose } = props;
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>();
  const [tab, setTab] = useState<'custom' | 'library'>('custom');
  const lastImage = useRef<FigmaPaint | undefined>(undefined);
  const close = useEffectEvent(onClose);
  const kind = paintKind(paint);

  useEffect(() => {
    if (paint.type === 'IMAGE' && paint.imageRef) {
      lastImage.current = paint;
    }
  }, [paint]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const place = () => {
      const row = anchor.getBoundingClientRect();
      const panel =
        anchor.closest('.tlui-style-panel')?.getBoundingClientRect() ?? row;
      const top = Math.min(row.top, innerHeight - el.offsetHeight - GAP);
      setPos({
        left: Math.max(GAP, panel.left - WIDTH - GAP),
        top: Math.max(GAP, top),
      });
    };
    place();
    el.focus({ preventScroll: true });
    const observer = new ResizeObserver(place);
    observer.observe(el);
    addEventListener('resize', place);
    return () => {
      observer.disconnect();
      removeEventListener('resize', place);
    };
  }, [anchor]);

  useEffect(() => {
    const down = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !anchor.contains(target)) {
        close();
      }
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [anchor]);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={props.target === 'stroke' ? '描边' : '填充'}
      tabIndex={-1}
      className="fixed z-[1100] flex max-h-[calc(100vh-16px)] flex-col overflow-y-auto rounded-lg border border-foreground/10 bg-background text-[11px] text-foreground shadow-lg outline-none"
      style={{
        width: WIDTH,
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        opacity: pos ? undefined : 0,
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
      onBlur={(e) => {
        const el = e.currentTarget;
        queueMicrotask(() => {
          if (el.isConnected && document.activeElement === document.body) {
            el.focus({ preventScroll: true });
          }
        });
      }}
    >
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-foreground/10 pr-1.5 pl-3">
        {(
          [
            ['custom', '自定义'],
            ['library', '库'],
          ] as const
        ).map(([t, text]) => (
          <button
            key={t}
            type="button"
            className={
              tab === t
                ? 'font-medium text-foreground'
                : 'text-foreground/50 hover:text-foreground'
            }
            onClick={() => setTab(t)}
          >
            {text}
          </button>
        ))}
        <span className="flex-1" />
        <ToolButton label="关闭" onClick={onClose}>
          <X size={14} />
        </ToolButton>
      </div>
      {tab === 'library' ? (
        <LibrarySection
          paint={paint}
          shapeId={props.shapeId}
          target={props.target}
          onChange={onChange}
        />
      ) : (
        <>
          <div className="flex items-center gap-0.5 px-2 py-2">
            {KINDS.map(([k, label]) => (
              <ToolButton
                key={k}
                label={label}
                active={kind === k}
                onClick={() =>
                  kind !== k &&
                  onChange(convertPaint(paint, k, lastImage.current), false)
                }
              >
                <KindIcon kind={k} />
              </ToolButton>
            ))}
            <span className="flex-1" />
            <label
              title="混合模式"
              className={`relative flex size-6 items-center justify-center rounded-sm hover:bg-foreground/[0.06] ${(paint.blendMode ?? 'NORMAL') === 'NORMAL' ? 'text-foreground/60' : 'text-[var(--color-selected,#2f80ed)]'}`}
            >
              <Droplet size={14} />
              <select
                aria-label="混合模式"
                className="absolute inset-0 cursor-pointer opacity-0"
                value={paint.blendMode ?? 'NORMAL'}
                onChange={(e) => {
                  const hit = BLEND_MODES.find(
                    ([m]) => m === e.currentTarget.value,
                  );
                  if (hit) {
                    onChange({ ...paint, blendMode: hit[0] }, false);
                  }
                }}
              >
                {BLEND_MODES.map(([m, text]) => (
                  <option key={m} value={m}>
                    {text}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {kind === 'SOLID' && (
            <ColorPicker
              color={paint.color ?? BLACK}
              alpha={paint.opacity ?? 1}
              onMark={props.onMark}
              onChange={(color, opacity, merge) =>
                onChange({ ...paint, color, opacity }, merge)
              }
            />
          )}
          {kind === 'GRADIENT' && (
            <GradientSection
              paint={paint}
              onChange={onChange}
              onMark={props.onMark}
            />
          )}
          {kind === 'IMAGE' && <ImageSection {...props} />}
        </>
      )}
    </div>,
    document.body,
  );
}

function ImageSection({
  paint,
  images,
  imageSizes,
  node,
  onChange,
  onMark,
  onImage,
}: PaintPopoverProps) {
  const file = useRef<HTMLInputElement>(null);
  const [natural, setNatural] = useState<Size>();
  const [error, setError] = useState('');
  const src = paint.imageRef ? images[paint.imageRef] : undefined;
  const size = (paint.imageRef && imageSizes[paint.imageRef]) || natural;
  const mode = paint.scaleMode ?? 'FILL';

  const pick = async (f: File) => {
    try {
      const image = await readImageFile(f);
      setError('');
      onImage(image, {
        ...(mode === 'STRETCH'
          ? setScaleMode(paint, 'FILL', node, size)
          : paint),
        imageRef: image.ref,
      });
    } catch {
      setError('这个文件读不出来，换一张 PNG / JPG 试试');
    }
  };

  return (
    <>
      <div className="flex items-center gap-1 px-2">
        <div className="min-w-0 flex-1">
          <SelectField
            value={mode}
            options={SCALE_MODES}
            onChange={(m) =>
              onChange(setScaleMode(paint, m, node, size), false)
            }
          />
        </div>
        {mode === 'TILE' && (
          <div className="w-16 shrink-0">
            <NumberField
              label=""
              value={paint.scalingFactor ?? 1}
              scale={100}
              min={1}
              onCommit={(v) => onChange({ ...paint, scalingFactor: v }, false)}
            />
          </div>
        )}
        <ToolButton
          label={mode === 'STRETCH' ? '裁剪模式不能旋转' : '旋转 90°'}
          disabled={mode === 'STRETCH'}
          onClick={() => onChange(rotateImage(paint), false)}
        >
          <RotateCw size={14} />
        </ToolButton>
      </div>
      <div className="p-2">
        <button
          type="button"
          title={src ? '换一张图片' : '选择图片'}
          className={`group relative flex aspect-square w-full items-center justify-center overflow-hidden rounded-sm border border-foreground/10 ${CHECKER}`}
          onClick={() => file.current?.click()}
        >
          {src && (
            <img
              src={src}
              alt=""
              className="size-full object-contain"
              style={{ transform: `rotate(${paint.rotation ?? 0}deg)` }}
              onLoad={(e) =>
                setNatural({
                  width: e.currentTarget.naturalWidth,
                  height: e.currentTarget.naturalHeight,
                })
              }
            />
          )}
          <span
            className={`absolute rounded-sm bg-black/70 px-2 py-1 text-white ${src ? 'opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100' : ''}`}
          >
            {src ? '换图片' : '选择图片'}
          </span>
        </button>
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          hidden
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = '';
            if (f) {
              void pick(f);
            }
          }}
        />
        {error && <div className="mt-1 text-red-500">{error}</div>}
      </div>
      <div className="flex flex-col gap-1 px-2 pb-3">
        {FILTERS.map(([key, label]) => (
          <FilterSlider
            key={key}
            label={label}
            value={filterValue(paint, key)}
            onMark={onMark}
            onChange={(v, merge) => onChange(withFilter(paint, key, v), merge)}
          />
        ))}
      </div>
    </>
  );
}

function FilterSlider({
  label,
  value,
  onMark,
  onChange,
}: {
  label: string;
  value: number;
  onMark: () => void;
  onChange: (v: number, merge: boolean) => void;
}) {
  const dragging = useRef(false);
  return (
    <label className="flex h-5 items-center gap-2">
      <span className="w-10 shrink-0 text-foreground/70">{label}</span>
      <input
        type="range"
        min={-1}
        max={1}
        step={0.01}
        value={value}
        className="figma-slider min-w-0 flex-1"
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
        onDoubleClick={() => onChange(0, false)}
      />
      <span className="w-7 shrink-0 text-right text-foreground/50 tabular-nums">
        {Math.round(value * 100)}
      </span>
    </label>
  );
}
