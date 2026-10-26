import {
  ChevronRight,
  Circle,
  Columns3,
  Combine,
  Component,
  Diamond,
  Eye,
  EyeOff,
  Frame,
  Hash,
  Lock,
  LockOpen,
  type LucideIcon,
  Minus,
  MoveUpRight,
  Pencil,
  PenTool,
  Rows3,
  Shapes,
  Square,
  SquareDashed,
  Star,
  Triangle,
  Type,
} from 'lucide-react';
import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  computed,
  type Editor,
  react,
  type TLParentId,
  type TLShape,
  type TLShapeId,
  useValue,
} from 'tldraw';

import { cn } from '@/lib/utils';

import { isFigmaShape } from '../clip';
import type { FigmaShape } from '../shape-types';
import { isAutoLayout } from './auto-layout';
import { isComponentLike } from './instances';

// See apps/docs/figma-to-tldraw/tech.md §14.2.

interface Layer {
  id: TLShapeId;
  name: string;
  icon: string;
  figma: boolean;
  /** Components and instances are purple (§16.4). */
  component: boolean;
  hidden: boolean;
  locked: boolean;
  children: Layer[];
}

const ICONS: Record<string, LucideIcon> = {
  FRAME: Hash,
  HORIZONTAL: Columns3,
  VERTICAL: Rows3,
  GROUP: SquareDashed,
  SECTION: Frame,
  COMPONENT: Component,
  COMPONENT_SET: Component,
  INSTANCE: Diamond,
  RECTANGLE: Square,
  ELLIPSE: Circle,
  TEXT: Type,
  VECTOR: PenTool,
  LINE: Minus,
  STAR: Star,
  REGULAR_POLYGON: Triangle,
  BOOLEAN_OPERATION: Combine,
  draw: Pencil,
  arrow: MoveUpRight,
};

const TLDRAW_NAMES: Record<string, string> = {
  draw: 'Drawing',
  arrow: 'Arrow',
};

function iconKey(shape: TLShape): string {
  if (!isFigmaShape(shape)) {
    return shape.type;
  }
  const { node } = shape.props;
  return node.type === 'FRAME' && isAutoLayout(node)
    ? node.layoutMode!
    : node.type;
}

function layerName(shape: TLShape): string {
  if (isFigmaShape(shape)) {
    return shape.props.node.name || shape.props.node.characters || 'Text';
  }
  const name = shape.meta.name;
  return typeof name === 'string'
    ? name
    : (TLDRAW_NAMES[shape.type] ?? shape.type);
}

/** Children top of the stack first, the way Figma's layers panel lists them. */
function readLayers(editor: Editor, parentId: TLParentId): Layer[] {
  return [...editor.getSortedChildIdsForParent(parentId)]
    .reverse()
    .map((id) => {
      const shape = editor.getShape(id)!;
      return {
        id,
        name: layerName(shape),
        icon: iconKey(shape),
        figma: isFigmaShape(shape),
        component: isComponentLike(shape),
        hidden: isFigmaShape(shape) && shape.props.node.visible === false,
        locked: shape.isLocked,
        children: readLayers(editor, id),
      };
    });
}

interface Row {
  layer: Layer;
  depth: number;
  dimmed: boolean;
  inSelection: boolean;
}

function rename(editor: Editor, id: TLShapeId, name: string) {
  const shape = editor.getShape(id);
  if (!shape || !name.trim() || name === layerName(shape)) {
    return;
  }
  editor.markHistoryStoppingPoint('rename layer');
  editor.run(
    () => {
      if (isFigmaShape(shape)) {
        editor.updateShape<FigmaShape>({
          id,
          type: shape.type,
          props: { node: { ...shape.props.node, name, autoRename: false } },
        });
      } else {
        editor.updateShape({
          id,
          type: shape.type,
          meta: { ...shape.meta, name },
        });
      }
    },
    { ignoreShapeLock: true },
  );
}

function toggleHidden(editor: Editor, id: TLShapeId) {
  const shape = editor.getShape(id);
  if (!isFigmaShape(shape)) {
    return;
  }
  const { visible: _visible, ...node } = shape.props.node;
  editor.markHistoryStoppingPoint('toggle layer visibility');
  editor.run(
    () =>
      editor.updateShape<FigmaShape>({
        id,
        type: shape.type,
        props: {
          node:
            shape.props.node.visible === false
              ? node
              : { ...node, visible: false },
        },
      }),
    { ignoreShapeLock: true },
  );
}

function toggleLocked(editor: Editor, id: TLShapeId) {
  const shape = editor.getShape(id);
  if (!shape) {
    return;
  }
  editor.markHistoryStoppingPoint('toggle layer lock');
  editor.run(
    () =>
      editor.updateShape({ id, type: shape.type, isLocked: !shape.isLocked }),
    { ignoreShapeLock: true },
  );
}

function RowButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/10',
        !active && 'invisible group-hover:visible',
      )}
    >
      {children}
    </button>
  );
}

// See apps/docs/figma-to-tldraw/tech.md §16.3.
function PageTabs({ editor }: { editor: Editor }) {
  const pages = useValue('figma pages', () => editor.getPages(), [editor]);
  const current = useValue(
    'figma current page',
    () => editor.getCurrentPageId(),
    [editor],
  );
  if (pages.length < 2) {
    return null;
  }
  return (
    <div className="flex gap-1 border-b px-2 py-1.5" role="tablist">
      {pages.map((page) => (
        <button
          key={page.id}
          type="button"
          role="tab"
          aria-selected={page.id === current}
          onClick={() => {
            editor.setCurrentPage(page.id);
            editor.focus();
          }}
          className={cn(
            'rounded-md px-2 py-0.5 text-xs hover:bg-muted',
            page.id === current && 'bg-muted font-medium',
          )}
        >
          {page.name}
        </button>
      ))}
    </div>
  );
}

export function LayerTree({ editor }: { editor: Editor }) {
  const tree = useMemo(
    () =>
      computed(
        'figma layer tree',
        () => readLayers(editor, editor.getCurrentPageId()),
        { isEqual: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
      ),
    [editor],
  );
  const layers = useValue(tree);
  const selectedIds = useValue(
    'selected layers',
    () => editor.getSelectedShapeIds(),
    [editor],
  );
  const hoveredId = useValue(
    'hovered layer',
    () => editor.getHoveredShapeId(),
    [editor],
  );
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const [open, setOpen] = useState<Set<TLShapeId>>(() => new Set());
  const [renaming, setRenaming] = useState<TLShapeId | null>(null);
  const anchor = useRef<TLShapeId | null>(null);
  const rowRefs = useRef(new Map<TLShapeId, HTMLDivElement>());

  useEffect(() => {
    let top = '';
    return react('figma layer tree open', () => {
      const ids = editor.getSortedChildIdsForParent(editor.getCurrentPageId());
      const fresh = ids.join() !== top;
      top = ids.join();
      const ancestors = editor
        .getSelectedShapeIds()
        .flatMap((id) => editor.getShapeAncestors(id).map((a) => a.id));
      setOpen((prev) => {
        const base = fresh ? new Set(ids) : prev;
        return ancestors.every((id) => base.has(id))
          ? base
          : new Set([...base, ...ancestors]);
      });
    });
  }, [editor]);

  const rows = useMemo(() => {
    const out: Row[] = [];
    const walk = (
      list: Layer[],
      depth: number,
      dimmed: boolean,
      inSelection: boolean,
    ) => {
      for (const layer of list) {
        out.push({ layer, depth, dimmed, inSelection });
        if (open.has(layer.id)) {
          walk(
            layer.children,
            depth + 1,
            dimmed || layer.hidden,
            inSelection || selected.has(layer.id),
          );
        }
      }
    };
    walk(layers, 0, false, false);
    return out;
  }, [layers, open, selected]);

  useEffect(() => {
    if (selectedIds.length) {
      rowRefs.current.get(selectedIds[0])?.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIds, rows]);

  const toggleOpen = (id: TLShapeId) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) {
        next.add(id);
      }
      return next;
    });

  const select = (e: MouseEvent, id: TLShapeId) => {
    if (editor.getCurrentToolId() !== 'select') {
      editor.setCurrentTool('select');
    }
    if (e.shiftKey && anchor.current) {
      const ids = rows.map((r) => r.layer.id);
      const [a, b] = [ids.indexOf(anchor.current), ids.indexOf(id)].sort(
        (x, y) => x - y,
      );
      if (a >= 0) {
        editor.select(...ids.slice(a, b + 1));
      }
    } else if (e.metaKey || e.ctrlKey) {
      if (selected.has(id)) {
        editor.deselect(id);
      } else {
        editor.select(...selectedIds, id);
      }
      anchor.current = id;
    } else {
      editor.select(id);
      anchor.current = id;
    }
    editor.focus();
  };

  const onRenameKey = (e: KeyboardEvent<HTMLInputElement>, id: TLShapeId) => {
    if (e.key === 'Enter') {
      rename(editor, id, e.currentTarget.value);
      setRenaming(null);
    } else if (e.key === 'Escape') {
      setRenaming(null);
    }
    e.stopPropagation();
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <PageTabs editor={editor} />
      <h2 className="px-4 pt-3 pb-1 text-xs font-medium text-muted-foreground">
        图层
      </h2>
      <div
        role="tree"
        aria-label="图层"
        className="min-h-0 flex-1 overflow-y-auto pb-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            editor.selectNone();
          }
        }}
      >
        {rows.map(({ layer, depth, dimmed, inSelection }) => {
          const Icon = ICONS[layer.icon] ?? Shapes;
          const isSelected = selected.has(layer.id);
          return (
            <div
              key={layer.id}
              ref={(el) => {
                if (el) {
                  rowRefs.current.set(layer.id, el);
                } else {
                  rowRefs.current.delete(layer.id);
                }
              }}
              role="treeitem"
              aria-selected={isSelected}
              aria-expanded={
                layer.children.length ? open.has(layer.id) : undefined
              }
              data-shape-id={layer.id}
              onClick={(e) => select(e, layer.id)}
              onPointerEnter={() => editor.setHoveredShape(layer.id)}
              onPointerLeave={() => editor.setHoveredShape(null)}
              className={cn(
                'group flex h-7 cursor-default items-center gap-1 pr-2 text-xs select-none',
                isSelected
                  ? 'bg-sky-100 dark:bg-sky-900/50'
                  : inSelection
                    ? 'bg-sky-50 dark:bg-sky-950/40'
                    : 'hover:bg-muted',
                hoveredId === layer.id &&
                  !isSelected &&
                  'ring-1 ring-sky-400 ring-inset',
              )}
              style={{ paddingLeft: 8 + depth * 12 }}
            >
              {layer.children.length ? (
                <button
                  type="button"
                  aria-label={open.has(layer.id) ? '收起' : '展开'}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleOpen(layer.id);
                  }}
                  className="flex size-4 shrink-0 items-center justify-center text-muted-foreground"
                >
                  <ChevronRight
                    className={cn(
                      'size-3 transition-transform',
                      open.has(layer.id) && 'rotate-90',
                    )}
                  />
                </button>
              ) : (
                <span className="size-4 shrink-0" />
              )}
              <Icon
                className={cn(
                  'size-3.5 shrink-0 text-muted-foreground',
                  layer.component && 'text-[#9747ff]',
                  (dimmed || layer.hidden) && 'opacity-50',
                )}
              />
              {renaming === layer.id ? (
                <input
                  autoFocus
                  defaultValue={layer.name}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => onRenameKey(e, layer.id)}
                  onBlur={(e) => {
                    rename(editor, layer.id, e.currentTarget.value);
                    setRenaming(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="h-5 min-w-0 flex-1 rounded-sm border border-sky-500 bg-background px-1 outline-none"
                />
              ) : (
                <span
                  className={cn(
                    'min-w-0 flex-1 truncate',
                    layer.component && 'text-[#9747ff]',
                    (dimmed || layer.hidden) && 'text-muted-foreground',
                  )}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    setRenaming(layer.id);
                  }}
                >
                  {layer.name}
                </span>
              )}
              <RowButton
                label={layer.locked ? '解锁' : '锁定'}
                active={layer.locked}
                onClick={() => toggleLocked(editor, layer.id)}
              >
                {layer.locked ? (
                  <Lock className="size-3" />
                ) : (
                  <LockOpen className="size-3" />
                )}
              </RowButton>
              {layer.figma && (
                <RowButton
                  label={layer.hidden ? '显示' : '隐藏'}
                  active={layer.hidden}
                  onClick={() => toggleHidden(editor, layer.id)}
                >
                  {layer.hidden ? (
                    <EyeOff className="size-3" />
                  ) : (
                    <Eye className="size-3" />
                  )}
                </RowButton>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
