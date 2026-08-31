import Link from "next/link";
import { ui } from "@/lib/ui";

export default async function RepositoryPage({ params }: { params: Promise<{ repositoryId: string }> }) {
  const { repositoryId } = await params;
  return <><header className={ui.topbar}><div className={ui.topbarInner}><Link className={ui.brand} href="/"><span aria-hidden="true">&gt;_</span> reporeplay</Link><Link href="/">Import</Link></div></header><main className={ui.shell} id="main-content"><p className={ui.eyebrow}>repository / {repositoryId}</p><h1 className={ui.sectionTitle}>Live repository view — wiring next</h1><p className="mt-3 text-muted">Processing will populate timeline and evidence. For now, this confirms the import created a real repository record. Showcase remains at <Link href="/repositories/demo">/repositories/demo</Link>.</p><div className={ui.alert}><strong>Next:</strong><p>Repository detail, timeline, and commit evidence APIs will replace the demo fixture for this ID.</p></div></main></>;
}
