import { compareImages, type DiffInput } from './diff-core';

// See apps/docs/figma-to-tldraw/tech.md §19.3.

self.onmessage = (event: MessageEvent<DiffInput>) => {
  try {
    const out = compareImages(event.data);
    self.postMessage({ ok: true, ...out }, { transfer: [out.diff.buffer] });
  } catch (e) {
    self.postMessage({ ok: false, error: String(e) });
  }
};
