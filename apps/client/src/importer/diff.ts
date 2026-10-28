import type { DiffBreakdown } from '../figma/diff-attribution';
import type { Snapshot } from '../figma/types';
import type { StripInput, StripOutput } from './diff-core';

// See apps/docs/figma-to-tldraw/tech.md §19.3.

export type WorkerRequest =
  | { type: 'start'; snapshot: Snapshot }
  | { type: 'strip'; input: StripInput }
  | { type: 'finish' };

type Reply<T> = ({ ok: true } & T) | { ok: false; error: string };

/** One diff in a worker, fed a strip at a time; call `close` when done. */
export interface CompareSession {
  strip: (input: StripInput) => Promise<StripOutput>;
  finish: () => Promise<DiffBreakdown>;
  close: () => void;
}

export async function startCompare(
  snapshot: Snapshot,
): Promise<CompareSession> {
  const worker = new Worker(new URL('./diff.worker.ts', import.meta.url), {
    type: 'module',
  });
  const request = <T>(req: WorkerRequest, transfer: Transferable[] = []) =>
    new Promise<T>((resolve, reject) => {
      worker.onmessage = (event: MessageEvent<Reply<T>>) => {
        if (event.data.ok) {
          resolve(event.data);
        } else {
          reject(new Error(event.data.error));
        }
      };
      worker.onerror = (event) => reject(new Error(event.message));
      worker.postMessage(req, transfer);
    });
  try {
    await request({ type: 'start', snapshot });
  } catch (e) {
    worker.terminate();
    throw e;
  }
  return {
    strip: (input) =>
      request<StripOutput>({ type: 'strip', input }, [
        input.expected.buffer,
        input.actual.buffer,
      ]),
    finish: async () =>
      (await request<{ breakdown: DiffBreakdown }>({ type: 'finish' }))
        .breakdown,
    close: () => worker.terminate(),
  };
}
