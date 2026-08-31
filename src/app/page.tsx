import Link from "next/link";
import { ImportFlow } from "@/components/import-flow";
import { preflightFixture, publicLimits } from "@/features/fixtures/repository-fixtures";

export default function Home() { return <><SiteHeader/><main className="shell" id="main-content"><ImportFlow limits={publicLimits} preflight={preflightFixture}/></main></>; }

function SiteHeader() { return <header className="topbar"><div className="topbarInner"><Link className="brand" href="/"><span aria-hidden="true">&gt;_</span> reporeplay</Link><nav aria-label="Primary"><Link href="/repositories/demo">Showcase</Link><Link href="/case-study">Case study</Link></nav></div></header>; }
