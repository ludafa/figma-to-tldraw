import type { Editor, TLContent } from '../editor';

// See apps/docs/skia-engine/tech.md §6.

export type TLUiEventSource = 'kbd' | 'toolbar' | 'menu' | 'unknown';

export interface TLUiActionItem {
  id: string;
  label?: string;
  icon?: string;
  kbd?: string;
  readonlyOk?: boolean;
  onSelect(source: TLUiEventSource): void;
}

export interface TLUiToolItem {
  id: string;
  label: string;
  icon: string;
  kbd?: string;
  onSelect(source: TLUiEventSource): void;
}

export type TLUiActionsContextType = Record<string, TLUiActionItem>;
export type TLUiToolsContextType = Record<string, TLUiToolItem>;

export interface TLUiOverrideHelpers {
  msg(id: string): string;
}

export interface TLUiOverrides {
  actions?(
    editor: Editor,
    actions: TLUiActionsContextType,
    helpers: TLUiOverrideHelpers,
  ): TLUiActionsContextType;
  tools?(
    editor: Editor,
    tools: TLUiToolsContextType,
    helpers: TLUiOverrideHelpers,
  ): TLUiToolsContextType;
}

let clipboard: TLContent | null = null;

export function defaultActions(editor: Editor): TLUiActionsContextType {
  const list: TLUiActionItem[] = [
    {
      id: 'undo',
      label: 'action.undo',
      kbd: '$z',
      onSelect: () => editor.undo(),
    },
    {
      id: 'redo',
      label: 'action.redo',
      kbd: '$!z,ctrl+y',
      onSelect: () => editor.redo(),
    },
    {
      id: 'select-all',
      label: 'action.select-all',
      kbd: '$a',
      readonlyOk: true,
      onSelect: () => editor.selectAll(),
    },
    {
      id: 'select-none',
      label: 'action.select-none',
      readonlyOk: true,
      onSelect: () => editor.selectNone(),
    },
    {
      id: 'duplicate',
      label: 'action.duplicate',
      kbd: '$d',
      onSelect: () => {
        const ids = editor.getSelectedShapeIds();
        if (ids.length) {
          editor.markHistoryStoppingPoint('duplicate');
          editor.duplicateShapes(ids);
        }
      },
    },
    {
      id: 'copy',
      label: 'action.copy',
      kbd: '$c',
      readonlyOk: true,
      onSelect: () => {
        clipboard =
          editor.getContentFromCurrentPage(editor.getSelectedShapeIds()) ??
          clipboard;
      },
    },
    {
      id: 'cut',
      label: 'action.cut',
      kbd: '$x',
      onSelect: () => {
        const ids = editor.getSelectedShapeIds();
        const content = editor.getContentFromCurrentPage(ids);
        if (content) {
          clipboard = content;
          editor.markHistoryStoppingPoint('cut');
          editor.deleteShapes(ids);
        }
      },
    },
    {
      id: 'paste',
      label: 'action.paste',
      kbd: '$v',
      onSelect: () => {
        if (clipboard) {
          editor.markHistoryStoppingPoint('paste');
          editor.putContentOntoCurrentPage(clipboard, { select: true });
        }
      },
    },
    {
      id: 'delete',
      label: 'action.delete',
      onSelect: () => {
        const ids = editor.getSelectedShapeIds();
        if (ids.length) {
          editor.markHistoryStoppingPoint('delete');
          editor.deleteShapes(ids);
        }
      },
    },
    {
      id: 'zoom-in',
      label: 'action.zoom-in',
      kbd: '$=,=',
      readonlyOk: true,
      onSelect: () => editor.zoomIn(),
    },
    {
      id: 'zoom-out',
      label: 'action.zoom-out',
      kbd: '$-,-',
      readonlyOk: true,
      onSelect: () => editor.zoomOut(),
    },
    {
      id: 'zoom-to-100',
      label: 'action.zoom-to-100',
      kbd: '!0',
      readonlyOk: true,
      onSelect: () => editor.resetZoom(),
    },
    {
      id: 'zoom-to-fit',
      label: 'action.zoom-to-fit',
      kbd: '!1',
      readonlyOk: true,
      onSelect: () => editor.zoomToFit(),
    },
    {
      id: 'zoom-to-selection',
      label: 'action.zoom-to-selection',
      kbd: '!2',
      readonlyOk: true,
      onSelect: () => editor.zoomToSelection(),
    },
  ];
  return Object.fromEntries(list.map((a) => [a.id, a]));
}

const DEFAULT_TOOLS: Omit<TLUiToolItem, 'onSelect'>[] = [
  { id: 'select', label: 'tool.select', icon: 'tool-pointer', kbd: 'v' },
  { id: 'hand', label: 'tool.hand', icon: 'tool-hand', kbd: 'h' },
  { id: 'draw', label: 'tool.draw', icon: 'tool-pencil', kbd: 'd,b,x' },
  { id: 'arrow', label: 'tool.arrow', icon: 'tool-arrow', kbd: 'a' },
];

export function defaultUiTools(editor: Editor): TLUiToolsContextType {
  const out: TLUiToolsContextType = {};
  for (const t of DEFAULT_TOOLS) {
    if (editor.root.children?.[t.id]) {
      out[t.id] = { ...t, onSelect: () => editor.setCurrentTool(t.id) };
    }
  }
  return out;
}

export function resolveUi(editor: Editor, overrides?: TLUiOverrides) {
  const helpers: TLUiOverrideHelpers = { msg: (id) => id };
  let actions = defaultActions(editor);
  let tools = defaultUiTools(editor);
  if (overrides?.actions) {
    actions = overrides.actions(editor, actions, helpers);
  }
  if (overrides?.tools) {
    tools = overrides.tools(editor, tools, helpers);
  }
  return { actions, tools };
}

const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad/.test(navigator.platform);

function codeFor(key: string): string | undefined {
  if (/^[a-z]$/.test(key)) {
    return `Key${key.toUpperCase()}`;
  }
  if (/^[0-9]$/.test(key)) {
    return `Digit${key}`;
  }
  return {
    '=': 'Equal',
    '-': 'Minus',
    '[': 'BracketLeft',
    ']': 'BracketRight',
  }[key];
}

/** Matches tldraw-style shortcuts: `$z` (accel), `!` shift, `?` alt, or `cmd+alt+k`. */
export function matchKbd(kbd: string, e: KeyboardEvent): boolean {
  for (const combo of kbd.split(',')) {
    let accel = false;
    let shift = false;
    let alt = false;
    let meta = false;
    let ctrl = false;
    let key: string;
    if (combo.length > 1 && combo.includes('+')) {
      const parts = combo.split('+');
      key = parts.pop()!;
      for (const p of parts) {
        if (p === 'cmd' || p === 'meta') {
          meta = true;
        } else if (p === 'ctrl') {
          ctrl = true;
        } else if (p === 'alt' || p === 'option') {
          alt = true;
        } else if (p === 'shift') {
          shift = true;
        }
      }
    } else {
      let rest = combo;
      while (rest.length > 1 && '$!?'.includes(rest[0])) {
        if (rest[0] === '$') {
          accel = true;
        } else if (rest[0] === '!') {
          shift = true;
        } else {
          alt = true;
        }
        rest = rest.slice(1);
      }
      key = rest;
    }
    if (accel) {
      if (isMac) {
        meta = true;
      } else {
        ctrl = true;
      }
    }
    if (
      e.metaKey !== meta ||
      e.ctrlKey !== ctrl ||
      e.altKey !== alt ||
      e.shiftKey !== shift
    ) {
      continue;
    }
    const code = codeFor(key);
    if (e.key.toLowerCase() === key || (code && e.code === code)) {
      return true;
    }
  }
  return false;
}
