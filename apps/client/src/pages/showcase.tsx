import { getRouteApi, Link } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';

import { loadCaseIndex } from '../figma/load';
import { type FidelityReport, loadLatestReport } from '../figma/report';
import type { CaseIndex } from '../figma/types';
import { CaseDetail } from '../showcase/case-detail';
import { CaseList } from '../showcase/case-list';
import { groupCases, groupKey } from '../showcase/groups';

// See apps/docs/figma-to-tldraw/tech.md §10.

const route = getRouteApi('/showcase');

export function ShowcasePage() {
  const search = route.useSearch();
  const navigate = route.useNavigate();
  const [index, setIndex] = useState<CaseIndex | null>(null);
  const [report, setReport] = useState<FidelityReport | null | undefined>();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadCaseIndex()
      .then(setIndex)
      .catch((e: unknown) => setError(String(e)));
    loadLatestReport()
      .then(setReport)
      .catch(() => setReport(null));
  }, []);

  const groups = useMemo(() => (index ? groupCases(index) : []), [index]);
  const ordered = useMemo(() => groups.flatMap((g) => g.cases), [groups]);
  const results = useMemo(
    () => new Map((report?.results ?? []).map((r) => [r.dir, r])),
    [report],
  );
  const at = ordered.findIndex((c) => c.dir === search.case);
  const prev = at > 0 ? ordered[at - 1] : undefined;
  const next = at >= 0 ? ordered[at + 1] : undefined;

  useEffect(() => {
    if (at < 0) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        target?.closest('input, textarea, .tl-container')
      ) {
        return;
      }
      const to =
        e.key === 'ArrowLeft' ? prev : e.key === 'ArrowRight' ? next : null;
      if (to) {
        void navigate({ search: { case: to.dir } });
      } else if (e.key === 'Escape') {
        void navigate({ search: {} });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [at, prev, next, navigate]);

  if (error) {
    return <p className="p-6 text-sm text-destructive">{error}</p>;
  }
  if (!index) {
    return <p className="p-6 text-sm text-muted-foreground">读取用例……</p>;
  }
  if (search.case && at < 0) {
    return (
      <div className="space-y-2 p-6 text-sm">
        <p>没有这个用例：{search.case}</p>
        <Link to="/showcase" className="underline underline-offset-4">
          回到全部用例
        </Link>
      </div>
    );
  }
  if (at >= 0) {
    const entry = ordered[at];
    return (
      <CaseDetail
        key={entry.dir}
        index={index}
        group={groups.find((g) => g.key === groupKey(entry.dir))!}
        entry={entry}
        result={results.get(entry.dir)}
        prev={prev}
        next={next}
      />
    );
  }
  return (
    <CaseList index={index} groups={groups} results={results} report={report} />
  );
}
