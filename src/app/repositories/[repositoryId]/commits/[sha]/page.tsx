import Link from "next/link";
import { CommitDrawer } from "@/components/commit-drawer";
import { LiveCommitView } from "@/components/live-commit-view";
import { ui } from "@/lib/ui";

export default async function CommitPage({ params }: { params: Promise<{ repositoryId: string; sha: string }> }) {
  const { repositoryId, sha } = await params;
  return <><header className={ui.topbar} inert><div className={ui.topbarInner}><Link className={ui.brand} href="/"><span aria-hidden="true">&gt;_</span> reporeplay</Link><Link href={`/repositories/${repositoryId}`}>Back</Link></div></header><CommitDrawer closeHref={`/repositories/${repositoryId}`}><LiveCommitView repositoryId={repositoryId} sha={sha} /></CommitDrawer></>;
}
