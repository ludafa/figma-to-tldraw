import { type ReactNode, useState } from 'react';

import {
  DefaultStylePanel,
  type Editor,
  type TLShapePartial,
  type TLUiStylePanelProps,
  useEditor,
  useValue,
} from '../../engine';
import { isFigmaShape, type FigmaShape } from '../shape-types';
import type {
  FigmaColor,
  FigmaEffect,
  FigmaLayoutConstraint,
  FigmaLayoutSizing,
  FigmaNode,
  FigmaPaint,
  FigmaTypeStyle,
} from '../types';
import { type Axis, axisSizing, inFlow, isAutoLayout } from './auto-layout';
import {
  figmaComponentHooks,
  isFigmaEditing,
  isGroup,
  resizedNode,
  setSizing,
} from './engine';
import { figmaParent } from './host';
import {
  canBecomeComponent,
  componentSetOf,
  createComponents,
  createInstance,
  detachInstance,
  goToMain,
  instanceChain,
  instancesOf,
  mainOf,
  propertyDefinitions,
  resetInstance,
  setProperty,
  shapeByNodeId,
} from './instances';
import {
  setFills,
  setLayoutMode,
  setLineHeight,
  setRadius,
  setStrokeWeight,
  setTextStyle,
} from './panel-ops';

// See apps/docs/figma-to-tldraw/tech.md §13.4.

const MIXED = Symbol('mixed');
type Shown<T> = T | typeof MIXED | undefined;

function same<T>(values: (T | typeof MIXED)[]): Shown<T> {
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

function round(v: number): number {
  return Math.round(v * 100) / 100;
}

function toHex(c: FigmaColor | undefined): string {
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

function fromHex(hex: string, a: number): FigmaColor | undefined {
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

interface Item {
  shape: FigmaShape;
  parent: FigmaShape | undefined;
}

type NodeFn = (node: FigmaNode, shape: FigmaShape) => FigmaNode;

/** Every call is one undo step, except `merge` calls (a color drag). */
function actions(editor: Editor, items: Item[]) {
  const current = () =>
    items.flatMap(({ shape }) => {
      const s = editor.getShape<FigmaShape>(shape.id);
      return s ? [s] : [];
    });
  return {
    nodes(fn: NodeFn, merge = false) {
      if (!merge) {
        editor.markHistoryStoppingPoint('figma panel');
      }
      const updates = current().flatMap((s) => {
        const node = fn(s.props.node, s);
        return node === s.props.node
          ? []
          : [{ id: s.id, type: s.type, props: { node } }];
      });
      if (updates.length) {
        editor.updateShapes(updates);
      }
    },
    shapes(fn: (s: FigmaShape) => TLShapePartial<FigmaShape>) {
      editor.markHistoryStoppingPoint('figma panel');
      editor.updateShapes(current().map(fn));
    },
    mark() {
      editor.markHistoryStoppingPoint('figma panel');
    },
  };
}
type Actions = ReturnType<typeof actions>;

const FIELD =
  'flex h-6 min-w-0 items-center gap-1 rounded-sm bg-black/[0.04] px-1.5 focus-within:ring-1 focus-within:ring-[var(--color-selected,#2f80ed)]';

function Section({
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

function Row({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-1.5">{children}</div>;
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className="flex size-5 shrink-0 items-center justify-center rounded-sm text-black/60 hover:bg-black/[0.06]"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function TextField({
  label,
  value,
  placeholder,
  disabled,
  onCommit,
  onStep,
}: {
  label?: ReactNode;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onCommit: (text: string) => void;
  onStep?: (delta: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (text: string) => {
    setDraft(null);
    if (text.trim() !== '' && text !== value) {
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

function NumberField({
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

function SelectField<T extends string | number>({
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

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: Shown<T>;
  options: [T, string][];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex h-6 rounded-sm bg-black/[0.04] p-0.5">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          className={`flex-1 rounded-[3px] ${v === value ? 'bg-white shadow-sm' : 'text-black/55 hover:text-black'}`}
          onClick={() => onChange(v)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function ColorField({
  color,
  act,
  onChange,
}: {
  color: FigmaColor | undefined;
  act: Actions;
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
        onPointerDown={act.mark}
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

const PAINT_LABEL: Record<FigmaPaint['type'], string> = {
  SOLID: '纯色',
  GRADIENT_LINEAR: '线性渐变',
  GRADIENT_RADIAL: '径向渐变',
  GRADIENT_ANGULAR: '角度渐变',
  GRADIENT_DIAMOND: '菱形渐变',
  IMAGE: '图片',
  EMOJI: '表情',
  VIDEO: '视频',
};

function Eye({ on }: { on: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path
        d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z"
        stroke="currentColor"
      />
      {on ? (
        <circle cx="8" cy="8" r="2" fill="currentColor" />
      ) : (
        <path d="M3 13 13 3" stroke="currentColor" />
      )}
    </svg>
  );
}

function PaintList({
  paints,
  act,
  readOnly,
  onChange,
}: {
  paints: FigmaPaint[];
  act: Actions;
  readOnly?: boolean;
  onChange: (paints: FigmaPaint[], merge: boolean) => void;
}) {
  const patch = (i: number, p: Partial<FigmaPaint>, merge = false) =>
    onChange(
      paints.map((q, j) => (j === i ? { ...q, ...p } : q)),
      merge,
    );
  return (
    <>
      {paints
        .map((p, i) => [p, i] as const)
        .reverse()
        .map(([p, i]) => (
          <div
            key={i}
            className={`flex items-center gap-1 ${p.visible === false ? 'opacity-45' : ''} ${readOnly ? 'pointer-events-none' : ''}`}
          >
            <IconButton
              label={p.visible === false ? '显示' : '隐藏'}
              onClick={() => patch(i, { visible: p.visible === false })}
            >
              <Eye on={p.visible !== false} />
            </IconButton>
            <div className="min-w-0 flex-1">
              {p.type === 'SOLID' ? (
                <ColorField
                  color={p.color}
                  act={act}
                  onChange={(color, merge) => patch(i, { color }, merge)}
                />
              ) : (
                <div className={`${FIELD} text-black/60`}>
                  {PAINT_LABEL[p.type]}
                </div>
              )}
            </div>
            <div className="w-14 shrink-0">
              <NumberField
                label=""
                value={p.opacity ?? 1}
                scale={100}
                min={0}
                onCommit={(v) => patch(i, { opacity: Math.min(1, v) })}
              />
            </div>
            <IconButton
              label="删除"
              onClick={() =>
                onChange(
                  paints.filter((_, j) => j !== i),
                  false,
                )
              }
            >
              −
            </IconButton>
          </div>
        ))}
    </>
  );
}

function solid(r: number, g: number, b: number): FigmaPaint {
  return {
    type: 'SOLID',
    visible: true,
    opacity: 1,
    blendMode: 'NORMAL',
    color: { r, g, b, a: 1 },
  };
}

function textPaints(node: FigmaNode): FigmaPaint[] {
  return node.style?.fills ?? node.fills ?? [];
}

function PositionSection({ items, act }: { items: Item[]; act: Actions }) {
  const editor = useEditor();
  const flowing = items.some(
    ({ shape, parent }) =>
      !!parent && isAutoLayout(parent.props.node) && inFlow(shape.props.node),
  );
  const groups = items.some(({ shape }) => isGroup(shape));
  const pick = (fn: (s: FigmaShape) => number) =>
    same(items.map(({ shape }) => round(fn(shape))));
  const degrees = (s: FigmaShape) => {
    const d = (-s.rotation * 180) / Math.PI;
    return ((((d + 180) % 360) + 360) % 360) - 180;
  };
  const resize = (axis: Axis, v: number) =>
    act.shapes((s) => ({
      id: s.id,
      type: s.type,
      props: {
        [axis === 'x' ? 'w' : 'h']: Math.max(0.01, v),
        node: resizedNode(editor, s, axis === 'x', axis === 'y'),
      },
    }));
  return (
    <Section title="位置和尺寸">
      <Row>
        <NumberField
          label="X"
          value={pick((s) => s.x)}
          disabled={flowing}
          onCommit={(x) => act.shapes((s) => ({ id: s.id, type: s.type, x }))}
        />
        <NumberField
          label="Y"
          value={pick((s) => s.y)}
          disabled={flowing}
          onCommit={(y) => act.shapes((s) => ({ id: s.id, type: s.type, y }))}
        />
        <NumberField
          label="W"
          value={pick((s) => s.props.w)}
          disabled={groups}
          onCommit={(v) => resize('x', v)}
        />
        <NumberField
          label="H"
          value={pick((s) => s.props.h)}
          disabled={groups}
          onCommit={(v) => resize('y', v)}
        />
        <NumberField
          label="旋转"
          value={pick(degrees)}
          onCommit={(deg) => {
            act.mark();
            for (const { shape } of items) {
              const s = editor.getShape<FigmaShape>(shape.id);
              if (s) {
                editor.rotateShapesBy(
                  [s.id],
                  ((degrees(s) - deg) * Math.PI) / 180,
                );
              }
            }
          }}
        />
      </Row>
    </Section>
  );
}

const SIZING_LABEL: Record<FigmaLayoutSizing, string> = {
  FIXED: '固定',
  HUG: '包裹',
  FILL: '填充',
};

function SizingSection({ items, act }: { items: Item[]; act: Actions }) {
  const editor = useEditor();
  const canHug = items.every(
    ({ shape }) =>
      isAutoLayout(shape.props.node) || shape.props.node.type === 'TEXT',
  );
  const canFill = items.every(
    ({ shape, parent }) =>
      !!parent && isAutoLayout(parent.props.node) && inFlow(shape.props.node),
  );
  if (!canHug && !canFill) {
    return null;
  }
  const options = (
    [
      'FIXED',
      ...(canHug ? (['HUG'] as const) : []),
      ...(canFill ? (['FILL'] as const) : []),
    ] as FigmaLayoutSizing[]
  ).map((v) => [v, SIZING_LABEL[v]] as [FigmaLayoutSizing, string]);
  const field = (axis: Axis, label: string) => (
    <SelectField
      label={label}
      value={same(
        items.map(({ shape, parent }) =>
          axisSizing(shape.props.node, axis, parent?.props.node),
        ),
      )}
      options={options}
      onChange={(v) =>
        act.nodes((n, s) =>
          setSizing(n, axis, v, figmaParent(editor, s)?.props.node),
        )
      }
    />
  );
  return (
    <Section title="尺寸方式">
      <Row>
        {field('x', '宽')}
        {field('y', '高')}
      </Row>
    </Section>
  );
}

const ALIGN = ['MIN', 'CENTER', 'MAX'] as const;

function AutoLayoutSection({ items, act }: { items: Item[]; act: Actions }) {
  const nodes = items.map(({ shape }) => shape.props.node);
  if (nodes.some((n) => n.layoutWrap === 'WRAP' || n.layoutMode === 'GRID')) {
    return (
      <Section title="自动布局">
        <div className="text-black/50">换行和网格布局暂不支持编辑</div>
      </Section>
    );
  }
  const mode = same(
    nodes.map((n) =>
      isAutoLayout(n) ? (n.layoutMode as 'HORIZONTAL' | 'VERTICAL') : 'NONE',
    ),
  );
  const num = (fn: (n: FigmaNode) => number | undefined) =>
    same(nodes.map((n) => fn(n) ?? 0));
  const set = (patch: Partial<FigmaNode>) =>
    act.nodes((n) => ({ ...n, ...patch }));
  const primary = same(nodes.map((n) => n.primaryAxisAlignItems ?? 'MIN'));
  const counter = same(
    nodes.map((n) =>
      n.counterAxisAlignItems === 'BASELINE'
        ? 'MIN'
        : (n.counterAxisAlignItems ?? 'MIN'),
    ),
  );
  const between = primary === 'SPACE_BETWEEN';
  return (
    <Section title="自动布局">
      <Segmented
        value={mode}
        options={[
          ['NONE', '无'],
          ['HORIZONTAL', '横向 →'],
          ['VERTICAL', '纵向 ↓'],
        ]}
        onChange={(m) => act.nodes((n) => setLayoutMode(n, m))}
      />
      {mode !== 'NONE' && mode !== MIXED && (
        <>
          <div className="flex gap-2">
            <div className="grid grid-cols-3 gap-0.5 rounded-sm bg-black/[0.04] p-1">
              {ALIGN.flatMap((row) =>
                ALIGN.map((col) => {
                  const p = mode === 'HORIZONTAL' ? col : row;
                  const c = mode === 'HORIZONTAL' ? row : col;
                  const on = c === counter && (between || p === primary);
                  return (
                    <button
                      key={`${row}${col}`}
                      type="button"
                      title={`对齐：${p} / ${c}`}
                      className="flex size-4 items-center justify-center"
                      onClick={() =>
                        set({
                          counterAxisAlignItems: c,
                          ...(!between && { primaryAxisAlignItems: p }),
                        })
                      }
                    >
                      <span
                        className={`rounded-full ${on ? 'size-2 bg-[var(--color-selected,#2f80ed)]' : 'size-1 bg-black/30'}`}
                      />
                    </button>
                  );
                }),
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <NumberField
                label="间距"
                value={num((n) => n.itemSpacing)}
                disabled={between}
                onCommit={(itemSpacing) => set({ itemSpacing })}
              />
              <label className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={between}
                  onChange={(e) =>
                    set({
                      primaryAxisAlignItems: e.currentTarget.checked
                        ? 'SPACE_BETWEEN'
                        : 'MIN',
                    })
                  }
                />
                两端对齐
              </label>
            </div>
          </div>
          <div className="grid grid-cols-4 gap-1.5">
            <NumberField
              label="左"
              value={num((n) => n.paddingLeft)}
              onCommit={(paddingLeft) => set({ paddingLeft })}
            />
            <NumberField
              label="上"
              value={num((n) => n.paddingTop)}
              onCommit={(paddingTop) => set({ paddingTop })}
            />
            <NumberField
              label="右"
              value={num((n) => n.paddingRight)}
              onCommit={(paddingRight) => set({ paddingRight })}
            />
            <NumberField
              label="下"
              value={num((n) => n.paddingBottom)}
              onCommit={(paddingBottom) => set({ paddingBottom })}
            />
          </div>
        </>
      )}
    </Section>
  );
}

function ConstraintSection({ items, act }: { items: Item[]; act: Actions }) {
  const applies = items.every(
    ({ shape, parent }) =>
      !!parent &&
      !isGroup(parent) &&
      (!isAutoLayout(parent.props.node) || !inFlow(shape.props.node)),
  );
  if (!applies) {
    return null;
  }
  const set = (patch: Partial<FigmaLayoutConstraint>) =>
    act.nodes((n) => ({
      ...n,
      constraints: {
        horizontal: n.constraints?.horizontal ?? 'LEFT',
        vertical: n.constraints?.vertical ?? 'TOP',
        ...patch,
      },
    }));
  return (
    <Section title="约束">
      <Row>
        <SelectField
          label="横"
          value={same(
            items.map(
              ({ shape }) => shape.props.node.constraints?.horizontal ?? 'LEFT',
            ),
          )}
          options={[
            ['LEFT', '左'],
            ['RIGHT', '右'],
            ['LEFT_RIGHT', '左右'],
            ['CENTER', '居中'],
            ['SCALE', '缩放'],
          ]}
          onChange={(horizontal) => set({ horizontal })}
        />
        <SelectField
          label="纵"
          value={same(
            items.map(
              ({ shape }) => shape.props.node.constraints?.vertical ?? 'TOP',
            ),
          )}
          options={[
            ['TOP', '上'],
            ['BOTTOM', '下'],
            ['TOP_BOTTOM', '上下'],
            ['CENTER', '居中'],
            ['SCALE', '缩放'],
          ]}
          onChange={(vertical) => set({ vertical })}
        />
      </Row>
    </Section>
  );
}

function AppearanceSection({ items, act }: { items: Item[]; act: Actions }) {
  const shapes = items.map((i) => i.shape);
  const vector = shapes.some((s) => s.type === 'figma-vector');
  const rounded = shapes.every(
    (s) =>
      (s.type === 'figma-rect' && s.props.node.type !== 'ELLIPSE') ||
      (s.type === 'figma-frame' && !isGroup(s)),
  );
  const frames = shapes.every((s) => s.type === 'figma-frame' && !isGroup(s));
  const radius = same(
    shapes.map((s) => {
      const n = s.props.node;
      const r = n.rectangleCornerRadii;
      return r && r.some((v) => v !== r[0])
        ? MIXED
        : (r?.[0] ?? n.cornerRadius ?? 0);
    }),
  );
  return (
    <Section title="外观">
      <Row>
        <NumberField
          label="透明"
          value={same(shapes.map((s) => s.props.node.opacity ?? 1))}
          scale={100}
          min={0}
          disabled={vector}
          onCommit={(v) => {
            const opacity = Math.min(1, v);
            act.shapes((s) => ({
              id: s.id,
              type: s.type,
              opacity,
              props: { node: { ...s.props.node, opacity } },
            }));
          }}
        />
        {rounded && (
          <NumberField
            label="圆角"
            value={radius}
            min={0}
            onCommit={(v) => act.nodes((n) => setRadius(n, v))}
          />
        )}
      </Row>
      {frames && (
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={shapes.every((s) => s.props.node.clipsContent)}
            onChange={(e) => {
              const clipsContent = e.currentTarget.checked;
              act.nodes((n) => ({ ...n, clipsContent }));
            }}
          />
          裁剪内容
        </label>
      )}
    </Section>
  );
}

function FillSection({ items, act }: { items: Item[]; act: Actions }) {
  const nodes = items.map((i) => i.shape.props.node);
  const vector = items.some((i) => i.shape.type === 'figma-vector');
  const paints = same(
    nodes.map((n) => (n.type === 'TEXT' ? textPaints(n) : (n.fills ?? []))),
  );
  const change = (next: FigmaPaint[], merge: boolean) =>
    act.nodes((n) => setFills(n, next), merge);
  const fallback =
    nodes[0]?.type === 'TEXT'
      ? solid(0, 0, 0)
      : nodes[0]?.type === 'FRAME'
        ? solid(1, 1, 1)
        : solid(0.85, 0.85, 0.85);
  return (
    <Section
      title="填充"
      action={
        !vector && (
          <IconButton
            label="添加填充"
            onClick={() =>
              change(
                [...(Array.isArray(paints) ? paints : []), fallback],
                false,
              )
            }
          >
            +
          </IconButton>
        )
      }
    >
      {paints === MIXED ? (
        <div className="text-black/50">混合</div>
      ) : (
        <PaintList
          paints={paints ?? []}
          act={act}
          readOnly={vector}
          onChange={change}
        />
      )}
      {vector && (
        <div className="text-black/50">
          矢量的颜色写在 SVG 里，下一步再支持修改
        </div>
      )}
    </Section>
  );
}

function StrokeSection({ items, act }: { items: Item[]; act: Actions }) {
  const nodes = items.map((i) => i.shape.props.node);
  const vector = items.some((i) => i.shape.type === 'figma-vector');
  const paints = same(nodes.map((n) => n.strokes ?? []));
  const change = (strokes: FigmaPaint[], merge: boolean) =>
    act.nodes((n) => ({ ...n, strokes }), merge);
  const has = Array.isArray(paints) && paints.length > 0;
  return (
    <Section
      title="描边"
      action={
        !vector && (
          <IconButton
            label="添加描边"
            onClick={() =>
              act.nodes((n) => ({
                ...n,
                strokes: [...(n.strokes ?? []), solid(0, 0, 0)],
                strokeWeight: n.strokeWeight || 1,
                strokeAlign: n.strokeAlign ?? 'INSIDE',
              }))
            }
          >
            +
          </IconButton>
        )
      }
    >
      {paints === MIXED ? (
        <div className="text-black/50">混合</div>
      ) : (
        <PaintList
          paints={paints ?? []}
          act={act}
          readOnly={vector}
          onChange={change}
        />
      )}
      {(has || paints === MIXED) && !vector && (
        <Row>
          <NumberField
            label="粗细"
            value={same(
              nodes.map((n) => {
                const w = n.individualStrokeWeights;
                return w && new Set(Object.values(w)).size > 1
                  ? MIXED
                  : (n.strokeWeight ?? 0);
              }),
            )}
            min={0}
            onCommit={(v) => act.nodes((n) => setStrokeWeight(n, v))}
          />
          <SelectField
            value={same(nodes.map((n) => n.strokeAlign ?? 'INSIDE'))}
            options={[
              ['INSIDE', '内'],
              ['CENTER', '居中'],
              ['OUTSIDE', '外'],
            ]}
            onChange={(strokeAlign) =>
              act.nodes((n) => ({ ...n, strokeAlign }))
            }
          />
        </Row>
      )}
    </Section>
  );
}

const EFFECT_LABEL: [FigmaEffect['type'], string][] = [
  ['DROP_SHADOW', '投影'],
  ['INNER_SHADOW', '内阴影'],
  ['LAYER_BLUR', '图层模糊'],
  ['BACKGROUND_BLUR', '背景模糊'],
];

function EffectSection({ items, act }: { items: Item[]; act: Actions }) {
  const effects = same(items.map((i) => i.shape.props.node.effects ?? []));
  const change = (next: FigmaEffect[], merge = false) =>
    act.nodes((n) => ({ ...n, effects: next }), merge);
  const list = Array.isArray(effects) ? effects : [];
  const patch = (i: number, p: Partial<FigmaEffect>, merge = false) =>
    change(
      list.map((e, j) => (j === i ? { ...e, ...p } : e)),
      merge,
    );
  return (
    <Section
      title="效果"
      action={
        <IconButton
          label="添加投影"
          onClick={() =>
            change([
              ...list,
              {
                type: 'DROP_SHADOW',
                visible: true,
                radius: 4,
                spread: 0,
                offset: { x: 0, y: 4 },
                color: { r: 0, g: 0, b: 0, a: 0.25 },
                blendMode: 'NORMAL',
                showShadowBehindNode: false,
              },
            ])
          }
        >
          +
        </IconButton>
      }
    >
      {effects === MIXED && <div className="text-black/50">混合</div>}
      {list.map((e, i) => {
        const shadow = e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW';
        return (
          <div
            key={i}
            className={`flex flex-col gap-1 ${e.visible ? '' : 'opacity-45'}`}
          >
            <div className="flex items-center gap-1">
              <IconButton
                label={e.visible ? '隐藏' : '显示'}
                onClick={() => patch(i, { visible: !e.visible })}
              >
                <Eye on={e.visible} />
              </IconButton>
              <div className="min-w-0 flex-1">
                <SelectField
                  value={e.type}
                  options={EFFECT_LABEL}
                  onChange={(type) => patch(i, { type })}
                />
              </div>
              <IconButton
                label="删除"
                onClick={() => change(list.filter((_, j) => j !== i))}
              >
                −
              </IconButton>
            </div>
            <div className="grid grid-cols-2 gap-1 pl-6">
              {shadow && (
                <>
                  <div className="col-span-2">
                    <ColorField
                      color={e.color}
                      act={act}
                      onChange={(c, merge) =>
                        patch(i, { color: { ...c, a: e.color?.a ?? 1 } }, merge)
                      }
                    />
                  </div>
                  <NumberField
                    label="X"
                    value={e.offset?.x ?? 0}
                    onCommit={(x) =>
                      patch(i, { offset: { x, y: e.offset?.y ?? 0 } })
                    }
                  />
                  <NumberField
                    label="Y"
                    value={e.offset?.y ?? 0}
                    onCommit={(y) =>
                      patch(i, { offset: { x: e.offset?.x ?? 0, y } })
                    }
                  />
                  <NumberField
                    label="扩展"
                    value={e.spread ?? 0}
                    onCommit={(spread) => patch(i, { spread })}
                  />
                  <NumberField
                    label="透明"
                    value={e.color?.a ?? 1}
                    scale={100}
                    min={0}
                    onCommit={(v) =>
                      patch(i, {
                        color: {
                          ...(e.color ?? { r: 0, g: 0, b: 0 }),
                          a: Math.min(1, v),
                        },
                      })
                    }
                  />
                </>
              )}
              <NumberField
                label="模糊"
                value={e.radius}
                min={0}
                onCommit={(radius) => patch(i, { radius })}
              />
            </div>
          </div>
        );
      })}
    </Section>
  );
}

const FONT_FAMILIES = [
  'Inter',
  'Noto Sans SC',
  'DM Sans',
  'Lato',
  'Lexend',
  'Montserrat',
  'Nunito',
  'Poppins',
  'Product Sans',
  'Red Hat Display',
  'Urbanist',
];

const WEIGHTS: [number, string][] = [
  [100, 'Thin'],
  [200, 'Extra Light'],
  [300, 'Light'],
  [400, 'Regular'],
  [500, 'Medium'],
  [600, 'Semi Bold'],
  [700, 'Bold'],
  [800, 'Extra Bold'],
  [900, 'Black'],
];

/** A text property of the whole layer, or MIXED when some characters differ. */
function textValue<K extends keyof FigmaTypeStyle>(
  node: FigmaNode,
  key: K,
): FigmaTypeStyle[K] | typeof MIXED {
  const base = node.style?.[key];
  const used = new Set(node.characterStyleOverrides ?? []);
  for (const id of used) {
    const value = id ? node.styleOverrideTable?.[String(id)]?.[key] : undefined;
    if (value !== undefined && JSON.stringify(value) !== JSON.stringify(base)) {
      return MIXED;
    }
  }
  return base;
}

function TextSection({ items, act }: { items: Item[]; act: Actions }) {
  const nodes = items.map((i) => i.shape.props.node);
  const value = <K extends keyof FigmaTypeStyle>(
    key: K,
    fallback: NonNullable<FigmaTypeStyle[K]>,
  ) =>
    same<NonNullable<FigmaTypeStyle[K]>>(
      nodes.map((n) => textValue(n, key) ?? fallback),
    );
  const set = (patch: Partial<FigmaTypeStyle>) =>
    act.nodes((n) => setTextStyle(n, patch));
  const family = value('fontFamily', 'Inter');
  const families =
    typeof family === 'string' && !FONT_FAMILIES.includes(family)
      ? [family, ...FONT_FAMILIES]
      : FONT_FAMILIES;
  const lineHeight = same(
    nodes.map((n) => {
      const style = n.style ?? {};
      if (textValue(n, 'lineHeightPx') === MIXED) {
        return MIXED;
      }
      return style.lineHeightUnit === 'INTRINSIC_%'
        ? '自动'
        : String(round(style.lineHeightPx ?? (style.fontSize ?? 16) * 1.2));
    }),
  );
  return (
    <Section title="文字">
      <SelectField
        value={family}
        options={families.map((f) => [f, f])}
        onChange={(fontFamily) => set({ fontFamily, fontPostScriptName: null })}
      />
      <Row>
        <SelectField
          value={value('fontWeight', 400)}
          options={WEIGHTS}
          onChange={(fontWeight) => set({ fontWeight })}
        />
        <NumberField
          label="字号"
          value={value('fontSize', 16)}
          min={1}
          onCommit={(fontSize) => set({ fontSize })}
        />
        <TextField
          label="行高"
          value={typeof lineHeight === 'string' ? lineHeight : ''}
          placeholder={lineHeight === MIXED ? '混合' : ''}
          onCommit={(text) => {
            const px = Number(text);
            const auto = text === '自动' || text.toLowerCase() === 'auto';
            if (auto || (Number.isFinite(px) && px > 0)) {
              act.nodes((n) => setLineHeight(n, auto ? 'auto' : px));
            }
          }}
        />
        <NumberField
          label="字距"
          value={value('letterSpacing', 0)}
          onCommit={(letterSpacing) => set({ letterSpacing })}
        />
      </Row>
      <Segmented
        value={value('textAlignHorizontal', 'LEFT')}
        options={[
          ['LEFT', '左'],
          ['CENTER', '中'],
          ['RIGHT', '右'],
          ['JUSTIFIED', '两端'],
        ]}
        onChange={(textAlignHorizontal) => set({ textAlignHorizontal })}
      />
      <Segmented
        value={value('textAlignVertical', 'TOP')}
        options={[
          ['TOP', '顶'],
          ['CENTER', '中'],
          ['BOTTOM', '底'],
        ]}
        onChange={(textAlignVertical) => set({ textAlignVertical })}
      />
      <Row>
        <SelectField
          value={value('textCase', 'ORIGINAL')}
          options={[
            ['ORIGINAL', '原样'],
            ['UPPER', '大写'],
            ['LOWER', '小写'],
            ['TITLE', '首字母大写'],
          ]}
          onChange={(textCase) => set({ textCase })}
        />
        <SelectField
          value={value('textDecoration', 'NONE')}
          options={[
            ['NONE', '无装饰'],
            ['UNDERLINE', '下划线'],
            ['STRIKETHROUGH', '删除线'],
          ]}
          onChange={(textDecoration) => set({ textDecoration })}
        />
      </Row>
    </Section>
  );
}

// See apps/docs/figma-to-tldraw/tech.md §16.5.
const PURPLE = 'text-[#9747ff]';

function propertyName(key: string): string {
  return key.split('#')[0];
}

function ActionButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="h-6 rounded-sm bg-black/[0.04] px-2 hover:bg-black/[0.08]"
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function InstanceSection({ shape }: { shape: FigmaShape }) {
  const editor = useEditor();
  const main = useValue('figma main', () => mainOf(editor, shape), [
    editor,
    shape,
  ]);
  const set = main && componentSetOf(editor, main);
  const node = shape.props.node;
  const nested = instanceChain(editor, shape)[0]?.id !== shape.id;
  const defs = main ? propertyDefinitions(editor, main) : {};
  const props = Object.entries(node.componentProperties ?? {});
  const overrides = (node.overrides ?? []).reduce(
    (n, o) => n + o.overriddenFields.length,
    0,
  );
  const step = (name: string, fn: () => void) => {
    editor.markHistoryStoppingPoint(name);
    editor.run(fn);
  };
  const hooks = figmaComponentHooks(editor);
  const set1 = (key: string, value: string | boolean) =>
    step('component property', () =>
      setProperty(
        editor,
        editor.getShape<FigmaShape>(shape.id)!,
        key,
        value,
        hooks,
      ),
    );
  return (
    <Section title="实例">
      <div className={`truncate font-medium ${PURPLE}`}>
        {main
          ? (set?.props.node.name ?? main.props.node.name)
          : '主组件不在这里（库组件或已删除）'}
      </div>
      {props.map(([key, prop]) => {
        const def = defs[key];
        const label = propertyName(key);
        if (prop.type === 'VARIANT') {
          const options = def?.variantOptions ?? [String(prop.value)];
          return (
            <SelectField
              key={key}
              label={label}
              value={String(prop.value)}
              options={options.map((o) => [o, o])}
              onChange={(v) => set1(key, v)}
            />
          );
        }
        if (prop.type === 'BOOLEAN') {
          return (
            <label key={key} className="flex h-6 items-center gap-2">
              <input
                type="checkbox"
                checked={prop.value === true}
                onChange={(e) => set1(key, e.currentTarget.checked)}
              />
              <span>{label}</span>
            </label>
          );
        }
        if (prop.type === 'TEXT') {
          return (
            <TextField
              key={key}
              label={label}
              value={String(prop.value)}
              onCommit={(text) => set1(key, text)}
            />
          );
        }
        const swapTo =
          prop.type === 'INSTANCE_SWAP'
            ? shapeByNodeId(editor, String(prop.value), shape)
            : undefined;
        return (
          <div key={key} className="flex h-6 items-center gap-1 text-black/60">
            <span className="text-black/45">{label}</span>
            <span className="truncate">
              {swapTo?.props.node.name ?? String(prop.value)}
            </span>
          </div>
        );
      })}
      <div className="text-black/45">
        {overrides ? `覆盖了 ${overrides} 个字段` : '没有覆盖'}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {main && (
          <ActionButton
            label="跳到主组件"
            onClick={() => goToMain(editor, shape)}
          />
        )}
        {main && (
          <ActionButton
            label="重置所有覆盖"
            onClick={() =>
              step('reset instance', () =>
                resetInstance(
                  editor,
                  editor.getShape<FigmaShape>(shape.id)!,
                  hooks,
                ),
              )
            }
          />
        )}
        {!nested && (
          <ActionButton
            label="分离实例"
            onClick={() =>
              step('detach instance', () => detachInstance(editor, shape))
            }
          />
        )}
      </div>
    </Section>
  );
}

function MainSection({ shape }: { shape: FigmaShape }) {
  const editor = useEditor();
  const node = shape.props.node;
  const count = useValue(
    'figma instance count',
    () => (node.type === 'COMPONENT' ? instancesOf(editor, node.id).length : 0),
    [editor, node.id, node.type],
  );
  const defs = Object.entries(
    node.type === 'COMPONENT'
      ? propertyDefinitions(editor, shape)
      : (node.componentPropertyDefinitions ?? {}),
  );
  return (
    <Section title={node.type === 'COMPONENT_SET' ? '组件集' : '组件'}>
      {defs.map(([key, def]) => (
        <div key={key} className="flex h-6 items-center justify-between gap-2">
          <span className="truncate">{propertyName(key)}</span>
          <span className="shrink-0 text-black/45">
            {def.type === 'VARIANT'
              ? `变体 ${def.variantOptions?.length ?? 0} 个`
              : def.type === 'BOOLEAN'
                ? '布尔'
                : def.type === 'TEXT'
                  ? '文字'
                  : '替换实例'}
          </span>
        </div>
      ))}
      {node.type === 'COMPONENT' && (
        <>
          <div className="text-black/45">文件里有 {count} 个实例</div>
          <div>
            <ActionButton
              label="生成实例"
              onClick={() => createInstance(editor, shape)}
            />
          </div>
        </>
      )}
    </Section>
  );
}

function NewComponentSection({ shapes }: { shapes: FigmaShape[] }) {
  const editor = useEditor();
  return (
    <Section title="组件">
      <div>
        <ActionButton
          label="新建组件（⌥⌘K）"
          onClick={() => {
            editor.markHistoryStoppingPoint('create component');
            createComponents(editor, shapes);
          }}
        />
      </div>
    </Section>
  );
}

const TYPE_LABEL: Record<string, string> = {
  FRAME: 'Frame',
  GROUP: '组',
  COMPONENT: '组件',
  COMPONENT_SET: '组件集',
  INSTANCE: '实例',
  SECTION: '分区',
  RECTANGLE: '矩形',
  ELLIPSE: '椭圆',
  TEXT: '文字',
  VECTOR: '矢量',
  BOOLEAN_OPERATION: '布尔运算',
  STAR: '星形',
  LINE: '线',
  REGULAR_POLYGON: '多边形',
};

function FigmaPanel({ items }: { items: Item[] }) {
  const editor = useEditor();
  const act = actions(editor, items);
  const shapes = items.map((i) => i.shape);
  const text = shapes.every((s) => s.type === 'figma-text');
  const frames = shapes.every((s) => s.type === 'figma-frame' && !isGroup(s));
  const groups = shapes.every(isGroup);
  const types = new Set(shapes.map((s) => s.props.node.type));
  return (
    <div className="figma-panel pb-1 text-[11px] text-[var(--color-text-1,#1d1d1d)]">
      <div className="flex items-baseline justify-between gap-2 px-3 py-2">
        <span
          className={`truncate font-semibold ${
            shapes.length === 1 && types.has('INSTANCE') ? PURPLE : ''
          }`}
        >
          {shapes.length === 1
            ? shapes[0].props.node.name
            : `${shapes.length} 个图层`}
        </span>
        <span className="shrink-0 text-black/45">
          {types.size === 1
            ? (TYPE_LABEL[[...types][0]] ?? [...types][0])
            : '混合'}
        </span>
      </div>
      {shapes.length === 1 && shapes[0].props.node.type === 'INSTANCE' && (
        <InstanceSection shape={shapes[0]} />
      )}
      {shapes.length === 1 &&
        (shapes[0].props.node.type === 'COMPONENT' ||
          shapes[0].props.node.type === 'COMPONENT_SET') && (
          <MainSection shape={shapes[0]} />
        )}
      {shapes.every((s) => canBecomeComponent(editor, s)) && (
        <NewComponentSection shapes={shapes} />
      )}
      <PositionSection items={items} act={act} />
      {frames && <AutoLayoutSection items={items} act={act} />}
      <SizingSection items={items} act={act} />
      <ConstraintSection items={items} act={act} />
      <AppearanceSection items={items} act={act} />
      {text && <TextSection items={items} act={act} />}
      {!groups && <FillSection items={items} act={act} />}
      {!groups && !text && <StrokeSection items={items} act={act} />}
      {!shapes.some((s) => s.type === 'figma-vector') && (
        <EffectSection items={items} act={act} />
      )}
    </div>
  );
}

function useFigmaItems(): Item[] | undefined {
  const editor = useEditor();
  return useValue(
    'figma panel items',
    () => {
      const selected = editor.getSelectedShapes();
      if (
        !isFigmaEditing(editor) ||
        !selected.length ||
        !selected.every(isFigmaShape)
      ) {
        return undefined;
      }
      return selected.map((shape) => ({
        shape: shape as FigmaShape,
        parent: figmaParent(editor, shape),
      }));
    },
    [editor],
  );
}

/** tldraw's style panel slot: ours for Figma layers, tldraw's for the rest. */
export function FigmaStylePanel(props: TLUiStylePanelProps) {
  const items = useFigmaItems();
  if (!items) {
    return <DefaultStylePanel {...props} />;
  }
  return (
    <DefaultStylePanel {...props}>
      <FigmaPanel items={items} />
    </DefaultStylePanel>
  );
}

// See apps/docs/figma-to-tldraw/tech.md §19.1.
export function FigmaInspector({ empty }: { empty: ReactNode }) {
  const items = useFigmaItems();
  return items ? <FigmaPanel items={items} /> : empty;
}
