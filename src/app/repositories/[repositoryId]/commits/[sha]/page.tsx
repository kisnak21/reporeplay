import Link from "next/link";
import { LiveCommitView } from "@/components/live-commit-view";
import { ui } from "@/lib/ui";

export default async function CommitPage({ params }: { params: Promise<{ repositoryId: string; sha: string }> }) {
  const { repositoryId, sha } = await params;
  return <><header className={ui.topbar}><div className={ui.topbarInner}><Link className={ui.brand} href="/"><span aria-hidden="true">&gt;_</span> reporeplay</Link><Link href={`/repositories/${repositoryId}`}>Back</Link></div></header><main className={`${ui.shell} max-w-5xl`} id="main-content"><LiveCommitView repositoryId={repositoryId} sha={sha} /></main></>;
}
