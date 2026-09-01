"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CoverageWarning, TimelineItem } from "@/server/contracts/api";
import { fetchApi } from "@/lib/client-api";
import { ui } from "@/lib/ui";
import { Timeline } from "@/components/timeline";

interface RepositorySnapshot {
  runId: string;
  rootSha: string;
  headSha: string;
  firstParentCommitCount: number;
  firstCommitAt: string;
  lastCommitAt: string;
  processedAt: string;
  routeCount: number;
  dependencyCount: number;
  versions: { schema: string; classifier: string; dependencyDetector: string; routeDetector: string };
  coverage: { status: string; warnings: CoverageWarning[] };
}

interface RepositoryResponse {
  id: string;
  owner: string;
  name: string;
  fullName: string;
  canonicalUrl: string;
  defaultBranch: string;
  selectedAppRoot: string | null;
  availability: string;
  activeSnapshot: RepositorySnapshot | null;
  latestRun: { id: string; status: string; kind: string } | null;
}

interface TimelineResponse {
  snapshot: { runId: string; headSha: string } | null;
  items: TimelineItem[];
  pageInfo: { nextCursor: string | null; hasNextPage: boolean };
}

interface LiveRepositoryViewProps {
  repositoryId: string;
}

export function LiveRepositoryView({ repositoryId }: LiveRepositoryViewProps) {
  const [repository, setRepository] = useState<RepositoryResponse | null>(null);
  const [timeline, setTimeline] = useState<TimelineResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

    async function loadRepository(): Promise<void> {
      try {
        const [repositoryData, timelineData] = await Promise.all([
          fetchApi<RepositoryResponse>(`/api/repositories/${repositoryId}`, { signal: controller.signal }),
          fetchApi<TimelineResponse>(`/api/repositories/${repositoryId}/commits?limit=30`, { signal: controller.signal }),
        ]);
        if (!mounted) return;
        setRepository(repositoryData);
        setTimeline(timelineData);
        setError("");
      } catch (caught: unknown) {
        if (!mounted || controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "The repository could not be loaded.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void loadRepository();
    return () => {
      mounted = false;
      controller.abort();
    };
  }, [reloadKey, repositoryId]);

  if (loading && !repository) return <p className="font-mono text-sm text-muted" role="status">Loading repository evidence...</p>;
  if (error && !repository) return <div className={ui.alert} role="alert"><strong>Repository unavailable.</strong><p>{error}</p><button className={`${ui.button} mt-3`} onClick={() => setReloadKey((value) => value + 1)} type="button">Retry repository request</button></div>;
  if (!repository) return null;

  const snapshot = repository.activeSnapshot;
  return <>
    <header className="flex items-end justify-between gap-8 border-b border-line pb-5 max-[800px]:flex-col max-[800px]:items-start"><div><p className={ui.eyebrow}>repository / {repository.fullName}</p><h1 className={ui.title}>{repository.owner}/{repository.name}</h1><div className="mt-3 flex flex-wrap gap-4 font-mono text-xs text-muted"><span>branch {repository.defaultBranch}</span><span>root {repository.selectedAppRoot ?? "."}</span><span>{repository.availability}</span></div></div><a className="font-mono text-xs text-cyan" href={repository.canonicalUrl}>Open source</a></header>
    {error ? <p className="mt-4 text-sm text-negative" role="alert">{error}</p> : null}
    {snapshot ? <>
      <div className={ui.dataGrid} aria-label="Repository summary"><Fact label="history" value={`${snapshot.firstParentCommitCount} complete`} /><Fact label="routes at head" value={String(snapshot.routeCount)} /><Fact label="declared dependencies" value={String(snapshot.dependencyCount)} /><Fact label="coverage warnings" value={`${snapshot.coverage.warnings.length} review`} /></div>
      {snapshot.coverage.warnings.map((warning, index) => <div className={ui.alert} key={`${warning.code}-${warning.path ?? "run"}-${index}`}><strong>Coverage warning.</strong><p>{warning.message} <code>{warning.path ?? "detector-wide"}</code></p></div>)}
      {timeline ? <Timeline commits={timeline.items} repositoryId={repositoryId} /> : <p className="mt-6 text-muted">Timeline evidence is not available yet.</p>}
    </> : <div className={`${ui.alert} mt-6`}><strong>No active snapshot yet.</strong><p>{repository.latestRun ? "The current run is still processing. Open its status page to follow progress." : "Start an import from the home page to create the first snapshot."}</p>{repository.latestRun ? <Link className={`${ui.button} mt-3`} href={`/repositories/${repositoryId}/processing/${repository.latestRun.id}`}>Open {repository.latestRun.kind.toLowerCase()} status</Link> : <Link className={`${ui.button} mt-3`} href="/">Start import</Link>}</div>}
  </>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className={ui.datum}><span className="block text-xs uppercase text-muted">{label}</span><strong className="mt-1 block break-words text-lg">{value}</strong></div>;
}
