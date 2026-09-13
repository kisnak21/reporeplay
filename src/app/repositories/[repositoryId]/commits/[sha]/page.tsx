import Link from "next/link";
import type { Metadata } from "next";
import { CommitDrawer } from "@/components/commit-drawer";
import { LiveCommitView } from "@/components/live-commit-view";
import { ui } from "@/lib/ui";
import { readTimelineFilters, serializeTimelineFilters } from "@/lib/timeline-filters";

export async function generateMetadata({ params }: { params: Promise<{ repositoryId: string; sha: string }> }): Promise<Metadata> {
  const { repositoryId, sha } = await params;
  return { title: `Commit evidence ${sha.slice(0, 7)} — ${repositoryId}` };
}

export default async function CommitPage({ params, searchParams }: { params: Promise<{ repositoryId: string; sha: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { repositoryId, sha } = await params;
  const query = new URLSearchParams(Object.entries(await searchParams).flatMap(([key, value]) => typeof value === "string" ? [[key, value]] : []));
  const search = serializeTimelineFilters(readTimelineFilters(query));
  const closeHref = `/repositories/${repositoryId}${search ? `?${search}` : ""}`;
  return <><header className={ui.topbar} inert><div className={ui.topbarInner}><Link className={ui.brand} href="/"><span aria-hidden="true">&gt;_</span> reporeplay</Link><Link href={closeHref}>Back</Link></div></header><CommitDrawer closeHref={closeHref}><LiveCommitView repositoryId={repositoryId} sha={sha} closeHref={closeHref} /></CommitDrawer></>;
}
