import {
  type ComponentType,
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { defaultShapeTools, defaultShapeUtils } from '../defaults';
import { Editor, type EditorOptions, type TLShapeVisibility } from '../editor';
import { loadCanvasKit } from '../render/canvaskit';
import {
  CanvasController,
  type RenderMode,
  getCanvasController,
} from '../render/controller';
import { getSharedResources } from '../render/resources';
import type { TLShapeUtilConstructor } from '../shape-util';
import type { Store } from '../store';
import type { TLStateNodeConstructor } from '../tools/state-node';
import type { TLShape } from '../types';
import { resolveUi, type TLUiOverrides } from './actions';
import { EditorContext, useValue } from './hooks';
import { bindInput } from './input';
import { type TLUiContext, UiContext } from './ui';

// See apps/docs/skia-engine/tech.md §5 and §6.

export interface TLComponents {
  /** Page-space DOM drawn above the shapes (moves and scales with the camera). */
  OnTheCanvas?: ComponentType | null;
  /** Viewport-space DOM above the canvas. */
  InFrontOfTheCanvas?: ComponentType | null;
  Toolbar?: ComponentType | null;
  StylePanel?: ComponentType | null;
}

export interface SkiaCanvasProps {
  shapeUtils?: readonly TLShapeUtilConstructor<TLShape>[];
  tools?: readonly TLStateNodeConstructor[];
  components?: TLComponents;
  overrides?: TLUiOverrides;
  options?: Partial<EditorOptions>;
  getShapeVisibility?: (
    shape: TLShape,
    editor: Editor,
  ) => TLShapeVisibility | undefined | null;
  /** Accepted for tldraw compatibility; text is laid out by the shape utils. */
  textOptions?: unknown;
  hideUi?: boolean;
  /** Focus the canvas on mount so shortcuts work right away. */
  autoFocus?: boolean;
  store?: Store;
  onMount?: (editor: Editor) => void | (() => void);
  /** `direct` redraws the whole view each frame (screenshots); `tiles` caches. */
  renderMode?: RenderMode;
  background?: string;
  className?: string;
  children?: ReactNode;
}

function CameraLayer({
  editor,
  children,
}: {
  editor: Editor;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    const update = () => {
      const c = editor.getCamera();
      el.style.transform = `scale(${c.z}) translate(${c.x}px, ${c.y}px)`;
      // See apps/docs/skia-engine/tech.md §10.5.
      editor.getContainer().style.setProperty('--tl-zoom', String(c.z));
    };
    update();
    editor.on('camera', update);
    return () => {
      editor.off('camera', update);
    };
  }, [editor]);
  const style: CSSProperties = {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 1,
    height: 1,
    transformOrigin: '0 0',
    pointerEvents: 'none',
  };
  return (
    <div ref={ref} className="tl-html-layer" style={style}>
      {children}
    </div>
  );
}

function EditingLayer({ editor }: { editor: Editor }) {
  const shape = useValue('editing shape', () => editor.getEditingShape(), [
    editor,
  ]);
  const transform = useValue(
    'editing transform',
    () => (shape ? editor.getShapePageTransform(shape) : null),
    [editor, shape],
  );
  if (!shape || !transform) {
    return null;
  }
  const util = editor.getShapeUtil(shape);
  const content = util.editingComponent?.(shape);
  if (!content) {
    return null;
  }
  const { a, b, c, d, e, f } = transform;
  return (
    <div
      key={shape.id}
      className="tl-shape tl-editing"
      data-shape-id={shape.id}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        transformOrigin: '0 0',
        transform: `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`,
        pointerEvents: 'all',
      }}
    >
      {content}
    </div>
  );
}

// See apps/docs/skia-engine/tech.md §6.8.
function withDefaults<T>(
  defaults: readonly T[],
  given: readonly T[] | undefined,
  key: (item: T) => string,
): T[] {
  const own = new Set((given ?? []).map(key));
  return [...defaults.filter((d) => !own.has(key(d))), ...(given ?? [])];
}

/** The canvas: same props and behaviour as tldraw's `<Tldraw>`, drawn with Skia. */
export function SkiaCanvas(props: SkiaCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [ui, setUi] = useState<TLUiContext>({ tools: {}, actions: {} });
  const propsRef = useRef(props);
  useLayoutEffect(() => {
    propsRef.current = props;
  });
  const mode = props.renderMode ?? 'tiles';
  const background = props.background ?? '#f5f5f5';

  useLayoutEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void loadCanvasKit().then((ck) => {
      if (cancelled) {
        return;
      }
      const p = propsRef.current;
      const container = containerRef.current!;
      const canvas = canvasRef.current!;
      const ed = new Editor({
        store: p.store,
        shapeUtils: withDefaults(
          defaultShapeUtils,
          p.shapeUtils,
          (u) => u.type,
        ),
        tools: withDefaults(defaultShapeTools, p.tools, (t) => t.id),
        getContainer: () => container,
        options: p.options,
        getShapeVisibility: p.getShapeVisibility,
      });
      const resources = getSharedResources(ck);
      resources.fonts.scanDocument();
      const controller = new CanvasController(ed, ck, resources, canvas, {
        mode,
        background,
      });
      const measure = () => {
        const r = container.getBoundingClientRect();
        ed.updateViewportScreenBounds(r);
        controller.resize(r.width, r.height, window.devicePixelRatio || 1);
      };
      measure();
      const ro = new ResizeObserver(measure);
      ro.observe(container);
      window.addEventListener('resize', measure);
      window.addEventListener('scroll', measure, true);
      const ui = resolveUi(ed, p.overrides);
      const unbind = bindInput(ed, controller, container, ui);
      const unmount = p.onMount?.(ed);
      setUi(ui);
      setEditor(ed);
      if (p.autoFocus) {
        container.focus({ preventScroll: true });
      }
      controller.frame();
      cleanup = () => {
        unmount?.();
        unbind();
        ro.disconnect();
        window.removeEventListener('resize', measure);
        window.removeEventListener('scroll', measure, true);
        controller.dispose();
        ed.dispose();
      };
    });
    return () => {
      cancelled = true;
      cleanup?.();
      setEditor(null);
    };
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the editor lives as long as the component.
  }, []);

  useEffect(() => {
    if (editor) {
      const c = getCanvasController(editor);
      c?.setOptions({ mode, background });
    }
  }, [editor, mode, background]);

  const { components = {}, hideUi } = props;
  const { OnTheCanvas, InFrontOfTheCanvas, Toolbar, StylePanel } = components;

  return (
    <div
      ref={containerRef}
      className={['tl-container', 'skia-canvas', props.className]
        .filter(Boolean)
        .join(' ')}
      tabIndex={-1}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        // See apps/docs/skia-engine/tech.md §10.5.
        overflow: 'clip',
        touchAction: 'none',
        outline: 'none',
        background,
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          width: '100%',
          height: '100%',
          display: 'block',
        }}
      />
      {editor && (
        <EditorContext.Provider value={editor}>
          <UiContext.Provider value={ui}>
            <CameraLayer editor={editor}>
              {OnTheCanvas && <OnTheCanvas />}
              <EditingLayer editor={editor} />
            </CameraLayer>
            {InFrontOfTheCanvas && <InFrontOfTheCanvas />}
            {!hideUi && (
              <div
                className="tlui-layout"
                style={{
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: 'none',
                }}
              >
                {StylePanel && <StylePanel />}
                {Toolbar && <Toolbar />}
              </div>
            )}
            {props.children}
          </UiContext.Provider>
        </EditorContext.Provider>
      )}
    </div>
  );
}

export { SkiaCanvas as Tldraw };
export type { SkiaCanvasProps as TldrawProps };
