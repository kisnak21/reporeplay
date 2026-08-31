import Link from "next/link";
import { ImportFlow } from "@/components/import-flow";
import { preflightFixture, publicLimits } from "@/features/fixtures/repository-fixtures";
import { ui } from "@/lib/ui";

export default function Home() {
  return <><SiteHeader /><main className={ui.shell} id="main-content"><ImportFlow limits={publicLimits} preflight={preflightFixture} /></main></>;
}

function SiteHeader() {
  return <header className={ui.topbar}><div className={ui.topbarInner}><Link className={ui.brand} href="/"><span aria-hidden="true">&gt;_</span> reporeplay</Link><nav aria-label="Primary" className={ui.nav}><Link href="/repositories/demo">Showcase</Link><Link href="/case-study">Case study</Link></nav></div></header>;
}
