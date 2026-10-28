import { type Browser, chromium, type Page } from 'playwright';

// See apps/docs/skia-engine/verification.md §2.

const BASE_URL = process.env.CANVAS_URL ?? 'http://localhost:5173';
const DURATION_MS = 2000;
const CASES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      'real/golio---free-landing-page-ui-kit-design/pre-made-templates-consulting-company-website',
      'real/untitled-ui-free-figma-ui-kit-and-design/dashboards-desktop-2',
    ];

type Op = 'pan' | 'zoom' | 'drag-free' | 'drag-auto-layout';
const OPS: Op[] = ['pan', 'zoom', 'drag-free', 'drag-auto-layout'];

interface OpResult {
  op: Op;
  frames: number;
  fps: number;
  p95Ms: number;
  maxMs: number;
  /** Gaps over two 60Hz frames: at least one frame missed. */
  long: number;
  cpuMs: number;
  note?: string;
  /** The case has nothing to drive this operation on (e.g. no free-layout layer). */
  skipped?: boolean;
}

/** Runs inside the page: drives one operation by synthetic events for DURATION_MS. */
const DRIVER = `async (op, duration) => {
  const engine = await import('/src/engine/index.ts');
  const editor = window.editor;
  const ctrl = engine.getCanvasController(editor);
  const canvas = ctrl.canvas;
  const rect = canvas.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const fire = (type, x, y, extra = {}) =>
    canvas.dispatchEvent(new PointerEvent(type, {
      clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true,
      button: 0, buttons: type === 'pointerup' ? 0 : 1, bubbles: true, cancelable: true, ...extra,
    }));
  const wheel = (dx, dy, ctrlKey) =>
    canvas.dispatchEvent(new WheelEvent('wheel', {
      clientX: cx, clientY: cy, deltaX: dx, deltaY: dy, ctrlKey, bubbles: true, cancelable: true,
    }));
  const isFigma = (s) => s && s.type.startsWith('figma-');
  const layoutOf = (s) => s && s.props && s.props.node && s.props.node.layoutMode;
  const view = editor.getViewportPageBounds();
  const z = editor.getZoomLevel();
  const margin = 20 / z;
  const visible = (s) => {
    const b = editor.getShapePageBounds(s);
    return b && b.w * z > 24 && b.h * z > 16 && b.w < view.w * 0.6 && b.h < view.h * 0.6 &&
      b.x > view.x + margin && b.y > view.y + margin && b.maxX < view.maxX - margin && b.maxY < view.maxY - margin;
  };
  const shapes = editor.getCurrentPageShapesSorted();
  let target = null;
  let axis = null;
  let span = 0;
  if (op === 'drag-free') {
    // A layer in a free-layout frame; else a whole board on the page.
    const free = (s, top) => {
      const p = editor.getShape(s.parentId);
      return isFigma(s) && !!p !== top && (!p || !layoutOf(p) || layoutOf(p) === 'NONE') && visible(s) && !s.props.node.isMask;
    };
    target = shapes.find((s) => free(s, false)) || shapes.find((s) => free(s, true));
  } else if (op === 'drag-auto-layout') {
    for (const s of shapes) {
      const p = editor.getShape(s.parentId);
      const mode = layoutOf(p);
      if (!isFigma(s) || (mode !== 'VERTICAL' && mode !== 'HORIZONTAL') || !visible(s)) continue;
      const sibs = editor.getSortedChildIdsForParent(p.id);
      if (sibs.length < 3) continue;
      target = s;
      axis = mode === 'VERTICAL' ? 'y' : 'x';
      const pb = editor.getShapePageBounds(p);
      span = Math.min(axis === 'y' ? pb.h : pb.w, 400) * editor.getZoomLevel();
      break;
    }
  }
  if ((op === 'drag-free' || op === 'drag-auto-layout') && !target) {
    return { error: 'no target shape for ' + op };
  }
  let px = cx;
  let py = cy;
  if (target) {
    editor.select(target.id);
    const b = editor.getShapePageBounds(target);
    const p = editor.pageToScreen({ x: b.midX, y: b.midY });
    px = p.x;
    py = p.y;
    fire('pointerdown', px, py);
  }
  const frames = [];
  const cpu = [];
  const start = performance.now();
  let i = 0;
  let translated = false;
  await new Promise((resolve) => {
    const tick = (t) => {
      frames.push(t);
      cpu.push(ctrl.stats.lastFrameMs);
      const k = i++;
      if (op === 'pan') {
        const dir = Math.floor(k / 60) % 2 ? -1 : 1;
        wheel(0, 20 * dir, false);
      } else if (op === 'zoom') {
        const dir = Math.floor(k / 30) % 2 ? -1 : 1;
        wheel(0, 2 * dir, true);
      } else if (op === 'drag-free') {
        const dir = Math.floor(k / 40) % 2 ? -1 : 1;
        px += 4 * dir;
        py += 3 * dir;
        fire('pointermove', px, py);
      } else {
        const per = Math.max(3, span / 60);
        const phase = Math.floor(k / 60) % 2 ? -1 : 1;
        if (axis === 'y') py += per * phase; else px += per * phase;
        fire('pointermove', px, py);
      }
      translated ||= editor.isIn('select.translating');
      if (t - start < duration) {
        requestAnimationFrame(tick);
      } else {
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });
  if (target) {
    fire('pointerup', px, py);
  }
  return { frames, cpu, translated, target: target && target.id };
}`;

/** Opens a case, or a page path (`/demo`, optionally `/demo@<case dir>` to zoom to one case). */
async function openCase(page: Page, target: string) {
  const [path, focus] = target.startsWith('/') ? target.split('@') : [];
  await page.goto(
    path
      ? `${BASE_URL}${path}`
      : `${BASE_URL}/canvas?case=${encodeURIComponent(target)}`,
  );
  await page.waitForFunction(
    () => (globalThis as { __figmaReady?: boolean }).__figmaReady === true,
    null,
    {
      timeout: 180_000,
    },
  );
  if (focus) {
    await page.evaluate(`(() => {
      const editor = window.editor;
      const prefix = 'shape:figma:' + ${JSON.stringify(focus)} + ':';
      const roots = editor.getCurrentPageShapes()
        .filter((s) => s.id.startsWith(prefix) && !editor.getShape(s.parentId));
      const boxes = roots.map((s) => editor.getShapePageBounds(s));
      const x = Math.min(...boxes.map((b) => b.x));
      const y = Math.min(...boxes.map((b) => b.y));
      const w = Math.max(...boxes.map((b) => b.maxX)) - x;
      const h = Math.max(...boxes.map((b) => b.maxY)) - y;
      editor.zoomToBounds({ x, y, w, h }, { inset: 64 });
    })()`);
    await page.waitForFunction(
      `(async () => {
        const engine = await import('/src/engine/index.ts');
        await engine.getCanvasController(window.editor).whenIdle();
        return true;
      })()`,
      null,
      { timeout: 120_000 },
    );
  }
  await page.waitForTimeout(2000);
}

function summarize(op: Op, r: { frames: number[]; cpu: number[] }): OpResult {
  const gaps = r.frames.slice(1).map((t, i) => t - r.frames[i]);
  const total = r.frames[r.frames.length - 1] - r.frames[0];
  const sorted = [...gaps].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const cpu = r.cpu.slice(1);
  return {
    op,
    frames: gaps.length,
    fps: (gaps.length / total) * 1000,
    p95Ms: p95,
    maxMs: sorted[sorted.length - 1] ?? 0,
    long: gaps.filter((g) => g > 2000 / 60).length,
    cpuMs: cpu.reduce((s, v) => s + v, 0) / Math.max(1, cpu.length),
  };
}

/** The display's refresh rate, from the median rAF interval of an idle page. */
async function refreshRate(browser: Browser): Promise<number> {
  const page = await browser.newPage();
  const ms = (await page.evaluate(`new Promise((resolve) => {
    const t = [];
    const tick = (now) => {
      t.push(now);
      if (t.length < 61) requestAnimationFrame(tick);
      else {
        const gaps = t.slice(1).map((v, i) => v - t[i]).sort((a, b) => a - b);
        resolve(gaps[30]);
      }
    };
    requestAnimationFrame(tick);
  })`)) as number;
  await page.close();
  return 1000 / ms;
}

async function main() {
  const browser = await chromium.launch({
    headless: false,
    args: ['--enable-gpu', '--ignore-gpu-blocklist'],
  });
  const hz = await refreshRate(browser);
  // A 60Hz display caps rAF at 60, where timer jitter alone reads 59.9.
  const target = Math.min(60, hz) - 0.5;
  console.log(
    `显示器刷新率约 ${hz.toFixed(0)}Hz，达标线 ${target.toFixed(1)}fps`,
  );
  const results: Record<string, OpResult[]> = {};
  for (const dir of CASES) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    const out: OpResult[] = [];
    for (const op of OPS) {
      await openCase(page, dir);
      const r = (await page.evaluate(
        `(${DRIVER})(${JSON.stringify(op)}, ${DURATION_MS})`,
      )) as {
        frames: number[];
        cpu: number[];
        translated?: boolean;
        target?: string;
        error?: string;
      };
      if (r.error) {
        out.push({
          op,
          frames: 0,
          fps: 0,
          p95Ms: 0,
          maxMs: 0,
          long: 0,
          cpuMs: 0,
          note: r.error,
          skipped: true,
        });
        console.log(`${dir}  ${op.padEnd(17)} 跳过：${r.error}`);
        continue;
      }
      const s = summarize(op, r);
      if (op.startsWith('drag') && !r.translated) {
        s.note = `没有进入拖动状态（${r.target}）`;
      }
      out.push(s);
      console.log(
        `${dir}  ${op.padEnd(17)} ${s.fps.toFixed(1).padStart(6)} fps  p95 ${s.p95Ms.toFixed(1)}ms  max ${s.maxMs.toFixed(1)}ms  long ${s.long}  cpu ${s.cpuMs.toFixed(2)}ms${s.note ? `  ${s.note}` : ''}`,
      );
    }
    results[dir] = out;
    await page.close();
  }
  await browser.close();
  const all = Object.values(results).flat();
  const failing = all.filter((r) => !r.skipped && (r.fps < target || r.note));
  console.log(failing.length ? `\n未达标 ${failing.length} 项` : '\n全部达标');
  process.exitCode = failing.length ? 1 : 0;
}

await main();
