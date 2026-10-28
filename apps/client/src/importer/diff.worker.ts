import { type Attribution, createAttribution } from '../figma/diff-attribution';
import type { WorkerRequest } from './diff';
import { compareStrip, SCALE } from './diff-core';

// See apps/docs/figma-to-tldraw/tech.md §19.3.

let attribution: Attribution | null = null;

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  try {
    const req = event.data;
    if (req.type === 'start') {
      attribution = createAttribution(req.snapshot, SCALE);
      self.postMessage({ ok: true });
    } else if (!attribution) {
      throw new Error('对比还没开始');
    } else if (req.type === 'strip') {
      const out = compareStrip(req.input, attribution);
      self.postMessage({ ok: true, ...out }, { transfer: [out.diff.buffer] });
    } else {
      self.postMessage({ ok: true, breakdown: attribution.result() });
    }
  } catch (e) {
    self.postMessage({ ok: false, error: String(e) });
  }
};
