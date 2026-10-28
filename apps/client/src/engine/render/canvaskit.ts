import CanvasKitInit, { type CanvasKit } from 'canvaskit-wasm';
import wasmUrl from 'canvaskit-wasm/bin/canvaskit.wasm?url';

// See apps/docs/skia-engine/tech.md §5.

let instance: CanvasKit | undefined;
let loading: Promise<CanvasKit> | undefined;

export function loadCanvasKit(): Promise<CanvasKit> {
  loading ??= CanvasKitInit({ locateFile: () => wasmUrl }).then((ck) => {
    instance = ck;
    return ck;
  });
  return loading;
}

/** The loaded CanvasKit; throws when `loadCanvasKit()` has not finished. */
export function getCanvasKit(): CanvasKit {
  if (!instance) {
    throw new Error('CanvasKit is not loaded yet');
  }
  return instance;
}

export function canvasKitIfLoaded(): CanvasKit | undefined {
  return instance;
}

/** Used by Node scripts that load CanvasKit themselves. */
export function setCanvasKit(ck: CanvasKit) {
  instance = ck;
  loading = Promise.resolve(ck);
}
