import { cn } from '@/lib/utils';

import type { FidelityResult } from '../figma/report';

type Tone = 'good' | 'warning' | 'critical';

const TONE_DOT: Record<Tone, string> = {
  good: 'bg-status-good',
  warning: 'bg-status-warning',
  critical: 'bg-status-critical',
};

export const TONE_LEGEND: { tone: Tone; label: string }[] = [
  { tone: 'good', label: '小于 0.1%' },
  { tone: 'warning', label: '0.1%～1%' },
  { tone: 'critical', label: '1% 以上或出错' },
];

export function verdictOf(r: FidelityResult): { label: string; tone: Tone } {
  if (r.error || r.sizeMismatch) {
    return { label: '出错', tone: 'critical' };
  }
  if (r.diffPixels === 0) {
    return { label: '逐像素一致', tone: 'good' };
  }
  if (r.diff < 0.1) {
    return { label: '几乎一致', tone: 'good' };
  }
  if (r.diff < 1) {
    return { label: '细微差异', tone: 'warning' };
  }
  return { label: '明显差异', tone: 'critical' };
}

export function formatDiff(diff: number): string {
  if (diff === 0) {
    return '0%';
  }
  return diff < 0.01 ? '<0.01%' : `${diff.toFixed(2)}%`;
}

export function ToneDot({ tone }: { tone: Tone }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        TONE_DOT[tone],
      )}
    />
  );
}

export function Score({
  result,
  withLabel,
}: {
  result?: FidelityResult;
  withLabel?: boolean;
}) {
  if (!result) {
    return <span className="text-xs text-muted-foreground">没有结果</span>;
  }
  const verdict = verdictOf(result);
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs whitespace-nowrap tabular-nums"
      title={verdict.label}
    >
      <ToneDot tone={verdict.tone} />
      {formatDiff(result.diff)}
      {withLabel && (
        <span className="text-muted-foreground">{verdict.label}</span>
      )}
    </span>
  );
}
