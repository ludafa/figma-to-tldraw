import type { FidelityResult } from '../figma/report';

// See apps/docs/figma-to-tldraw/tech.md §19.1.

export interface ImportedCase {
  dir: string;
  name: string;
  width: number;
  height: number;
  fonts: string[];
  closedFonts: string[];
  result?: FidelityResult & { analyzedAt: string; ms: number };
}

export interface ImportRecord {
  id: string;
  fileName: string;
  size: number;
  importedAt: string;
  figmaFile: string;
  page: string;
  exportedAt: string;
  cases: ImportedCase[];
  errors: { name: string; error: string }[];
}

export interface CaseOutputs {
  actual: Blob;
  diff: Blob;
}

const DB_NAME = 'figma-to-tldraw-imports';
const IMPORTS = 'imports';
const ZIPS = 'zips';
const OUTPUTS = 'outputs';

const memory = {
  [IMPORTS]: new Map<string, unknown>(),
  [ZIPS]: new Map<string, unknown>(),
  [OUTPUTS]: new Map<string, unknown>(),
};
type StoreName = keyof typeof memory;

let opening: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  opening ??= new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        for (const name of [IMPORTS, ZIPS, OUTPUTS]) {
          req.result.createObjectStore(name);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return opening;
}

/** Whether imports survive a reload (false in private windows and the like). */
export async function isPersistent(): Promise<boolean> {
  return (await openDb()) !== null;
}

async function run<T>(
  name: StoreName,
  mode: IDBTransactionMode,
  op: (store: IDBObjectStore) => IDBRequest,
  fallback: (map: Map<string, unknown>) => T,
): Promise<T> {
  const db = await openDb();
  if (!db) {
    return fallback(memory[name]);
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const req = op(tx.objectStore(name));
    tx.oncomplete = () => resolve(req.result as T);
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB 出错'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB 写入被中止'));
  });
}

const put = (name: StoreName, key: string, value: unknown) =>
  run<unknown>(
    name,
    'readwrite',
    (s) => s.put(value, key),
    (m) => m.set(key, value),
  );

const get = <T>(name: StoreName, key: string) =>
  run<T | undefined>(
    name,
    'readonly',
    (s) => s.get(key),
    (m) => m.get(key) as T | undefined,
  );

export async function listImports(): Promise<ImportRecord[]> {
  const all = await run<ImportRecord[]>(
    IMPORTS,
    'readonly',
    (s) => s.getAll(),
    (m) => [...m.values()] as ImportRecord[],
  );
  return all.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
}

export async function addImport(record: ImportRecord, zip: Blob) {
  await put(ZIPS, record.id, zip);
  await put(IMPORTS, record.id, record);
}

export const saveImport = (record: ImportRecord) =>
  put(IMPORTS, record.id, record);

export const getZip = (id: string) => get<Blob>(ZIPS, id);

export const outputKey = (id: string, dir: string) => `${id}\n${dir}`;

export const saveOutputs = (id: string, dir: string, outputs: CaseOutputs) =>
  put(OUTPUTS, outputKey(id, dir), outputs);

export const getOutputs = (id: string, dir: string) =>
  get<CaseOutputs>(OUTPUTS, outputKey(id, dir));

export async function deleteImport(record: ImportRecord) {
  await run(
    IMPORTS,
    'readwrite',
    (s) => s.delete(record.id),
    (m) => void m.delete(record.id),
  );
  await run(
    ZIPS,
    'readwrite',
    (s) => s.delete(record.id),
    (m) => void m.delete(record.id),
  );
  for (const c of record.cases) {
    const key = outputKey(record.id, c.dir);
    await run(
      OUTPUTS,
      'readwrite',
      (s) => s.delete(key),
      (m) => void m.delete(key),
    );
  }
}
