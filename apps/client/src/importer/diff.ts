import type { DiffInput, DiffOutput } from './diff-core';

// See apps/docs/figma-to-tldraw/tech.md §19.3.

type Reply = ({ ok: true } & DiffOutput) | { ok: false; error: string };

export function compareInWorker(input: DiffInput): Promise<DiffOutput> {
  const worker = new Worker(new URL('./diff.worker.ts', import.meta.url), {
    type: 'module',
  });
  return new Promise<DiffOutput>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<Reply>) => {
      if (event.data.ok) {
        resolve(event.data);
      } else {
        reject(new Error(event.data.error));
      }
    };
    worker.onerror = (event) => reject(new Error(event.message));
    worker.postMessage(input, [input.expected.buffer, input.actual.buffer]);
  }).finally(() => worker.terminate());
}
