"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CommitEvidence, DependencyChange, TimelineEventSummary, TimelineItem } from "@/server/contracts/api";
import { commitCategories } from "@/server/contracts/processing";
import type { TimelineFilters } from "@/lib/timeline-filters";
import { fetchApi } from "@/lib/client-api";
import { splitCommitMessage } from "@/lib/commit-message";
import { ui } from "@/lib/ui";

type TimelineCommit = CommitEvidence | TimelineItem;

interface TimelineProps {
  commits: TimelineCommit[];
  repositoryId?: string;
  query: string;
  event: string;
  onQueryChange: (value: string) => void;
  onEventChange: (value: string) => void;
  onClearFilters: () => void;
  onLoadOlder?: () => void;
  hasNextPage?: boolean;
  loadingOlder?: boolean;
  mismatch?: string | null;
  onReloadFromTop?: () => void;
  filters?: TimelineFilters;
  onFiltersChange?: (filters: Partial<TimelineFilters>) => void;
  filterSearch?: string;
  loading?: boolean;
}

function getSummary(commit: TimelineCommit): TimelineEventSummary {
  if ("eventSummary" in commit) return commit.eventSummary;
  return {
    routesAdded: commit.routeChanges.filter((change) => change.type === "ADDED").length,
    routesRemoved: commit.routeChanges.filter((change) => change.type === "REMOVED").length,
    dependenciesAdded: commit.dependencyChanges.filter((change) => change.type === "ADDED").length,
    dependenciesRemoved: commit.dependencyChanges.filter((change) => change.type === "REMOVED").length,
    dependenciesUpdated: commit.dependencyChanges.filter((change) => change.type === "UPDATED").length,
  };
}

function getDependencyChanges(commit: TimelineCommit): DependencyChange[] {
  if ("dependencyChanges" in commit) return commit.dependencyChanges;
  return [];
}

function getRouteChanges(commit: TimelineCommit): CommitEvidence["routeChanges"] {
  if ("routeChanges" in commit) return commit.routeChanges;
  return [];
}

function EventSummary({ summary, dependencies, routes }: { summary: TimelineEventSummary; dependencies: DependencyChange[]; routes: CommitEvidence["routeChanges"] }) {
  const hasDetailedChanges = dependencies.length > 0 || routes.length > 0;
  return <ul className="my-3 list-none p-0 font-mono text-xs leading-loose">
    {routes.map((change) => <li key={`${change.type}-${change.route}`}><span className={change.type === "ADDED" ? ui.positive : ui.negative}>{change.type === "ADDED" ? "+ route" : "- route"}</span> <code>{change.route}</code></li>)}
    {hasDetailedChanges ? dependencies.map((change) => <li key={`${change.type}-${change.packageName}`}><span className={change.type === "ADDED" ? ui.positive : change.type === "REMOVED" ? ui.negative : ui.signal}>{change.type === "ADDED" ? "+ dependency" : change.type === "REMOVED" ? "- dependency" : "~ dependency"}</span> <code>{change.packageName}</code> {change.previousValue && change.currentValue ? `${change.previousValue} to ${change.currentValue}` : change.currentValue ?? change.previousValue}</li>) : null}
    {!hasDetailedChanges && summary.routesAdded > 0 ? <li><span className={ui.positive}>+ route changes</span> <strong>{summary.routesAdded}</strong></li> : null}
    {!hasDetailedChanges && summary.routesRemoved > 0 ? <li><span className={ui.negative}>- route changes</span> <strong>{summary.routesRemoved}</strong></li> : null}
    {!hasDetailedChanges && summary.dependenciesAdded > 0 ? <li><span className={ui.positive}>+ dependency changes</span> <strong>{summary.dependenciesAdded}</strong></li> : null}
    {!hasDetailedChanges && summary.dependenciesRemoved > 0 ? <li><span className={ui.negative}>- dependency changes</span> <strong>{summary.dependenciesRemoved}</strong></li> : null}
    {!hasDetailedChanges && summary.dependenciesUpdated > 0 ? <li><span className={ui.signal}>~ dependency updates</span> <strong>{summary.dependenciesUpdated}</strong></li> : null}
  </ul>;
}

export function Timeline(props: TimelineProps) {
  const { commits, repositoryId = "demo", onClearFilters, onLoadOlder, hasNextPage = false,
    loadingOlder = false, mismatch, onReloadFromTop, loading = false, filterSearch = "" } = props;

  useEffect(() => {
    if (commits.length === 0) return;

    const focusReturnKey = `reporeplay:timeline-focus:${repositoryId}`;
    let targetHref: string | null;
    try {
      targetHref = window.sessionStorage.getItem(focusReturnKey);
    } catch {
      return;
    }
    if (!targetHref) return;

    const targetUrl = new URL(targetHref, window.location.origin);
    const trigger = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
      .find((link) => link.pathname === targetUrl.pathname && link.search === targetUrl.search);
    if (!trigger) return;

    trigger.focus();
    try {
      window.sessionStorage.removeItem(focusReturnKey);
    } catch {
      return;
    }
  }, [commits, repositoryId]);

  return <div className="mt-6 grid grid-cols-[15rem_minmax(0,1fr)] gap-4 max-[800px]:grid-cols-1">
    <FilterPanel {...props} />
    <section aria-labelledby="timeline-title" aria-busy={loading || loadingOlder}>
      <h2 className={ui.sectionTitle} id="timeline-title">Observable transitions</h2>
      <p className="mt-2 font-mono text-xs text-muted">Complete first-parent history · newest first</p>
      {mismatch ? <div className={`${ui.alert} mt-3`} role="alert"><strong>Newer snapshot available.</strong><p>{mismatch}</p>{onReloadFromTop ? <button className={`${ui.button} mt-3`} onClick={onReloadFromTop} type="button">Reload from top</button> : null}</div> : null}
      {loading ? <p className="mt-4 text-sm text-muted" role="status">Loading timeline...</p> : commits.length ? <div className="mt-3 border border-line bg-panel">
        {commits.map((commit) => <CommitRow commit={commit} repositoryId={repositoryId} filterSearch={filterSearch} key={commit.sha} />)}
      </div> : <div className="mt-3 flex items-center justify-between gap-4 border border-line bg-panel p-5 max-[560px]:flex-col max-[560px]:items-stretch"><p className="m-0" role="status" aria-live="polite">No commits match these filters.</p><button className={ui.button} onClick={onClearFilters} type="button">Clear filters</button></div>}
      {onLoadOlder && hasNextPage ? <button className={`${ui.button} mt-4 w-full`} disabled={loadingOlder || Boolean(mismatch)} onClick={onLoadOlder} type="button">{loadingOlder ? "Loading older commits..." : "Load older commits"}</button> : null}
    </section>
  </div>;
}

function FilterPanel({ query, event, onQueryChange, onEventChange, filters, onFiltersChange, onClearFilters }: TimelineProps) {
  const reversedDates = Boolean(filters?.from && filters.to && filters.from > filters.to);
  return <aside className="sticky top-4 self-start border border-line bg-panel p-4 max-[800px]:static" aria-label="Timeline filters">
    <h2 className="font-mono text-base">Filter record</h2>
    <label className="mt-4 block text-sm font-semibold text-muted">Keyword<input className={`${ui.input} mt-1`} onChange={(event) => onQueryChange(event.target.value)} placeholder="authentication" type="search" value={query} /></label>
    <label className="mt-4 block text-sm font-semibold text-muted">Evidence<select className={`${ui.input} mt-1`} onChange={(event) => onEventChange(event.target.value)} value={event}><option value="ALL">All evidence</option><option value="ROUTE">Route</option><option value="DEPENDENCY">Dependency</option></select></label>
    {filters && onFiltersChange ? <>
      <label className="mt-4 block text-sm font-semibold text-muted">Category<select className={`${ui.input} mt-1`} onChange={(event) => onFiltersChange({ category: event.target.value })} value={filters.category}><option value="ALL">All categories</option>{commitCategories.map((category) => <option key={category} value={category}>{category === "CI" ? "CI" : category[0] + category.slice(1).toLowerCase()}</option>)}</select></label>
      <label className="mt-4 block text-sm font-semibold text-muted">File path<input className={`${ui.input} mt-1`} onChange={(event) => onFiltersChange({ path: event.target.value })} placeholder="src/app/" type="search" value={filters.path} /></label>
      <fieldset className="m-0 mt-4 min-w-0 border-0 p-0"><legend className="text-sm font-semibold text-muted">Commit dates (UTC)</legend>
        <label className="mt-2 block text-sm text-muted">From<input aria-describedby={reversedDates ? "date-filter-error" : undefined} aria-invalid={reversedDates} className={`${ui.input} mt-1 min-w-0`} max={filters.to || undefined} onChange={(event) => onFiltersChange({ from: event.target.value })} type="date" value={filters.from} /></label>
        <label className="mt-2 block text-sm text-muted">Through<input aria-describedby={reversedDates ? "date-filter-error" : undefined} aria-invalid={reversedDates} className={`${ui.input} mt-1 min-w-0`} min={filters.from || undefined} onChange={(event) => onFiltersChange({ to: event.target.value })} type="date" value={filters.to} /></label>
        {reversedDates ? <p className="mt-2 text-sm text-negative" id="date-filter-error" role="alert">Start date must be on or before end date.</p> : null}
      </fieldset>
      <button className={`${ui.button} mt-4 w-full`} onClick={onClearFilters} type="button">Reset filters</button>
    </> : null}
  </aside>;
}

function CommitRow({ commit, repositoryId, filterSearch }: { commit: TimelineCommit; repositoryId: string; filterSearch: string }) {
  const { subject, body } = splitCommitMessage(commit.message);
  const href = `/repositories/${repositoryId}/commits/${commit.shortSha}${filterSearch ? `?${filterSearch}` : ""}`;
  const scrollKey = `reporeplay:timeline-scroll:${repositoryId}:${filterSearch}`;
  return <article className="grid grid-cols-[7rem_minmax(0,1fr)_7rem] gap-4 border-b border-line p-4 last:border-b-0 max-[560px]:grid-cols-1">
    <div className="font-mono text-xs leading-loose text-muted"><code>{commit.shortSha}</code><br />{new Date(commit.committedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })}</div>
    <div className="min-w-0">
      <h3><Link className="break-words font-mono font-semibold" href={href} onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
		try { window.sessionStorage.setItem(scrollKey, String(window.scrollY)); } catch { return; }
		try { window.sessionStorage.setItem(`reporeplay:timeline-focus:${repositoryId}`, href); } catch { return; }
      }}>{subject}</Link></h3>
      {body ? <p className="m-0 mt-1 max-w-[70ch] whitespace-pre-wrap break-words text-sm leading-6 text-muted">{body}</p> : null}
      <span className="mt-2 inline-block font-mono text-[.68rem] uppercase text-cyan">{commit.category.toLowerCase()}</span>
      <EventSummary dependencies={getDependencyChanges(commit)} routes={getRouteChanges(commit)} summary={getSummary(commit)} />
      <ChangedFiles commit={commit} repositoryId={repositoryId} />
    </div>
    <div className="text-right font-mono text-xs leading-loose text-muted max-[560px]:text-left">{commit.statistics.changedFiles} files<br /><span className={ui.positive}>+{commit.statistics.additions}</span> <span className={ui.negative}>-{commit.statistics.deletions}</span></div>
  </article>;
}

function ChangedFiles({ commit, repositoryId }: { commit: TimelineCommit; repositoryId: string }) {
  const [files, setFiles] = useState<CommitEvidence["files"] | null>(() => "files" in commit ? commit.files : null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  async function loadFiles() {
    if (loading || files) return;
    setLoading(true);
    setError("");
    try {
      const evidence = await fetchApi<{ files: CommitEvidence["files"] }>(`/api/repositories/${repositoryId}/commits/${commit.sha}`);
      setFiles(evidence.files);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Changed-file evidence could not be loaded.");
    } finally {
      setLoading(false);
    }
  }
  return <details className="mt-2" onToggle={(event) => { if (event.currentTarget.open && !files) void loadFiles(); }}>
    <summary className="flex min-h-11 w-fit cursor-pointer items-center font-mono text-xs text-muted">Show {commit.statistics.changedFiles} changed files</summary>
    {loading ? <p className="text-sm text-muted" role="status">Loading changed files...</p> : error ? <div role="alert"><p>{error}</p><button className={ui.button} onClick={() => void loadFiles()} type="button">Retry file evidence</button></div> : files?.length ? <ul className="m-0 list-none break-all border-t border-soft py-3 font-mono text-xs leading-loose text-muted">{files.map((file) => <li key={file.path}>{file.status} {file.path}</li>)}</ul> : <p className="text-sm text-muted">No changed files were recorded.</p>}
  </details>;
}
