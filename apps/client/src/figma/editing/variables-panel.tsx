import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { type Editor, useEditor, useMaybeEditor, useValue } from '../../engine';
import { rgba } from '../geometry';
import type { FigmaShape } from '../shape-types';
import type {
  FigmaVariable,
  FigmaVariableCollection,
  FigmaVariableModes,
  FigmaVariableValue,
} from '../types';
import {
  detachSlot,
  type FigmaVariableSet,
  isAlias,
  isVariableColor,
  modeFor,
  resolveVariable,
  variableSlots,
} from '../variables';
import {
  ColorField,
  FIELD,
  isMergingSteps,
  NumberField,
  Section,
  SelectField,
  TextField,
  toHex,
} from './panel-fields';
import {
  inheritedShapeModes,
  readVariableSet,
  setShapeMode,
  setVariableValue,
  shapeModes,
} from './variables';

// See apps/docs/figma-to-tldraw/tech.md §21.6.

function useVariableSet(editor: Editor): FigmaVariableSet | undefined {
  return useValue('figma variables', () => readVariableSet(editor), [editor]);
}

const TYPE_LABEL: Record<string, string> = {
  COLOR: '颜色',
  FLOAT: '数字',
  STRING: '文字',
  BOOLEAN: '开关',
};

function modeName(collection: FigmaVariableCollection, id: string | undefined) {
  return collection.modes.find((m) => m.modeId === id)?.name ?? '';
}

function Swatch({
  color,
}: {
  color: { r: number; g: number; b: number; a?: number };
}) {
  return (
    <span
      className="inline-block size-3 shrink-0 rounded-[3px] border border-black/15"
      style={{ background: rgba({ ...color, a: color.a ?? 1 }) }}
    />
  );
}

function ValuePreview({ value }: { value: FigmaVariableValue | undefined }) {
  if (value === undefined) {
    return <span className="text-black/35">—</span>;
  }
  if (isVariableColor(value)) {
    const a = value.a ?? 1;
    return (
      <span className="flex items-center gap-1">
        <Swatch color={value} />
        <span className="uppercase">{toHex({ ...value, a }).slice(1)}</span>
        {a < 1 && <span className="text-black/45">{Math.round(a * 100)}%</span>}
      </span>
    );
  }
  if (typeof value === 'boolean') {
    return <span>{value ? '开' : '关'}</span>;
  }
  return <span className="truncate">{String(value)}</span>;
}

function variableLabel(set: FigmaVariableSet, id: string): string {
  const v = set.variables[id];
  if (!v) {
    return '读不到的变量';
  }
  const c = set.collections[v.variableCollectionId];
  return c ? `${c.name} / ${v.name}` : v.name;
}

/** Which mode each collection uses on this layer; "自动" follows the parent. */
export function VariableModesSection({ shape }: { shape: FigmaShape }) {
  const editor = useEditor();
  const set = useVariableSet(editor);
  const inherited = useValue(
    'figma inherited modes',
    () => {
      const s = editor.getShape<FigmaShape>(shape.id);
      return s ? inheritedShapeModes(editor, s) : {};
    },
    [editor, shape.id],
  );
  if (!set || shape.type !== 'figma-frame') {
    return null;
  }
  const collections = Object.values(set.collections).filter(
    (c) => c.modes.length > 1,
  );
  if (!collections.length) {
    return null;
  }
  const own = shape.props.node.explicitVariableModes ?? {};
  return (
    <Section title="变量模式">
      {collections.map((c) => (
        <SelectField
          key={c.id}
          label={c.name}
          value={own[c.id] ?? 'auto'}
          options={[
            ['auto', `自动（${modeName(c, modeFor(set, c.id, inherited))}）`],
            ...c.modes.map((m): [string, string] => [m.modeId, m.name]),
          ]}
          onChange={(v) => {
            const s = editor.getShape<FigmaShape>(shape.id);
            if (s) {
              editor.markHistoryStoppingPoint('variable mode');
              setShapeMode(editor, s, c.id, v === 'auto' ? null : v);
            }
          }}
        />
      ))}
    </Section>
  );
}

/** The layer's bound fields: which variable, its value here, and a detach button. */
export function BoundVariablesSection({ shape }: { shape: FigmaShape }) {
  const editor = useEditor();
  const set = useVariableSet(editor);
  const [open, setOpen] = useState(false);
  const modes = useValue(
    'figma shape modes',
    () => {
      const s = editor.getShape<FigmaShape>(shape.id);
      return s ? shapeModes(editor, s) : {};
    },
    [editor, shape.id],
  );
  const slots = variableSlots(shape.props.node);
  if (!slots.length) {
    return null;
  }
  return (
    <Section
      title="变量"
      action={
        set && (
          <button
            type="button"
            className="rounded px-1 text-black/55 hover:bg-black/5 hover:text-black"
            onClick={() => setOpen(true)}
          >
            变量表
          </button>
        )
      }
    >
      {slots.map((slot) => (
        <div
          key={slot.binding.join('/')}
          className="grid grid-cols-[4.5rem_1fr_auto] items-center gap-1.5"
        >
          <span className="truncate text-black/45">{slot.label}</span>
          <div
            className={FIELD}
            title={set ? variableLabel(set, slot.alias.id) : slot.alias.id}
          >
            <span className="min-w-0 flex-1 truncate">
              {set?.variables[slot.alias.id]?.name ?? '读不到的变量'}
            </span>
            {set && (
              <ValuePreview
                value={resolveVariable(set, slot.alias.id, modes)}
              />
            )}
          </div>
          <button
            type="button"
            title="解绑：保留现在的值，不再跟着变量变"
            className="rounded px-1 text-black/45 hover:bg-black/5 hover:text-black"
            onClick={() => {
              const s = editor.getShape<FigmaShape>(shape.id);
              if (s) {
                editor.markHistoryStoppingPoint('detach variable');
                editor.updateShape<FigmaShape>({
                  id: s.id,
                  type: s.type,
                  props: { node: detachSlot(s.props.node, slot) },
                });
              }
            }}
          >
            解绑
          </button>
        </div>
      ))}
      {open && <VariablesDialog onClose={() => setOpen(false)} />}
    </Section>
  );
}

/** The button above the layer tree that opens the variable table. */
export function VariablesButton({ editor }: { editor: Editor }) {
  const set = useVariableSet(editor);
  const [open, setOpen] = useState(false);
  if (!set) {
    return null;
  }
  return (
    <>
      <button
        type="button"
        className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        onClick={() => setOpen(true)}
      >
        变量
      </button>
      {open && (
        <VariablesDialog editor={editor} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function ValueCell({
  editor,
  set,
  variable,
  modeId,
}: {
  editor: Editor;
  set: FigmaVariableSet;
  variable: FigmaVariable;
  modeId: string;
}) {
  const raw = variable.valuesByMode[modeId];
  const modes: FigmaVariableModes = { [variable.variableCollectionId]: modeId };
  const write = (value: FigmaVariableValue, merge = false) => {
    if (!merge && !isMergingSteps()) {
      editor.markHistoryStoppingPoint('variable value');
    }
    setVariableValue(editor, variable.id, modeId, value);
  };
  if (isAlias(raw)) {
    return (
      <button
        type="button"
        disabled={variable.remote}
        title={variable.remote ? '库变量只读' : '点一下改成具体的值'}
        className={`${FIELD} w-full text-left`}
        onClick={() => {
          const value = resolveVariable(set, raw.id, modes);
          if (value !== undefined) {
            write(value);
          }
        }}
      >
        <span className="shrink-0 text-black/45">→</span>
        <span className="min-w-0 flex-1 truncate">
          {variableLabel(set, raw.id)}
        </span>
        <ValuePreview value={resolveVariable(set, raw.id, modes)} />
      </button>
    );
  }
  if (variable.remote) {
    return (
      <div className={`${FIELD} opacity-60`} title="库变量只读">
        <ValuePreview value={raw} />
      </div>
    );
  }
  switch (variable.resolvedType) {
    case 'COLOR':
      return isVariableColor(raw) ? (
        <ColorField
          color={{ ...raw, a: raw.a ?? 1 }}
          onMark={() => editor.markHistoryStoppingPoint('variable value')}
          onChange={(c, merge) => write({ ...c, a: raw.a ?? 1 }, merge)}
        />
      ) : (
        <ValuePreview value={raw} />
      );
    case 'FLOAT':
      return (
        <NumberField
          label=""
          value={typeof raw === 'number' ? raw : undefined}
          onCommit={(v) => write(v)}
        />
      );
    case 'BOOLEAN':
      return (
        <label className={FIELD}>
          <input
            type="checkbox"
            checked={raw === true}
            onChange={(e) => write(e.currentTarget.checked)}
          />
          <span>{raw === true ? '开' : '关'}</span>
        </label>
      );
    case 'STRING':
      return (
        <TextField
          raw
          value={typeof raw === 'string' ? raw : ''}
          onCommit={(text) => write(text)}
        />
      );
    default:
      return <ValuePreview value={raw} />;
  }
}

/** Every collection, its variables and their value in each mode; edits are undoable. */
export function VariablesDialog({
  editor: given,
  onClose,
}: {
  editor?: Editor;
  onClose: () => void;
}) {
  const fromContext = useMaybeEditor();
  const editor = (given ?? fromContext)!;
  const set = useVariableSet(editor);
  const collections = set ? Object.values(set.collections) : [];
  const [picked, setPicked] = useState<string | undefined>(collections[0]?.id);
  const root = useRef<HTMLDivElement>(null);
  const ready = !!set;
  // See apps/docs/figma-to-tldraw/tech.md §21.6.
  useEffect(() => {
    if (ready) {
      root.current?.focus();
    }
  }, [ready]);
  if (!set) {
    return null;
  }
  const collection = set.collections[picked ?? ''] ?? collections[0];
  const variables = collection
    ? Object.values(set.variables).filter(
        (v) => v.variableCollectionId === collection.id,
      )
    : [];
  return createPortal(
    <div
      ref={root}
      role="dialog"
      aria-modal="true"
      tabIndex={-1}
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/30 outline-none"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') {
          onClose();
        }
      }}
    >
      <div className="figma-panel flex max-h-[80vh] w-[min(880px,calc(100vw-32px))] flex-col overflow-hidden rounded-lg bg-white text-[11px] text-[#1d1d1d] shadow-xl">
        <div className="flex items-center justify-between border-b border-black/10 px-3 py-2">
          <span className="font-semibold">变量</span>
          <button
            type="button"
            className="rounded px-1.5 text-black/55 hover:bg-black/5 hover:text-black"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
        <div className="flex min-h-0 flex-1">
          <ul className="w-44 shrink-0 overflow-y-auto border-r border-black/10 py-1">
            {collections.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`flex w-full items-center justify-between gap-1 px-3 py-1 text-left ${c.id === collection?.id ? 'bg-black/[0.06] font-semibold' : 'hover:bg-black/[0.03]'}`}
                  onClick={() => setPicked(c.id)}
                >
                  <span className="truncate">{c.name}</span>
                  {c.remote && (
                    <span className="shrink-0 text-black/40">库</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
          {collection && (
            <div className="min-w-0 flex-1 overflow-auto">
              <table className="w-full min-w-max table-fixed border-separate border-spacing-0">
                <thead className="sticky top-0 bg-white">
                  <tr>
                    <th className="w-40 border-b border-black/10 px-3 py-1.5 text-left font-medium text-black/55">
                      名字
                    </th>
                    {collection.modes.map((m) => (
                      <th
                        key={m.modeId}
                        className="w-56 border-b border-black/10 px-1.5 py-1.5 text-left font-medium text-black/55"
                      >
                        {m.name}
                        {m.modeId === collection.defaultModeId && (
                          <span className="ml-1 text-black/35">默认</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {variables.map((v) => (
                    <tr key={v.id}>
                      <td
                        className="border-b border-black/5 px-3 py-1"
                        title={v.id}
                      >
                        <div className="truncate">{v.name}</div>
                        <div className="text-black/40">
                          {TYPE_LABEL[v.resolvedType] ?? v.resolvedType}
                          {v.remote ? ' · 库变量，只读' : ''}
                        </div>
                      </td>
                      {collection.modes.map((m) => (
                        <td
                          key={m.modeId}
                          className="border-b border-black/5 px-1.5 py-1"
                        >
                          <ValueCell
                            editor={editor}
                            set={set}
                            variable={v}
                            modeId={m.modeId}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
