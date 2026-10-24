import 'tldraw/tldraw.css';

import { type Editor, Tldraw } from 'tldraw';

declare global {
  interface Window {
    editor?: Editor;
  }
}

export function CanvasPage() {
  function handleMount(editor: Editor) {
    if (import.meta.env.DEV) {
      window.editor = editor;
    }
  }

  return (
    <div className="fixed inset-0">
      <Tldraw onMount={handleMount} />
    </div>
  );
}
