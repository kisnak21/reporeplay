import Link from "next/link";
import { LiveProcessingView } from "@/components/live-processing-view";
import { ui } from "@/lib/ui";

export default async function ProcessingPage({ params }: { params: Promise<{ repositoryId: string; runId: string }> }) {
  const { repositoryId, runId } = await params;
  return <><header className={ui.topbar}><div className={ui.topbarInner}><Link className={ui.brand} href="/"><span aria-hidden="true">&gt;_</span> reporeplay</Link><span className="font-mono text-xs text-muted">live processing</span></div></header><main className={ui.shell} id="main-content"><LiveProcessingView repositoryId={repositoryId} runId={runId} /></main></>;
}
