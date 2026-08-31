import Link from "next/link";
import { getPool } from "@/server/db/client-pool";
import { ui } from "@/lib/ui";

export default async function CommitPage({ params }: { params: Promise<{ repositoryId: string; sha: string }> }) {
  const { repositoryId, sha } = await params;
  const pool = getPool(process.env.DATABASE_URL!);
  const repo = await pool.query(`SELECT "activeRunId" FROM "Repository" WHERE "id"=$1`, [repositoryId]);
  const runId = repo.rows[0]?.activeRunId;
  if (!runId) return <main className={ui.shell}>No active snapshot</main>;
  const commit = await pool.query(`SELECT "sha","shortSha","message","authorName","committedAt","firstParentSha","additions","deletions","changedFileCount","externalUrl" FROM "RunCommit" WHERE "runId"=$1 AND ("sha"=$2 OR "shortSha"=$2)`, [runId, sha]);
  if (!commit.rows[0]) return <main className={ui.shell}>Commit not found</main>;
  const c = commit.rows[0];
  const files = await pool.query(`SELECT "path","previousPath","status","additions","deletions" FROM "CommitFile" WHERE "runId"=$1 AND "runCommitId"=(SELECT "id" FROM "RunCommit" WHERE "runId"=$1 AND "sha"=$2) ORDER BY "path"`, [runId, c.sha]);
  return (
    <>
      <header className={ui.topbar}><div className={ui.topbarInner}><Link className={ui.brand} href="/"><span aria-hidden="true">&gt;_</span> reporeplay</Link><Link href={`/repositories/${repositoryId}`}>Back</Link></div></header>
      <main className={ui.shell} id="main-content">
        <p className={ui.eyebrow}>commit / {c.shortSha}</p>
        <h1 className={ui.title}>{c.message}</h1>
        <div className="mt-3 font-mono text-xs text-muted">author {c.authorName ?? "unknown"} · {new Date(c.committedAt).toLocaleString()} · {c.changedFileCount} files +{c.additions} -{c.deletions}</div>
        <a className={`${ui.primaryButton} mt-4`} href={c.externalUrl}>Open on GitHub</a>
        <section className="mt-8"><h2 className={ui.sectionTitle}>Changed files</h2><div className="mt-3 border border-line bg-panel">{files.rows.map((f: {path:string;status:string;additions:number;deletions:number}) => <div key={f.path} className="flex justify-between border-b border-line p-3 last:border-b-0 font-mono text-xs"><span>{f.status} {f.path}</span><span>+{f.additions} -{f.deletions}</span></div>)}</div></section>
      </main>
    </>
  );
}
