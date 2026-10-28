import {
  ArrowUpRight,
  Circle,
  Frame,
  Hand,
  type LucideIcon,
  MousePointer2,
  Pencil,
  Square,
  Type,
} from 'lucide-react';
import { createContext, type ReactNode, useContext } from 'react';

import type {
  TLUiActionsContextType,
  TLUiToolItem,
  TLUiToolsContextType,
} from './actions';
import { useEditor, useValue } from './hooks';

// See apps/docs/skia-engine/tech.md §6.

export interface TLUiContext {
  tools: TLUiToolsContextType;
  actions: TLUiActionsContextType;
}

export const UiContext = createContext<TLUiContext>({ tools: {}, actions: {} });

export function useTools(): TLUiToolsContextType {
  return useContext(UiContext).tools;
}

export function useActions(): TLUiActionsContextType {
  return useContext(UiContext).actions;
}

const ICONS: Record<string, LucideIcon> = {
  'tool-pointer': MousePointer2,
  'tool-hand': Hand,
  'tool-pencil': Pencil,
  'tool-arrow': ArrowUpRight,
  'tool-frame': Frame,
  'geo-rectangle': Square,
  'geo-ellipse': Circle,
  'tool-text': Type,
};

const LABELS: Record<string, string> = {
  'tool.select': '选择',
  'tool.hand': '抓手',
  'tool.draw': '画笔',
  'tool.arrow': '箭头',
  'tool.frame': '画框',
  'tool.rectangle': '矩形',
  'tool.ellipse': '椭圆',
  'tool.text': '文字',
};

export function msg(id: string) {
  return LABELS[id] ?? id;
}

function ToolButton({ tool }: { tool: TLUiToolItem }) {
  const editor = useEditor();
  const active = useValue(
    'tool active',
    () => editor.getCurrentToolId() === tool.id,
    [editor, tool.id],
  );
  const Icon = ICONS[tool.icon] ?? Square;
  const kbd = tool.kbd?.split(',')[0]?.toUpperCase();
  return (
    <button
      type="button"
      title={kbd ? `${msg(tool.label)} (${kbd})` : msg(tool.label)}
      data-testid={`tools.${tool.id}`}
      aria-pressed={active}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => tool.onSelect('toolbar')}
      className={[
        'flex size-8 items-center justify-center rounded-md',
        active ? 'bg-[#0d99ff] text-white' : 'hover:bg-muted',
      ].join(' ')}
    >
      <Icon className="size-4" />
    </button>
  );
}

export function ToolbarItem({ tool }: { tool: string }) {
  const item = useTools()[tool];
  return item ? <ToolButton tool={item} /> : null;
}

export function SelectToolbarItem() {
  return <ToolbarItem tool="select" />;
}

export function HandToolbarItem() {
  return <ToolbarItem tool="hand" />;
}

export function DrawToolbarItem() {
  return <ToolbarItem tool="draw" />;
}

export function ArrowToolbarItem() {
  return <ToolbarItem tool="arrow" />;
}

export function DefaultToolbar({ children }: { children?: ReactNode }) {
  const tools = useTools();
  return (
    <div className="tlui-toolbar pointer-events-auto absolute bottom-3 left-1/2 z-[300] flex -translate-x-1/2 gap-1 rounded-lg border bg-background p-1 shadow-sm">
      {children ??
        Object.values(tools).map((t) => <ToolButton key={t.id} tool={t} />)}
    </div>
  );
}

export interface TLUiStylePanelProps {
  isMobile?: boolean;
  children?: ReactNode;
}

export function DefaultStylePanel({ children }: TLUiStylePanelProps) {
  if (!children) {
    return null;
  }
  return (
    <div className="tlui-style-panel pointer-events-auto absolute top-2 right-2 z-[300] max-h-[calc(100%-16px)] overflow-y-auto rounded-lg border bg-background shadow-sm">
      {children}
    </div>
  );
}
