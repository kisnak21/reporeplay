const capabilities = [
  "Public GitHub source",
  "App and Pages Router",
  "package.json declarations",
  "Complete first-parent chain",
];

export default function Home() {
  return (
    <>
      <header className="topbar">
        <div className="topbarInner">
          <span className="brand"><span aria-hidden="true">&gt;_</span> reporeplay</span>
          <span className="systemState">foundation / phase 0</span>
        </div>
      </header>
      <main className="shell" id="main-content">
        <section className="hero" aria-labelledby="page-title">
          <div>
            <p className="eyebrow">Repository evolution console</p>
            <h1 id="page-title">Trace mainline change to source.</h1>
            <p className="lede">RepoReplay will inspect complete first-parent history for supported public Next.js applications and connect route and dependency transitions to commit evidence.</p>
          </div>
          <aside className="terminal" aria-label="Planned MVP capabilities">
            <div className="terminalHeader"><span>mvp_contract</span><span>locked</span></div>
            <div className="terminalBody">
              {capabilities.map((capability) => <div key={capability}><span className="statusOk">ok</span> {capability}</div>)}
              <div><span className="statusLimit">limit</span> 500 commits / 25,000 files</div>
            </div>
          </aside>
        </section>
        <section className="phase" aria-labelledby="phase-title">
          <div>
            <p className="eyebrow">Current build state</p>
            <h2 id="phase-title">Foundation in progress</h2>
          </div>
          <p>Project structure, environment contracts, database migrations, worker entry point, fixtures, static checks, and test runners are being established before import behavior is added.</p>
        </section>
      </main>
    </>
  );
}
