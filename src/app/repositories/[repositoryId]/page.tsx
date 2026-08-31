import Link from "next/link";
import { getPool } from "@/server/db/client-pool";
import { ui } from "@/lib/ui";

export default async function RepositoryPage({ params }: { params: Promise<{ repositoryId: string }> }) {
  const { repositoryId } = await params;
  const pool = getPool(process.env.DATABASE_URL!);
  const repo = await pool.query(`SELECT "id","owner","name","fullName","canonicalUrl","defaultBranch","selectedAppRoot","availability","activeRunId" FROM "Repository" WHERE "id"=$1`, [repositoryId]);
  if (!repo.rows[0]) return <><header className={ui.topbar}><div className={ui.topbarInner}><Link className={ui.brand} href="/">reporeplay</Link></div></header><main className={ui.shell}>Not found</main></>;
  const r = repo.rows[0];
  let snapshot: { headSha: string; commitCount: number } | null = null;
  let commits: Array<{ sha: string; shortSha: string; message: string; authorName: string | null; committedAt: string }> = [];
  if (r.activeRunId) {
    const run = await pool.query(`SELECT "headSha" FROM "ProcessingRun" WHERE "id"=$1`, [r.activeRunId]);
    snapshot = { headSha: run.rows[0]?.headSha ?? "", commitCount: 0 };
    const count = await pool.query(`SELECT COUNT(*)::int as c FROM "RunCommit" WHERE "runId"=$1`, [r.activeRunId]);
    snapshot.commitCount = count.rows[0].c;
    const list = await pool.query(`SELECT "sha","shortSha","message","authorName","committedAt" FROM "RunCommit" WHERE "runId"=$1 ORDER BY "sequence" DESC LIMIT 30`, [r.activeRunId]);
    commits = list.rows;
  }
  return (
    <>
      <header className={ui.topbar}><div className={ui.topbarInner}><Link className={ui.brand} href="/"><span aria-hidden="true">&gt;_</span> reporeplay</Link><nav className={ui.nav}><Link href="/">Import</Link><Link href="/repositories/demo">Showcase</Link></nav></div></header>
      <main className={ui.shell} id="main-content">
        <p className={ui.eyebrow}>repository / {r.fullName}</p>
        <h1 className={ui.title}>{r.owner}/{r.name}</h1>
        <div className="mt-3 flex flex-wrap gap-4 font-mono text-xs text-muted"><span>branch {r.defaultBranch}</span><span>root {r.selectedAppRoot ?? "."}</span><span>{r.availability}</span>{snapshot && <span>{snapshot.commitCount} commits</span>}</div>
        {snapshot && <div className={ui.dataGrid}><div className={ui.datum}><span className="block text-xs uppercase text-muted">head</span><strong className="mt-1 block break-words text-lg">{snapshot.headSha.slice(0,7)}</strong></div><div className={ui.datum}><span className="block text-xs uppercase text-muted">commits</span><strong className="mt-1 block break-words text-lg">{snapshot.commitCount}</strong></div></div>}
        <section className="mt-8"><h2 className={ui.sectionTitle}>Commits</h2>{commits.length ? <div className="mt-3 border border-line bg-panel">{commits.map((c) => <Link key={c.sha} href={`/repositories/${repositoryId}/commits/${c.sha}`} className="flex justify-between border-b border-line p-4 last:border-b-0 hover:bg-raised"><span><code>{c.shortSha}</code> {c.message.slice(0,60)}</span><span className="font-mono text-xs text-muted">{c.authorName ?? "unknown"}</span></Link>)}</div> : <p className="text-muted">No commits yet — processing may still be running.</p>}</section>
      </main>
    </>
  );
}
