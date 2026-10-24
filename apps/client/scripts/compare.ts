import fs from 'node:fs';
import path from 'node:path';

import pixelmatch from 'pixelmatch';
import { type Browser, chromium } from 'playwright';
import { PNG } from 'pngjs';

// See apps/docs/figma-to-tldraw/tech.md §7.

declare const window: { __figmaReady?: boolean; __figmaWarnings?: string[] };

interface CaseSummary {
  name: string;
  dir: string;
  width: number;
  height: number;
}

interface Result {
  dir: string;
  width: number;
  height: number;
  diff: number;
  diffPixels: number;
  sizeMismatch: boolean;
  warnings: string[];
  error?: string;
}

const ROOT = path.resolve(import.meta.dirname, '../../..');
const CASES_DIR = path.join(ROOT, 'cases');
const REPORTS_DIR = path.join(ROOT, 'reports/fidelity');
const BASE_URL = process.env.CANVAS_URL ?? 'http://localhost:5173';
const SHOT_OFFSET = 40;
const SCALE = 2;
const WORKERS = 4;

function matches(dir: string, patterns: string[]): boolean {
  if (patterns.length === 0) {
    return true;
  }
  return patterns.some((p) => {
    const re = new RegExp(
      `^${p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
    );
    return re.test(dir);
  });
}

function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function onWhite(png: PNG): PNG {
  const out = new PNG({ width: png.width, height: png.height });
  for (let i = 0; i < png.data.length; i += 4) {
    const a = png.data[i + 3] / 255;
    for (let c = 0; c < 3; c++) {
      out.data[i + c] = Math.round(png.data[i + c] * a + 255 * (1 - a));
    }
    out.data[i + 3] = 255;
  }
  return out;
}

async function shoot(
  browser: Browser,
  c: CaseSummary,
): Promise<{ png: Buffer; warnings: string[] }> {
  const page = await browser.newPage({
    viewport: {
      width: Math.ceil(c.width) + SHOT_OFFSET * 2 + 200,
      height: Math.ceil(c.height) + SHOT_OFFSET * 2 + 100,
    },
    deviceScaleFactor: SCALE,
  });
  try {
    await page.goto(
      `${BASE_URL}/canvas?case=${encodeURIComponent(c.dir)}&shot=1`,
    );
    await page.waitForFunction(() => window.__figmaReady === true, null, {
      timeout: 30_000,
    });
    const warnings = await page.evaluate(() => window.__figmaWarnings ?? []);
    const png = await page.screenshot({
      clip: {
        x: SHOT_OFFSET,
        y: SHOT_OFFSET,
        width: c.width,
        height: c.height,
      },
    });
    return { png, warnings };
  } finally {
    await page.close();
  }
}

async function compareCase(
  browser: Browser,
  c: CaseSummary,
  outDir: string,
): Promise<Result> {
  const caseOut = path.join(outDir, 'cases', c.dir);
  fs.mkdirSync(caseOut, { recursive: true });
  const expectedRaw = PNG.sync.read(
    fs.readFileSync(path.join(CASES_DIR, c.dir, 'expected@2x.png')),
  );
  const expected = onWhite(expectedRaw);
  fs.writeFileSync(
    path.join(caseOut, 'expected.png'),
    PNG.sync.write(expected),
  );
  const base = { dir: c.dir, width: c.width, height: c.height };
  try {
    const { png, warnings } = await shoot(browser, c);
    fs.writeFileSync(path.join(caseOut, 'actual.png'), png);
    const actual = PNG.sync.read(png);
    if (actual.width !== expected.width || actual.height !== expected.height) {
      return {
        ...base,
        diff: 100,
        diffPixels: expected.width * expected.height,
        sizeMismatch: true,
        warnings: [
          ...warnings,
          `尺寸不一样：期望 ${expected.width}×${expected.height}，实际 ${actual.width}×${actual.height}`,
        ],
      };
    }
    const diff = new PNG({ width: expected.width, height: expected.height });
    const diffPixels = pixelmatch(
      expected.data,
      actual.data,
      diff.data,
      expected.width,
      expected.height,
      { threshold: 0.1 },
    );
    fs.writeFileSync(path.join(caseOut, 'diff.png'), PNG.sync.write(diff));
    return {
      ...base,
      diff: (diffPixels / (expected.width * expected.height)) * 100,
      diffPixels,
      sizeMismatch: false,
      warnings,
    };
  } catch (e) {
    return {
      ...base,
      diff: 100,
      diffPixels: expected.width * expected.height,
      sizeMismatch: false,
      warnings: [],
      error: String(e),
    };
  }
}

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!,
  );
}

function renderReport(results: Result[], startedAt: string): string {
  const sorted = [...results].sort((a, b) => b.diff - a.diff);
  const avg = results.reduce((s, r) => s + r.diff, 0) / results.length;
  const under1 = results.filter((r) => r.diff < 1).length;
  const img = (r: Result, name: string) => {
    const src = `cases/${r.dir.split('/').map(encodeURIComponent).join('/')}/${name}.png`;
    return `<a href="${src}" target="_blank"><img src="${src}" loading="lazy"></a>`;
  };
  const rows = sorted
    .map((r) => {
      const notes = [...(r.error ? [r.error] : []), ...r.warnings]
        .map((w) => `<div class="warn">${escapeHtml(w)}</div>`)
        .join('');
      return `<tr>
  <td><a href="${BASE_URL}/canvas?case=${encodeURIComponent(r.dir)}" target="_blank">${escapeHtml(r.dir)}</a>${notes}</td>
  <td class="num">${r.diff.toFixed(2)}%</td>
  <td>${img(r, 'expected')}</td>
  <td>${img(r, 'actual')}</td>
  <td>${img(r, 'diff')}</td>
</tr>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>还原度报告 ${startedAt}</title>
<style>
  body { font: 14px/1.5 system-ui, sans-serif; margin: 24px; color: #111; }
  h1 { font-size: 20px; margin: 0 0 8px; }
  .summary { display: flex; gap: 24px; margin: 0 0 16px; }
  .summary b { font-size: 20px; display: block; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border-bottom: 1px solid #e5e7eb; padding: 8px; text-align: left; vertical-align: top; }
  td.num { font-variant-numeric: tabular-nums; white-space: nowrap; }
  img { max-width: 240px; max-height: 240px; border: 1px solid #e5e7eb; background: #fff; }
  .warn { color: #b45309; font-size: 12px; }
</style>
</head>
<body>
<h1>还原度报告</h1>
<p>${startedAt}，阈值 0.1，差异 = 不同像素 ÷ 总像素</p>
<div class="summary">
  <div><b>${results.length}</b>用例数</div>
  <div><b>${avg.toFixed(2)}%</b>平均差异</div>
  <div><b>${under1}</b>差异小于 1%</div>
</div>
<table>
<thead><tr><th>用例</th><th>差异</th><th>Figma</th><th>tldraw</th><th>差异图</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>
</body>
</html>
`;
}

async function main() {
  const patterns = process.argv.slice(2);
  const index = JSON.parse(
    fs.readFileSync(path.join(CASES_DIR, 'index.json'), 'utf8'),
  ) as { cases: CaseSummary[] };
  const cases = index.cases.filter((c) => matches(c.dir, patterns));
  if (cases.length === 0) {
    console.error(`没有匹配的用例：${patterns.join(' ')}`);
    process.exit(1);
  }
  try {
    await fetch(`${BASE_URL}/cases/index.json`);
  } catch {
    console.error(`连不上 ${BASE_URL}，请先运行 pnpm dev`);
    process.exit(1);
  }

  const startedAt = timestamp();
  const outDir = path.join(REPORTS_DIR, startedAt);
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  const results: Result[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: WORKERS }, async () => {
      while (next < cases.length) {
        const c = cases[next++];
        const r = await compareCase(browser, c, outDir);
        results.push(r);
        console.log(
          `${String(results.length).padStart(3)}/${cases.length}  ${r.diff.toFixed(2).padStart(6)}%  ${c.dir}${r.error ? '  出错' : ''}`,
        );
      }
    }),
  );
  await browser.close();

  results.sort((a, b) => b.diff - a.diff);
  fs.writeFileSync(
    path.join(outDir, 'results.json'),
    JSON.stringify({ startedAt, results }, null, 2),
  );
  fs.writeFileSync(
    path.join(outDir, 'index.html'),
    renderReport(results, startedAt),
  );
  const latest = path.join(REPORTS_DIR, 'latest');
  fs.rmSync(latest, { force: true });
  fs.symlinkSync(startedAt, latest);

  const avg = results.reduce((s, r) => s + r.diff, 0) / results.length;
  console.log(
    `\n平均差异 ${avg.toFixed(2)}%，小于 1% 的 ${results.filter((r) => r.diff < 1).length}/${results.length}`,
  );
  console.log(`报告：${path.join(outDir, 'index.html')}`);
}

await main();
