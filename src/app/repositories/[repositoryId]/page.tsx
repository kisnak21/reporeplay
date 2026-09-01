import Link from "next/link";
import { LiveRepositoryView } from "@/components/live-repository-view";
import { ui } from "@/lib/ui";

export default async function RepositoryPage({ params }: { params: Promise<{ repositoryId: string }> }) {
  const { repositoryId } = await params;
  return <><header className={ui.topbar}><div className={ui.topbarInner}><Link className={ui.brand} href="/"><span aria-hidden="true">&gt;_</span> reporeplay</Link><nav aria-label="Repository" className={ui.nav}><Link href="/">Import</Link><Link href="/repositories/demo">Showcase</Link></nav></div></header><main className={ui.shell} id="main-content"><LiveRepositoryView repositoryId={repositoryId} /></main></>;
}
