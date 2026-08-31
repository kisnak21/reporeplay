import Link from "next/link";
import { ProcessingView } from "@/components/processing-view";
import { processingFixture } from "@/features/fixtures/repository-fixtures";
import { ui } from "@/lib/ui";

export default function ProcessingPage() {
  return <><Header /><main className={ui.shell} id="main-content"><ProcessingView run={processingFixture} /></main></>;
}

function Header() {
  return <header className={ui.topbar}><div className={ui.topbarInner}><Link className={ui.brand} href="/"><span aria-hidden="true">&gt;_</span> reporeplay</Link><span className="font-mono text-xs text-muted max-[560px]:hidden">durable processing / fixture mode</span></div></header>;
}
