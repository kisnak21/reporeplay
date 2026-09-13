import Link from "next/link";
import type { Metadata } from "next";
import { ImportFlow } from "@/components/import-flow";
import { ui } from "@/lib/ui";

export const metadata: Metadata = {
  title: "Import a public repository | RepoReplay",
};

export default function Home() {
  return <><SiteHeader /><main className={ui.shell} id="main-content"><ImportFlow /></main></>;
}

function SiteHeader() {
  return <header className={ui.topbar}><div className={ui.topbarInner}><Link className={ui.brand} href="/"><span aria-hidden="true">&gt;_</span> reporeplay</Link><nav aria-label="Primary" className={ui.nav}><Link href="/repositories/demo">Showcase</Link><Link href="/case-study">Case study</Link></nav></div></header>;
}
