import Link from "next/link";
import { ui } from "@/lib/ui";

export default async function ProcessingPage({ params }: { params: Promise<{ repositoryId: string; runId: string }> }) {
  const { repositoryId, runId } = await params;
  return <><header className={ui.topbar}><div className={ui.topbarInner}><Link className={ui.brand} href="/"><span aria-hidden="true">&gt;_</span> reporeplay</Link><span className="font-mono text-xs text-muted">live processing</span></div></header><main className={ui.shell} id="main-content"><p className={ui.eyebrow}>run {runId.slice(0,7)} / {repositoryId.slice(0,7)}</p><h1 className={ui.sectionTitle}>Queued for durable processing</h1><p className="mt-3 text-muted">Worker will claim this run via <code>SKIP LOCKED</code> and ingest first-parent history. Check worker logs: <code>npm run worker</code> should show `RepoReplay worker ... ready` and then claim.</p><div className={ui.terminal}><div className={ui.terminalHeader}><span>repository</span><span>{repositoryId}</span></div><div className={ui.terminalBody}>run {runId}<br/>status QUEUED<br/>watch `WorkerHeartbeat` and `ProcessingJob` in pgAdmin</div></div><div className="mt-4 flex gap-3"><Link className={ui.button} href="/">Import another</Link><Link className={ui.primaryButton} href={`/repositories/${repositoryId}`}>View repository</Link></div></main></>;
}
