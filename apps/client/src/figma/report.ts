import type { DiffBreakdown } from './diff-attribution';

// See apps/docs/figma-to-tldraw/tech.md §7 and §10.2.

export interface FidelityResult {
  dir: string;
  width: number;
  height: number;
  diff: number;
  diffPixels: number;
  sizeMismatch: boolean;
  warnings: string[];
  breakdown?: DiffBreakdown;
  error?: string;
}

export interface FidelityReport {
  startedAt: string;
  results: FidelityResult[];
}

const LATEST = '/reports/fidelity/latest/';

export async function loadLatestReport(): Promise<FidelityReport | null> {
  const res = await fetch(`${LATEST}results.json`);
  return res.ok ? ((await res.json()) as FidelityReport) : null;
}

export function reportUrl(dir: string, file: string): string {
  return `${LATEST}cases/${dir.split('/').map(encodeURIComponent).join('/')}/${file}`;
}
