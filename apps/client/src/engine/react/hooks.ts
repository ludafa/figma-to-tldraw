import {
  createContext,
  type RefObject,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from 'react';

import type { Editor } from '../editor';
import { type Atom, atom, computed, react, type Signal } from '../state';

// See apps/docs/skia-engine/tech.md §2.

export const EditorContext = createContext<Editor | null>(null);

export function useEditor(): Editor {
  const editor = useContext(EditorContext);
  if (!editor) {
    throw new Error('useEditor must be used inside <SkiaCanvas>');
  }
  return editor;
}

export function useMaybeEditor(): Editor | null {
  return useContext(EditorContext);
}

export function useValue<T>(signal: Signal<T>): T;
export function useValue<T>(name: string, fn: () => T, deps: unknown[]): T;
export function useValue<T>(
  a: Signal<T> | string,
  fn?: () => T,
  deps: unknown[] = [],
): T {
  const $value = useMemo(
    () => (typeof a === 'string' ? computed(a, () => fn!()) : a),
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the caller passes the deps.
    typeof a === 'string' ? deps : [a],
  );
  const [subscribe, getSnapshot] = useMemo(
    () => [
      (onChange: () => void) => {
        let first = true;
        return react(`useValue ${$value.name}`, () => {
          $value.get();
          if (first) {
            first = false;
            return;
          }
          onChange();
        });
      },
      () => $value.__unsafe__getWithoutCapture(),
    ],
    [$value],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useAtom<T>(name: string, initial: T | (() => T)): Atom<T> {
  const [a] = useState(() =>
    atom(
      name,
      typeof initial === 'function' ? (initial as () => T)() : initial,
    ),
  );
  return a;
}

// See apps/docs/skia-engine/tech.md §6.9.
export function usePagePosition(
  ref: RefObject<HTMLElement | null>,
  x: number,
  y: number,
) {
  const editor = useEditor();
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    const update = () => {
      const c = editor.getCamera();
      el.style.transform = `scale(${c.z}) translate(${c.x + x}px, ${c.y + y}px)`;
    };
    update();
    editor.on('camera', update);
    return () => {
      editor.off('camera', update);
    };
  }, [editor, ref, x, y]);
}
