"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CoverageWarning, TimelineItem } from "@/server/contracts/api";
import type { RunStatus } from "@/server/contracts/processing";
import { ApiError, fetchApi } from "@/lib/client-api";
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
  latestRun: {
    id: string;
    status: RunStatus;
    kind: "IMPORT" | "REFRESH" | "REPROCESS";
    error: { code: string; message: string | null } | null;
  } | null;
}

interface TimelineResponse {
  snapshot: { runId: string; headSha: string } | null;
  items: TimelineItem[];
  pageInfo: { nextCursor: string | null; hasNextPage: boolean };
}

interface LiveRepositoryViewProps {
  repositoryId: string;
}

const PAGE_LIMIT = 30;
const VALID_EVENTS = ["ALL", "ROUTE", "DEPENDENCY"] as const;
const ACTIVE_REFRESH_STATUSES = new Set<RunStatus>([
  "NEEDS_CONFIGURATION",
  "QUEUED",
  "RUNNING",
  "WAITING_RATE_LIMIT",
  "RETRYABLE",
]);

function sanitizeEvent(value: string | null): string {
  return value !== null && (VALID_EVENTS as readonly string[]).includes(value) ? value : "ALL";
}

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}

function timelineQuery(cursor: string | null, query: string, event: string): string {
  const params = new URLSearchParams({ limit: String(PAGE_LIMIT) });
  if (cursor) params.set("cursor", cursor);
  if (query) params.set("query", query);
  if (event !== "ALL") params.set("event", event);
  return params.toString();
}

export function LiveRepositoryView({ repositoryId }: LiveRepositoryViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = searchParams.get("query") ?? "";
  const event = sanitizeEvent(searchParams.get("event"));

  const [repository, setRepository] = useState<RepositoryResponse | null>(null);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [pageInfo, setPageInfo] = useState<TimelineResponse["pageInfo"]>({ nextCursor: null, hasNextPage: false });
  const [timelineLoaded, setTimelineLoaded] = useState(false);
  const [mismatch, setMismatch] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState("");
  const [refreshError, setRefreshError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

    async function loadRepository(): Promise<void> {
      try {
        const repositoryData = await fetchApi<RepositoryResponse>(`/api/repositories/${repositoryId}`, { signal: controller.signal });
        if (!mounted) return;
        setRepository(repositoryData);
        setError("");
      } catch (caught: unknown) {
        if (!mounted || controller.signal.aborted) return;
        setError(errorMessage(caught, "The repository could not be loaded."));
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

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

    async function loadTimeline(): Promise<void> {
      try {
        const timelineData = await fetchApi<TimelineResponse>(`/api/repositories/${repositoryId}/commits?${timelineQuery(null, query, event)}`, { signal: controller.signal });
        if (!mounted) return;
        setItems(timelineData.items);
        setPageInfo(timelineData.pageInfo);
        setError("");
      } catch (caught: unknown) {
        if (!mounted || controller.signal.aborted) return;
        setError(errorMessage(caught, "The timeline could not be loaded."));
      } finally {
        if (mounted) setTimelineLoaded(true);
      }
    }

    void loadTimeline();
    return () => {
      mounted = false;
      controller.abort();
    };
  }, [reloadKey, repositoryId, query, event]);

  function updateFilters(nextQuery: string, nextEvent: string): void {
    setTimelineLoaded(false);
    setMismatch(null);
    const params = new URLSearchParams();
    if (nextQuery) params.set("query", nextQuery);
    if (nextEvent !== "ALL") params.set("event", nextEvent);
    const search = params.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  }

  function clearFilters(): void {
    updateFilters("", "ALL");
  }

  async function loadOlder(): Promise<void> {
    if (!pageInfo.hasNextPage || !pageInfo.nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const timelineData = await fetchApi<TimelineResponse>(`/api/repositories/${repositoryId}/commits?${timelineQuery(pageInfo.nextCursor, query, event)}`);
      setItems((previous) => [...previous, ...timelineData.items]);
      setPageInfo(timelineData.pageInfo);
    } catch (caught: unknown) {
      if (caught instanceof ApiError && caught.code === "CURSOR_SNAPSHOT_MISMATCH") {
        setMismatch(caught.message);
      } else {
        setError(errorMessage(caught, "Older commits could not be loaded."));
      }
    } finally {
      setLoadingOlder(false);
    }
  }

  function reloadFromTop(): void {
    setMismatch(null);
    setReloadKey((value) => value + 1);
  }

  async function startRefresh(): Promise<void> {
    if (refreshing) return;
    setRefreshing(true);
    setRefreshError("");

    try {
      const result = await fetchApi<{ repositoryId: string; run: { id: string; status: "QUEUED" | "NEEDS_CONFIGURATION" } }>(
        `/api/repositories/${repositoryId}/refresh`,
        { method: "POST" },
      );
      router.push(`/repositories/${result.repositoryId}/processing/${result.run.id}`);
    } catch (caught: unknown) {
      setRefreshError(errorMessage(caught, "The repository could not be queued for refresh."));
    } finally {
      setRefreshing(false);
    }
  }

  if (loading && !repository) return <p className="font-mono text-sm text-muted" role="status">Loading repository evidence...</p>;
  if (error && !repository) return <div className={ui.alert} role="alert"><strong>Repository unavailable.</strong><p>{error}</p><button className={`${ui.button} mt-3`} onClick={() => setReloadKey((value) => value + 1)} type="button">Retry repository request</button></div>;
  if (!repository) return null;

  const snapshot = repository.activeSnapshot;
  const latestRefresh = repository.latestRun?.kind === "REFRESH" ? repository.latestRun : null;
  const refreshInProgress = latestRefresh ? ACTIVE_REFRESH_STATUSES.has(latestRefresh.status) : false;
  const visibleRefresh = latestRefresh?.status === "SUCCEEDED" ? null : latestRefresh;
  return <>
    <header className="flex items-end justify-between gap-8 border-b border-line pb-5 max-[800px]:flex-col max-[800px]:items-start"><div><p className={ui.eyebrow}>repository / {repository.fullName}</p><h1 className={ui.title}>{repository.owner}/{repository.name}</h1><div className="mt-3 flex flex-wrap gap-4 font-mono text-xs text-muted"><span>branch {repository.defaultBranch}</span><span>root {repository.selectedAppRoot ?? "."}</span><span>{repository.availability}</span></div></div><div className="flex flex-wrap items-center gap-3"><button aria-describedby={refreshInProgress ? "refresh-state" : undefined} className={`${ui.primaryButton} disabled:cursor-wait disabled:opacity-60`} disabled={!snapshot || refreshing || refreshInProgress} onClick={() => void startRefresh()} type="button">{refreshing ? "Checking GitHub..." : refreshInProgress ? "Refresh in progress" : "Refresh from GitHub"}</button><a className="inline-flex min-h-11 items-center font-mono text-xs text-cyan" href={repository.canonicalUrl}>Open source</a></div></header>
    {error ? <p className="mt-4 text-sm text-negative" role="alert">{error}</p> : null}
    {refreshError ? <div className={ui.alert} role="alert"><strong>Refresh could not start.</strong><p>{refreshError}</p><p>The current snapshot remains available.</p></div> : null}
    {snapshot ? <>
      {visibleRefresh ? <RefreshNotice repositoryId={repositoryId} run={visibleRefresh} snapshot={snapshot} /> : null}
      <div className={ui.dataGrid} aria-label="Repository summary"><Fact label="history" value={`${snapshot.firstParentCommitCount} complete`} /><Fact label="routes at head" value={String(snapshot.routeCount)} /><Fact label="declared dependencies" value={String(snapshot.dependencyCount)} /><Fact label="coverage warnings" value={`${snapshot.coverage.warnings.length} review`} /></div>
      {snapshot.coverage.warnings.map((warning, index) => <div className={ui.alert} key={`${warning.code}-${warning.path ?? "run"}-${index}`}><strong>Coverage warning.</strong><p>{warning.message} <code className="break-all">{warning.path ?? "detector-wide"}</code></p></div>)}
      {timelineLoaded ? <Timeline commits={items} repositoryId={repositoryId} query={query} event={event} onQueryChange={(value) => updateFilters(value, event)} onEventChange={(value) => updateFilters(query, value)} onClearFilters={clearFilters} onLoadOlder={() => void loadOlder()} hasNextPage={pageInfo.hasNextPage} loadingOlder={loadingOlder} mismatch={mismatch} onReloadFromTop={reloadFromTop} /> : <p className="mt-6 font-mono text-sm text-muted" role="status">Loading timeline...</p>}
    </> : <div className={`${ui.alert} mt-6`}><strong>No active snapshot yet.</strong><p>{repository.latestRun ? "The current run is still processing. Open its status page to follow progress." : "Start an import from the home page to create the first snapshot."}</p>{repository.latestRun ? <Link className={`${ui.button} mt-3`} href={`/repositories/${repositoryId}/processing/${repository.latestRun.id}`}>Open {repository.latestRun.kind.toLowerCase()} status</Link> : <Link className={`${ui.button} mt-3`} href="/">Start import</Link>}</div>}
  </>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className={ui.datum}><span className="block text-xs uppercase text-muted">{label}</span><strong className="mt-1 block break-words text-lg">{value}</strong></div>;
}

function RefreshNotice({ repositoryId, run, snapshot }: {
  repositoryId: string;
  run: NonNullable<RepositoryResponse["latestRun"]>;
  snapshot: RepositorySnapshot;
}) {
  const statusUrl = `/repositories/${repositoryId}/processing/${run.id}`;
  const shortHead = snapshot.headSha.slice(0, 7);

  if (run.status === "FAILED") {
    return <div className={ui.alert} id="refresh-state" role="alert"><strong>Refresh failed.</strong><p>{run.error?.message ?? "The latest GitHub data could not be processed."}</p><p>Snapshot <code>{shortHead}</code> remains active and its timeline is still available.</p><p className="font-mono text-xs">Error code: <code className="break-all">{run.error?.code ?? "PROCESSING_FAILED"}</code></p><Link className={`${ui.button} mt-3`} href={statusUrl}>Review refresh error</Link></div>;
  }

  if (run.status === "CANCELLED") {
    return <div className={ui.alert} id="refresh-state" role="status"><strong>Refresh cancelled.</strong><p>No snapshot was changed. You are still viewing <code>{shortHead}</code>.</p><Link className={`${ui.button} mt-3`} href={statusUrl}>Open refresh status</Link></div>;
  }

  if (run.status === "NEEDS_CONFIGURATION") {
    return <div className={ui.alert} id="refresh-state" role="status"><strong>Refresh needs an application root.</strong><p>Snapshot <code>{shortHead}</code> remains active while the new root is selected.</p><Link className={`${ui.button} mt-3`} href={statusUrl}>Open refresh status</Link></div>;
  }

  return <div className={ui.alert} id="refresh-state" role="status"><strong>Refresh in progress.</strong><p>You are viewing active snapshot <code>{shortHead}</code> while new GitHub evidence is processed.</p><Link className={`${ui.button} mt-3`} href={statusUrl}>Open refresh status</Link></div>;
}
