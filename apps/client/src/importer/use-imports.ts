import { useCallback, useEffect, useRef, useState } from 'react';

import { closedFonts } from '../figma/fonts';
import { closedFontsOf, fontWarning, type Progress } from './import-panel';
import type { ShotStage } from './shot-stage';
import {
  addImport,
  deleteImport,
  getZip,
  type ImportedCase,
  type ImportRecord,
  isPersistent,
  listImports,
  saveImport,
  saveOutputs,
} from './store';
import { readZipCase, readZipIndex, withBlobUrls } from './zip';

// See apps/docs/figma-to-tldraw/tech.md §19.3.

export interface Notice {
  text: string;
  error?: boolean;
}

export interface Job {
  id: string;
  dir: string;
}

export const jobKey = (job: Job) => `${job.id}\n${job.dir}`;

export const message = (e: unknown) =>
  e instanceof Error ? e.message : String(e);

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Import records in IndexedDB plus the queue that diffs their boards one at a time. */
export function useImports() {
  const [records, setRecords] = useState<ImportRecord[] | null>(null);
  const recordsRef = useRef<ImportRecord[]>([]);
  const [persistent, setPersistent] = useState(true);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [analyzing, setAnalyzing] = useState<string | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);

  const stage = useRef<ShotStage | null>(null);
  const stageWaiters = useRef<((stage: ShotStage) => void)[]>([]);
  const queue = useRef(Promise.resolve());
  const counts = useRef({ done: 0, total: 0 });
  const pending = useRef(new Set<string>());

  const setAll = useCallback((next: ImportRecord[]) => {
    recordsRef.current = next;
    setRecords(next);
  }, []);

  useEffect(() => {
    listImports()
      .then(setAll)
      .catch((e: unknown) => {
        setAll([]);
        setNotices([
          { text: `读不出浏览器里存的导入记录：${message(e)}`, error: true },
        ]);
      });
    void isPersistent().then(setPersistent);
  }, [setAll]);

  const onStageReady = useCallback((s: ShotStage | null) => {
    stage.current = s;
    if (s) {
      for (const resolve of stageWaiters.current) {
        resolve(s);
      }
      stageWaiters.current = [];
    }
  }, []);

  const getStage = () =>
    stage.current
      ? Promise.resolve(stage.current)
      : new Promise<ShotStage>((resolve) => stageWaiters.current.push(resolve));

  function updateCase(id: string, dir: string, patch: Partial<ImportedCase>) {
    const next = recordsRef.current.map((r) =>
      r.id === id
        ? {
            ...r,
            cases: r.cases.map((c) => (c.dir === dir ? { ...c, ...patch } : c)),
          }
        : r,
    );
    setAll(next);
    const changed = next.find((r) => r.id === id);
    if (changed) {
      saveImport(changed).catch((e: unknown) => console.warn(e));
    }
  }

  async function analyzeOne(job: Job) {
    const rec = recordsRef.current.find((r) => r.id === job.id);
    const c = rec?.cases.find((x) => x.dir === job.dir);
    if (!rec || !c) {
      return;
    }
    setProgress({
      text: `截图对比：${c.name}`,
      done: counts.current.done,
      total: counts.current.total,
    });
    setAnalyzing(jobKey(job));
    const analyzedAt = new Date().toISOString();
    const base = {
      dir: c.dir,
      width: c.width,
      height: c.height,
      sizeMismatch: false,
      analyzedAt,
    };
    try {
      const zip = await getZip(job.id);
      if (!zip) {
        throw new Error('浏览器里找不到这次导入的 zip');
      }
      const files = await readZipCase(zip, job.dir);
      const assets = withBlobUrls(files);
      try {
        const shot = await (
          await getStage()
        ).analyze({
          idPrefix: job.dir,
          snapshot: assets.snapshot,
          expected: files.expected,
        });
        await saveOutputs(job.id, job.dir, {
          actual: shot.actual,
          diff: shot.diffImage,
        });
        updateCase(job.id, job.dir, {
          result: {
            ...base,
            diff: shot.diff,
            diffPixels: shot.diffPixels,
            warnings: shot.warnings,
            breakdown: shot.breakdown,
            ms: shot.ms,
          },
        });
      } finally {
        assets.revoke();
      }
    } catch (e) {
      console.error(e);
      updateCase(job.id, job.dir, {
        result: {
          ...base,
          diff: 100,
          diffPixels: 0,
          warnings: [],
          error: message(e),
          ms: 0,
        },
      });
    }
  }

  function enqueue(jobs: Job[]) {
    counts.current.total += jobs.length;
    for (const job of jobs) {
      pending.current.add(jobKey(job));
      queue.current = queue.current
        .then(() => analyzeOne(job))
        .catch((e: unknown) => console.error(e))
        .finally(() => {
          pending.current.delete(jobKey(job));
          counts.current.done++;
          if (counts.current.done >= counts.current.total) {
            counts.current = { done: 0, total: 0 };
            setProgress(null);
            setAnalyzing(null);
          }
        });
    }
  }

  const isQueued = (job: Job) => pending.current.has(jobKey(job));

  /** Stores each zip, queues its boards and returns the first new record. */
  async function importFiles(files: File[]): Promise<ImportRecord | null> {
    const fresh: Notice[] = [];
    let first: ImportRecord | null = null;
    for (const file of files) {
      if (!/\.zip$/i.test(file.name)) {
        fresh.push({ text: `${file.name} 不是 zip，跳过了`, error: true });
        continue;
      }
      try {
        const index = await readZipIndex(file);
        const rec: ImportRecord = {
          id: newId(),
          fileName: file.name,
          size: file.size,
          importedAt: new Date().toISOString(),
          figmaFile: index.figmaFile ?? '',
          page: (index.page ?? '').trim(),
          exportedAt: index.exportedAt ?? '',
          cases: (index.cases ?? []).map((c) => ({
            dir: c.dir,
            name: c.name,
            width: c.width,
            height: c.height,
            fonts: c.fonts ?? [],
            closedFonts: closedFonts(c.fonts ?? []),
          })),
          errors: index.errors ?? [],
        };
        if (!rec.cases.length) {
          throw new Error('zip 里一个画板都没有');
        }
        await addImport(rec, file);
        setAll([rec, ...recordsRef.current]);
        first ??= rec;
        fresh.push({
          text: `导入了 ${file.name}：${rec.cases.length} 个画板`,
        });
        const fonts = closedFontsOf(rec);
        if (fonts.length) {
          fresh.push({ text: fontWarning(fonts), error: true });
        }
        enqueue(rec.cases.map((c) => ({ id: rec.id, dir: c.dir })));
      } catch (e) {
        fresh.push({ text: `${file.name}：${message(e)}`, error: true });
      }
    }
    setNotices(fresh);
    return first;
  }

  /** Asks first; resolves to whether the import was deleted. */
  async function remove(rec: ImportRecord): Promise<boolean> {
    if (
      !window.confirm(
        `删除「${rec.figmaFile || rec.fileName}」这次导入？浏览器里存的 zip 和对比结果都会删掉。`,
      )
    ) {
      return false;
    }
    await deleteImport(rec).catch((e: unknown) => console.warn(e));
    setAll(recordsRef.current.filter((r) => r.id !== rec.id));
    return true;
  }

  return {
    records,
    persistent,
    progress,
    analyzing,
    notices,
    setNotices,
    onStageReady,
    enqueue,
    isQueued,
    importFiles,
    remove,
  };
}
