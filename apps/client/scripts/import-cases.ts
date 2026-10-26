import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { OPEN_FONTS } from '../src/figma/fonts';

// See apps/docs/figma-to-tldraw/tech.md §9.

interface CaseEntry {
  name: string;
  dir: string;
  width: number;
  height: number;
  [key: string]: unknown;
}

interface CaseIndex {
  exportedAt?: string;
  figmaFile?: string;
  page?: string;
  cases: CaseEntry[];
  [key: string]: unknown;
}

const ROOT = path.resolve(import.meta.dirname, '../../..');
const CASES_DIR = path.join(ROOT, 'cases');

function readIndex(file: string): CaseIndex {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as CaseIndex;
}

/** Font families a case uses that are not on the open font list. */
function closedFonts(snapshotFile: string): string[] {
  const snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8')) as {
    meta: { fonts: string[] };
  };
  const families = snapshot.meta.fonts.map((f) => f.split(' / ')[0]);
  return [...new Set(families)].filter((f) => !OPEN_FONTS.has(f));
}

function importZip(zip: string, index: CaseIndex): string[] {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'figma-cases-'));
  try {
    execFileSync('unzip', ['-q', zip, '-d', tmp]);
    const incoming = readIndex(path.join(tmp, 'cases/index.json'));
    const source = {
      figmaFile: incoming.figmaFile,
      page: incoming.page?.trim(),
      exportedAt: incoming.exportedAt,
    };
    const imported: string[] = [];
    for (const c of incoming.cases) {
      const from = path.join(tmp, 'cases', c.dir);
      const closed = closedFonts(path.join(from, 'snapshot.json'));
      if (closed.length) {
        console.log(
          `  跳过 ${c.dir}：用到不在开源字体清单里的字体 ${closed.join('、')}`,
        );
        continue;
      }
      imported.push(c.dir);
      const to = path.join(CASES_DIR, c.dir);
      if (!path.resolve(to).startsWith(CASES_DIR + path.sep)) {
        throw new Error(`用例目录跑出了 cases/：${c.dir}`);
      }
      fs.rmSync(to, { recursive: true, force: true });
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.cpSync(from, to, { recursive: true });
      const { page, ...rest } = c as CaseEntry & { page?: string };
      const entry = {
        ...rest,
        source: { ...source, page: page?.trim() ?? source.page },
      };
      const i = index.cases.findIndex((e) => e.dir === c.dir);
      if (i >= 0) {
        index.cases[i] = entry;
      } else {
        index.cases.push(entry);
      }
    }
    return imported;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function main() {
  const zips = process.argv.slice(2);
  if (zips.length === 0) {
    console.error('用法：pnpm import-cases <导出的 zip>...');
    process.exit(1);
  }
  const indexFile = path.join(CASES_DIR, 'index.json');
  const index: CaseIndex = fs.existsSync(indexFile)
    ? readIndex(indexFile)
    : { cases: [] };
  for (const zip of zips) {
    const dirs = importZip(path.resolve(zip), index);
    console.log(`${zip}：${dirs.length} 个用例`);
    for (const dir of dirs) {
      console.log(`  ${dir}`);
    }
  }
  fs.writeFileSync(indexFile, `${JSON.stringify(index, null, 2)}\n`);
  console.log(`cases/index.json 现在有 ${index.cases.length} 个用例`);
}

main();
