"use client";

import Link from "next/link";
import type { CommitEvidence, DependencyChange, TimelineEventSummary, TimelineItem } from "@/server/contracts/api";
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

export function Timeline({ commits, repositoryId = "demo", query, event, onQueryChange, onEventChange, onClearFilters, onLoadOlder, hasNextPage = false, loadingOlder = false, mismatch, onReloadFromTop }: TimelineProps) {
  return <div className="mt-6 grid grid-cols-[15rem_minmax(0,1fr)] gap-4 max-[800px]:grid-cols-1"><aside className="sticky top-4 self-start border border-line bg-panel p-4 max-[800px]:static" aria-label="Timeline filters"><h2 className="font-mono text-base">Filter record</h2><label className="mt-4 block text-sm font-semibold text-muted">Keyword<input className={`${ui.input} mt-1`} onChange={(e) => onQueryChange(e.target.value)} placeholder="authentication" type="search" value={query} /></label><label className="mt-4 block text-sm font-semibold text-muted">Evidence<select className={`${ui.input} mt-1`} onChange={(e) => onEventChange(e.target.value)} value={event}><option value="ALL">All evidence</option><option value="ROUTE">Route</option><option value="DEPENDENCY">Dependency</option></select></label></aside><section aria-labelledby="timeline-title"><p className={ui.eyebrow}>timeline / newest first</p><h2 className={ui.sectionTitle} id="timeline-title">Observable transitions</h2>{mismatch ? <div className={`${ui.alert} mt-3`} role="alert"><strong>Newer snapshot available.</strong><p>{mismatch}</p>{onReloadFromTop ? <button className={`${ui.button} mt-3`} onClick={onReloadFromTop} type="button">Reload from top</button> : null}</div> : null}{commits.length ? <div className="mt-3 border border-line bg-panel">{commits.map((commit) => { const summary = getSummary(commit); const { subject, body } = splitCommitMessage(commit.message); return <article className="grid grid-cols-[7rem_minmax(0,1fr)_7rem] gap-4 border-b border-line p-4 last:border-b-0 max-[560px]:grid-cols-1" key={commit.sha}><div className="font-mono text-xs leading-loose text-muted"><code>{commit.shortSha}</code><br />{new Date(commit.committedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</div><div><h3><Link className="font-mono font-semibold break-words" href={`/repositories/${repositoryId}/commits/${commit.shortSha}`}>{subject}</Link></h3>{body ? <p className="m-0 mt-1 max-w-[70ch] whitespace-pre-wrap break-words text-sm leading-6 text-muted">{body}</p> : null}<span className="mt-2 inline-block font-mono text-[.68rem] uppercase text-cyan">{commit.category.toLowerCase()}</span><EventSummary dependencies={getDependencyChanges(commit)} routes={getRouteChanges(commit)} summary={summary} />{"files" in commit ? <details className="mt-2"><summary className="flex min-h-11 w-fit cursor-pointer items-center font-mono text-xs text-muted">Show {commit.files.length} changed files</summary><ul className="m-0 list-none break-words border-t border-soft py-3 font-mono text-xs leading-loose text-muted">{commit.files.map((file) => <li key={file.path}>{file.status} {file.path}</li>)}</ul></details> : null}</div><div className="text-right font-mono text-xs leading-loose text-muted max-[560px]:text-left">{commit.statistics.changedFiles} files<br /><span className={ui.positive}>+{commit.statistics.additions}</span> <span className={ui.negative}>-{commit.statistics.deletions}</span></div></article>; })}</div> : <div className="mt-3 flex items-center justify-between gap-4 border border-line bg-panel p-5 max-[560px]:flex-col max-[560px]:items-stretch"><strong>No commits match these filters.</strong><button className={ui.button} onClick={onClearFilters} type="button">Clear filters</button></div>}{onLoadOlder && hasNextPage ? <button className={`${ui.button} mt-4 w-full`} disabled={loadingOlder} onClick={onLoadOlder} type="button">{loadingOlder ? "Loading older commits..." : "Load older commits"}</button> : null}</section></div>;
}
