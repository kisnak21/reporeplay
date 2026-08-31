import Link from "next/link";
import { ProcessingView } from "@/components/processing-view";
import { processingFixture } from "@/features/fixtures/repository-fixtures";

export default function ProcessingPage() {
  return (
    <>
      <Header />
      <main className="shell" id="main-content">
        <ProcessingView run={processingFixture} />
      </main>
    </>
  );
}

function Header() {
  return (
    <header className="topbar">
      <div className="topbarInner">
        <Link className="brand" href="/"><span aria-hidden="true">&gt;_</span> reporeplay</Link>
        <span className="systemState">durable processing / fixture mode</span>
      </div>
    </header>
  );
}
