import fs from 'node:fs';
import path from 'node:path';

import {
  emptyStats,
  indexMains,
  type RebuildStats,
  rebuildTree,
} from '../src/figma/components';
import type { CaseIndex, Snapshot } from '../src/figma/types';

// See apps/docs/figma-to-tldraw/tech.md §16.2.

const ROOT = path.resolve(import.meta.dirname, '../../..');
const CASES_DIR = path.join(ROOT, 'cases');

function add(total: RebuildStats, s: RebuildStats) {
  for (const key of Object.keys(s) as (keyof RebuildStats)[]) {
    if (key === 'inferredFields') {
      for (const [f, n] of Object.entries(s.inferredFields)) {
        total.inferredFields[f] = (total.inferredFields[f] ?? 0) + n;
      }
    } else {
      total[key] += s[key];
    }
  }
}

function main() {
  const patterns = process.argv.slice(2);
  const index = JSON.parse(
    fs.readFileSync(path.join(CASES_DIR, 'index.json'), 'utf8'),
  ) as CaseIndex;
  const total = emptyStats();
  const rows: string[] = [];
  for (const c of index.cases) {
    if (patterns.length && !patterns.some((p) => c.dir.includes(p))) {
      continue;
    }
    const snapshot = JSON.parse(
      fs.readFileSync(path.join(CASES_DIR, c.dir, 'snapshot.json'), 'utf8'),
    ) as Snapshot;
    const stats = emptyStats();
    rebuildTree(snapshot.rest.document, indexMains(snapshot), stats);
    add(total, stats);
    if (stats.linked || stats.unlinked) {
      rows.push(
        `${c.dir}  实例 ${stats.linked}/${stats.linked + stats.unlinked}  图层 ${stats.layers}  推断 ${stats.inferred}  多 ${stats.extra} 少 ${stats.missing}`,
      );
    }
  }
  console.log(rows.join('\n'));
  const fields = total.fromMain + total.fromOverrides + total.fromProperties;
  console.log(
    `\n实例 ${total.linked + total.unlinked} 个：连上主组件 ${total.linked}，找不到主组件 ${total.unlinked}，换过主组件 ${total.swapped}`,
  );
  console.log(
    `图层 ${total.layers} 个，字段 ${fields + total.inferred} 个：主组件 ${total.fromMain}，覆盖记录 ${total.fromOverrides}，组件属性 ${total.fromProperties}，推断 ${total.inferred}`,
  );
  console.log(
    `实例比主组件多的图层 ${total.extra}，少的 ${total.missing}；隐藏的嵌套实例按主组件补上 ${total.filled}`,
  );
  const top = Object.entries(total.inferredFields).sort((a, b) => b[1] - a[1]);
  console.log(
    `推断的字段：${top.map(([f, n]) => `${f} ${n}`).join('，') || '无'}`,
  );
}

main();
