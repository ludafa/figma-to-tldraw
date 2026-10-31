import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FILTER_ORDER, LUT_STEPS } from '../src/figma/image-filters';

// See apps/docs/figma-to-tldraw/tech.md §22.3.

const ROOT = path.resolve(import.meta.dirname, '../../..');
const OUT = path.join(ROOT, 'filter-luts');

function main() {
  const zip = process.argv[2];
  if (!zip) {
    console.error(
      '用法：pnpm --filter @figma-to-tldraw/client import-filter-luts <figma-filter-probe-….zip>',
    );
    process.exit(1);
  }
  const files = [
    'identity.png',
    ...FILTER_ORDER.flatMap((key) =>
      LUT_STEPS.filter((v) => v !== 0).map((v) => `${key}/${v.toFixed(2)}.png`),
    ),
  ];
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'filter-luts-'));
  try {
    execFileSync('unzip', ['-q', zip, 'filter-probe/cube/*', '-d', tmp]);
    const cube = path.join(tmp, 'filter-probe/cube');
    const missing = files.filter((f) => !fs.existsSync(path.join(cube, f)));
    if (missing.length) {
      console.error(`zip 里缺这些色表：${missing.join('、')}`);
      process.exit(1);
    }
    fs.rmSync(OUT, { recursive: true, force: true });
    for (const f of files) {
      fs.mkdirSync(path.dirname(path.join(OUT, f)), { recursive: true });
      fs.copyFileSync(path.join(cube, f), path.join(OUT, f));
    }
    fs.writeFileSync(
      path.join(OUT, 'index.json'),
      `${JSON.stringify(
        {
          source: path.basename(zip),
          importedAt: new Date().toISOString(),
          order: FILTER_ORDER,
          steps: LUT_STEPS,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`${files.length} 张色表 → ${path.relative(ROOT, OUT)}/`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main();
