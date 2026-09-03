"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CommitDetail } from "@/server/contracts/api";
import { fetchApi } from "@/lib/client-api";
import { splitCommitMessage } from "@/lib/commit-message";
import { ui } from "@/lib/ui";

interface LiveCommitViewProps {
  repositoryId: string;
  sha: string;
}

export function LiveCommitView({ repositoryId, sha }: LiveCommitViewProps) {
  const [commit, setCommit] = useState<CommitDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

    async function loadCommit(): Promise<void> {
      try {
        const data = await fetchApi<CommitDetail>(`/api/repositories/${repositoryId}/commits/${sha}`, { signal: controller.signal });
        if (!mounted) return;
        setCommit(data);
        setError("");
      } catch (caught: unknown) {
        if (!mounted || controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "The commit evidence could not be loaded.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    void loadCommit();
    return () => {
      mounted = false;
      controller.abort();
    };
  }, [reloadKey, repositoryId, sha]);

  if (loading && !commit) return <p className="font-mono text-sm text-muted" role="status">Loading commit evidence...</p>;
  if (error && !commit) return <div className={ui.alert} role="alert"><strong>Commit evidence unavailable.</strong><p>{error}</p><div className="mt-3 flex flex-wrap gap-3"><button className={ui.button} onClick={() => setReloadKey((value) => value + 1)} type="button">Retry evidence request</button><Link className={ui.button} href={`/repositories/${repositoryId}`}>Back to repository</Link></div></div>;
  if (!commit) return null;

  const { subject, body } = splitCommitMessage(commit.message);

  return <>
    <header className={ui.screenHead}><div><p className={ui.eyebrow}>commit / {commit.shortSha}</p><h1 className={ui.commitTitle} id="commit-title" tabIndex={-1}>{subject}</h1>{body ? <p className={ui.commitBody}>{body}</p> : null}</div><dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-2 self-start border-t border-soft pt-3 font-mono text-xs leading-relaxed text-muted"><dt>author</dt><dd className="m-0 break-words text-right max-[800px]:text-left">{commit.authorName ?? "unknown author"}</dd><dt>committed</dt><dd className="m-0 break-words text-right max-[800px]:text-left">{new Date(commit.committedAt).toLocaleString()}</dd><dt>category</dt><dd className="m-0 break-words text-right max-[800px]:text-left">{commit.category.value} / {commit.category.source}</dd></dl></header>
    {error ? <p className="mt-4 text-sm text-negative" role="alert">{error}</p> : null}
    <div className="mt-4 flex flex-wrap gap-3"><Link className={ui.button} href={`/repositories/${repositoryId}`}>Close evidence</Link><a className={ui.primaryButton} href={commit.externalUrl}>Open on GitHub</a></div>
    <div className={ui.dataGrid} aria-label="Commit statistics"><Fact label="changed files" value={String(commit.statistics.changedFiles)} /><Fact label="additions" value={`+${commit.statistics.additions}`} /><Fact label="deletions" value={`-${commit.statistics.deletions}`} /><Fact label="first parent" value={commit.firstParentSha?.slice(0, 7) ?? "root commit"} /></div>
    <EvidenceSection title="Changed files">{commit.files.length ? <div className="border border-line bg-panel">{commit.files.map((file) => <div className="flex flex-wrap justify-between gap-3 border-b border-line p-3 font-mono text-xs last:border-b-0" key={`${file.status}-${file.path}`}><span className="min-w-0 break-words">{file.status} {file.path}{file.previousPath ? ` from ${file.previousPath}` : ""}</span><span>+{file.additions} -{file.deletions}</span></div>)}</div> : <p className="text-muted">No changed-file evidence was recorded.</p>}</EvidenceSection>
    <EvidenceSection title="Dependency evidence">{commit.dependencyChanges.length ? <div className="border border-line bg-panel">{commit.dependencyChanges.map((change) => <div className="border-b border-line p-3 last:border-b-0" key={`${change.manifestPath}-${change.packageName}-${change.dependencyGroup}-${change.changeType}`}><strong className="font-mono">{change.changeType} {change.packageName}</strong><p className="m-0 mt-1 font-mono text-xs text-muted">{change.dependencyGroup} · {change.manifestPath} · {change.previousValue ?? "empty"} to {change.currentValue ?? "empty"}</p></div>)}</div> : <p className="text-muted">No declared-dependency transition was recorded.</p>}</EvidenceSection>
    <EvidenceSection title="Route evidence">{commit.routeChanges.length ? <div className="border border-line bg-panel">{commit.routeChanges.map((change) => <div className="border-b border-line p-3 last:border-b-0" key={`${change.sourcePath}-${change.changeType}`}><strong className="font-mono">{change.changeType} {change.route}</strong><p className="m-0 mt-1 font-mono text-xs text-muted">{change.router} {change.routeType} · {change.sourcePath}</p></div>)}</div> : <p className="text-muted">No route-topology transition was recorded.</p>}</EvidenceSection>
    <EvidenceSection title="Coverage warnings">{commit.warnings.length ? commit.warnings.map((warning, index) => <div className={ui.alert} key={`${warning.code}-${warning.path ?? "run"}-${index}`}><strong>{warning.code}</strong><p>{warning.message} <code className="break-all">{warning.path ?? "detector-wide"}</code></p></div>) : <p className="text-muted">No detector warnings were recorded for this commit.</p>}</EvidenceSection>
    <EvidenceSection title="Provenance"><p className="m-0 font-mono text-xs leading-loose text-muted">Active snapshot run <code>{commit.snapshot.runId}</code><br />Category source {commit.category.source}</p></EvidenceSection>
  </>;
}

function EvidenceSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="border-b border-line py-5"><h2 className="mb-3 font-mono text-xs uppercase tracking-wider text-cyan">{title}</h2>{children}</section>;
}

function Fact({ label, value }: { label: string; value: string }) {
  return <div className={ui.datum}><span className="block text-xs uppercase text-muted">{label}</span><strong className="mt-1 block break-words text-lg">{value}</strong></div>;
}
