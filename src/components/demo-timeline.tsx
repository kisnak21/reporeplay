"use client";

import { useMemo, useState } from "react";
import type { CommitEvidence, TimelineItem } from "@/server/contracts/api";
import { Timeline } from "@/components/timeline";

type TimelineCommit = CommitEvidence | TimelineItem;

function hasRouteEvidence(commit: TimelineCommit): boolean {
  if ("eventSummary" in commit) return commit.eventSummary.routesAdded + commit.eventSummary.routesRemoved > 0;
  return commit.routeChanges.some((change) => change.type === "ADDED" || change.type === "REMOVED");
}

function hasDependencyEvidence(commit: TimelineCommit): boolean {
  if ("eventSummary" in commit) return commit.eventSummary.dependenciesAdded + commit.eventSummary.dependenciesRemoved + commit.eventSummary.dependenciesUpdated > 0;
  return commit.dependencyChanges.length > 0;
}

export function DemoTimeline({ commits, repositoryId = "demo" }: { commits: TimelineCommit[]; repositoryId?: string }) {
  const [query, setQuery] = useState("");
  const [event, setEvent] = useState("ALL");
  const visible = useMemo(() => commits.filter((commit) => commit.message.toLowerCase().includes(query.toLowerCase()) && (event === "ALL" || (event === "ROUTE" ? hasRouteEvidence(commit) : hasDependencyEvidence(commit)))), [commits, event, query]);

  return <Timeline commits={visible} repositoryId={repositoryId} query={query} event={event} onQueryChange={setQuery} onEventChange={setEvent} onClearFilters={() => { setQuery(""); setEvent("ALL"); }} />;
}
