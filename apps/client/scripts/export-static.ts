import fs from 'node:fs';
import path from 'node:path';

import type { FidelityReport } from '../src/figma/report';
import type { CaseIndex } from '../src/figma/types';

// See apps/docs/figma-to-tldraw/tech.md §18.

const ROOT = path.resolve(import.meta.dirname, '../../..');
const CASES_DIR = path.join(ROOT, 'cases');
const REPORT_DIR = path.join(ROOT, 'reports/fidelity/latest');
const DIST = path.resolve(import.meta.dirname, '../dist');
const OUT = path.join(ROOT, '.deploy');

const VERCEL_CONFIG = {
  redirects: [{ source: '/', destination: '/showcase', permanent: false }],
  rewrites: [
    {
      source: '/((?!assets/|cases/|reports/).*)',
      destination: '/index.html',
    },
  ],
};

const REPORT_NOTICE = `<!doctype html>
<html lang="zh-CN">
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>原始对比报告</title>
<body style="font: 15px/1.7 system-ui, sans-serif; max-width: 36rem; margin: 4rem auto; padding: 0 16px">
<h1 style="font-size: 20px">原始对比报告没有发布</h1>
<p>原始报告每个用例有三张 2 倍大图，加起来六百多 MB，只在本地运行对比脚本时生成。线上的展示页里每个用例都有 Figma 截图、tldraw 画布和差异图。</p>
<p><a href="/showcase">← 回到展示页</a></p>
</body>
</html>
`;

function matches(dir: string, patterns: string[]): boolean {
  return !patterns.length || patterns.some((p) => dir.includes(p));
}

function copyFile(from: string, to: string) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function sizeOf(dir: string): {
  bytes: number;
  files: number;
  largest: string;
} {
  let bytes = 0;
  let files = 0;
  let largest = { file: '', size: 0 };
  for (const entry of fs.readdirSync(dir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile() || entry.parentPath.includes('.vercel')) {
      continue;
    }
    const file = path.join(entry.parentPath, entry.name);
    const size = fs.statSync(file).size;
    bytes += size;
    files++;
    if (size > largest.size) {
      largest = { file, size };
    }
  }
  return {
    bytes,
    files,
    largest: `${path.relative(dir, largest.file)}（${(largest.size / 1e6).toFixed(1)} MB）`,
  };
}

function main() {
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    console.error('先运行 pnpm --filter @figma-to-tldraw/client build');
    process.exit(1);
  }
  const patterns = process.argv.slice(2);
  fs.mkdirSync(OUT, { recursive: true });
  for (const entry of fs.readdirSync(OUT)) {
    if (entry !== '.vercel') {
      fs.rmSync(path.join(OUT, entry), { recursive: true, force: true });
    }
  }
  fs.cpSync(DIST, OUT, { recursive: true });

  const index = JSON.parse(
    fs.readFileSync(path.join(CASES_DIR, 'index.json'), 'utf8'),
  ) as CaseIndex;
  const cases = index.cases.filter((c) => matches(c.dir, patterns));
  fs.mkdirSync(path.join(OUT, 'cases'), { recursive: true });
  fs.writeFileSync(
    path.join(OUT, 'cases/index.json'),
    JSON.stringify({ ...index, cases }),
  );

  for (const c of cases) {
    const from = path.join(CASES_DIR, c.dir);
    const to = path.join(OUT, 'cases', c.dir);
    fs.mkdirSync(to, { recursive: true });
    const snapshot: unknown = JSON.parse(
      fs.readFileSync(path.join(from, 'snapshot.json'), 'utf8'),
    );
    fs.writeFileSync(path.join(to, 'snapshot.json'), JSON.stringify(snapshot));
    copyFile(
      path.join(from, 'expected@2x.png'),
      path.join(to, 'expected@2x.png'),
    );
    if (fs.existsSync(path.join(from, 'images'))) {
      fs.cpSync(path.join(from, 'images'), path.join(to, 'images'), {
        recursive: true,
      });
    }
  }

  const reportFile = path.join(REPORT_DIR, 'results.json');
  if (fs.existsSync(reportFile)) {
    const report = JSON.parse(
      fs.readFileSync(reportFile, 'utf8'),
    ) as FidelityReport;
    const dirs = new Set(cases.map((c) => c.dir));
    const results = report.results.filter((r) => dirs.has(r.dir));
    const reportOut = path.join(OUT, 'reports/fidelity/latest');
    fs.mkdirSync(reportOut, { recursive: true });
    fs.writeFileSync(
      path.join(reportOut, 'results.json'),
      JSON.stringify({ ...report, results }),
    );
    fs.writeFileSync(path.join(reportOut, 'index.html'), REPORT_NOTICE);
    for (const r of results) {
      const diff = path.join(REPORT_DIR, 'cases', r.dir, 'diff.png');
      if (fs.existsSync(diff)) {
        copyFile(diff, path.join(reportOut, 'cases', r.dir, 'diff.png'));
      }
    }
  } else {
    console.warn('没有对比报告（reports/fidelity/latest），展示页不显示分数');
  }

  fs.writeFileSync(path.join(OUT, '.vercelignore'), '.env*\n.gitignore\n');
  fs.writeFileSync(
    path.join(OUT, 'vercel.json'),
    `${JSON.stringify(VERCEL_CONFIG, null, 2)}\n`,
  );

  const { bytes, files, largest } = sizeOf(OUT);
  console.log(
    `${cases.length} 个用例 → ${path.relative(ROOT, OUT)}/：${files} 个文件，${(bytes / 1e6).toFixed(0)} MB，最大的 ${largest}`,
  );
}

main();
