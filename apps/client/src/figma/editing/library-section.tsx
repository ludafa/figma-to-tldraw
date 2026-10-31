import { Check } from 'lucide-react';
import { useState } from 'react';

import { useEditor, useValue } from '../../engine';
import type { FigmaShape } from '../shape-types';
import type { FigmaPaint } from '../types';
import { swatchBackground } from './color-picker';
import { bindColor, colorVariables, type PaintTarget } from './paint-library';
import { FIELD } from './panel-fields';
import { readVariableSet, shapeModes } from './variables';

// See apps/docs/figma-to-tldraw/tech.md §22.6.

export function LibrarySection({
  paint,
  shapeId,
  target,
  onChange,
}: {
  paint: FigmaPaint;
  shapeId: FigmaShape['id'];
  target: PaintTarget;
  onChange: (paint: FigmaPaint, merge: boolean) => void;
}) {
  const editor = useEditor();
  const [query, setQuery] = useState('');
  const set = useValue('figma variables', () => readVariableSet(editor), [
    editor,
  ]);
  const shape = useValue(
    'figma library shape',
    () => {
      const s = editor.getShape<FigmaShape>(shapeId);
      return s && { type: s.props.node.type, modes: shapeModes(editor, s) };
    },
    [editor, shapeId],
  );
  const groups = set
    ? colorVariables(set, shape?.modes ?? {}, {
        query,
        target,
        nodeType: shape?.type ?? '',
      })
    : [];
  const bound = paint.boundVariables?.color?.id;
  const empty = query.trim()
    ? '没有匹配的颜色变量'
    : '这份文档没有能用在这里的颜色变量';

  return (
    <div className="flex flex-col pb-2">
      <div className="p-2">
        <input
          type="search"
          aria-label="搜索颜色变量"
          placeholder="搜索"
          className={`${FIELD} w-full outline-none`}
          value={query}
          onChange={(e) => setQuery(e.currentTarget.value)}
        />
      </div>
      {!groups.length && (
        <div className="px-3 pb-2 text-foreground/50">{empty}</div>
      )}
      {groups.map(({ id, collection, entries }) => (
        <div
          key={id}
          role="group"
          aria-label={collection?.name ?? '读不到的集合'}
        >
          <div className="flex items-center gap-1 px-3 pt-2 pb-1 text-foreground/50">
            <span className="truncate">
              {collection?.name ?? '读不到的集合'}
            </span>
            {collection?.remote && (
              <span className="shrink-0 rounded-sm bg-foreground/10 px-1">
                库
              </span>
            )}
          </div>
          {entries.map(({ variable, color }) => {
            const parts = variable.name.split('/');
            const name = parts.pop();
            const on = bound === variable.id;
            return (
              <button
                key={variable.id}
                type="button"
                aria-pressed={on}
                title={`${collection?.name ?? ''} / ${variable.name}`}
                className={`flex h-7 w-full shrink-0 items-center gap-2 px-3 text-left hover:bg-foreground/[0.06] ${on ? 'bg-foreground/[0.06]' : ''}`}
                onClick={() =>
                  onChange(bindColor(paint, variable.id, color), false)
                }
              >
                <span
                  className="size-4 shrink-0 rounded-sm border border-foreground/10"
                  style={{ background: swatchBackground(color) }}
                />
                <span className="min-w-0 flex-1 truncate">
                  {parts.length > 0 && (
                    <span className="text-foreground/45">
                      {parts.join(' / ')} /{' '}
                    </span>
                  )}
                  {name}
                </span>
                {on && <Check size={12} className="shrink-0" />}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
