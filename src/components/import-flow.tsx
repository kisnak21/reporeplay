"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PreflightResult, PublicLimits } from "@/server/contracts/api";

type Stage = "IMPORT" | "PREFLIGHT";

export function ImportFlow({ limits, preflight }: { limits: PublicLimits; preflight: PreflightResult }) {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>("IMPORT");
  const [url, setUrl] = useState("https://github.com/acme/ledger");
  const [selectedRoot, setSelectedRoot] = useState(preflight.appRootCandidates[0].path);
  const [error, setError] = useState("");

  function inspectRepository(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== "github.com" || parsed.pathname.split("/").filter(Boolean).length !== 2) throw new Error();
      setError("");
      setStage("PREFLIGHT");
    } catch {
      setError("Enter a public GitHub repository URL in the form github.com/owner/repository.");
    }
  }

  function queueRepository(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    router.push(`/repositories/demo/processing/run-demo?root=${encodeURIComponent(selectedRoot)}`);
  }

  if (stage === "PREFLIGHT") return (
    <section aria-labelledby="preflight-title">
      <header className="screenHead"><div><p className="eyebrow">preflight / source validated</p><h1 id="preflight-title">Select one application root.</h1></div><p>Two supported Next.js applications were found. Choose the application whose history you want to inspect.</p></header>
      <div className="dataGrid" aria-label="Preflight facts"><Fact label="repository" value={preflight.repository.fullName}/><Fact label="target" value={`${preflight.repository.defaultBranch}@${preflight.repository.headSha}`}/><Fact label="first-parent commits" value={`${preflight.firstParentCommitCount} / ${preflight.limits.maxFirstParentCommits}`}/><Fact label="head files" value={`${preflight.headFileCount.toLocaleString("en-US")} / ${preflight.limits.maxHeadFiles.toLocaleString("en-US")}`}/></div>
      <div className="alert"><strong>Completeness check passed.</strong><p>The entire first-parent chain is within current limits. RepoReplay will not create a partial import.</p></div>
      <form onSubmit={queueRepository}><fieldset><legend>Application root candidates</legend>{preflight.appRootCandidates.map((candidate) => <label className="rootOption" key={candidate.path}><input checked={selectedRoot === candidate.path} name="root" onChange={() => setSelectedRoot(candidate.path)} type="radio"/><span><code>{candidate.path}</code><small>{candidate.manifestPath} · {candidate.routeRoots.join(", ")} · {candidate.routeFileCount} route files</small></span><span className="statusOk">supported</span></label>)}</fieldset><div className="actions"><button className="button" onClick={() => setStage("IMPORT")} type="button">Change repository</button><button className="button primary" type="submit">Queue selected root</button></div></form>
    </section>
  );

  return (
    <section className="hero" aria-labelledby="import-title"><div><p className="eyebrow">Repository evolution console</p><h1 id="import-title">Trace mainline change to source.</h1><p className="lede">Inspect complete first-parent history for a public Next.js application. Every route and dependency transition resolves to commit and file evidence.</p></div><aside className="terminal" aria-label="Supported analysis"><div className="terminalHeader"><span>capabilities</span><span>ready</span></div><div className="terminalBody"><div><span className="statusOk">ok</span> public GitHub source</div><div><span className="statusOk">ok</span> App and Pages Router</div><div><span className="statusOk">ok</span> package.json declarations</div><div><span className="statusLimit">limit</span> {limits.maxFirstParentCommits} commits / {limits.maxHeadFiles.toLocaleString("en-US")} files</div></div></aside><form className="commandForm" noValidate onSubmit={inspectRepository}><label htmlFor="repository-url">Public GitHub repository URL</label><div className="commandRow"><span aria-hidden="true">$</span><input aria-describedby={error ? "url-error" : "url-note"} aria-invalid={Boolean(error)} id="repository-url" onChange={(event) => setUrl(event.target.value)} type="url" value={url}/><button className="button primary" type="submit">Run preflight</button></div>{error ? <p className="fieldError" id="url-error">{error}</p> : <p className="caption" id="url-note">No processing begins until support and completeness checks pass.</p>}</form></section>
  );
}

function Fact({ label, value }: { label: string; value: string }) { return <div className="datum"><span>{label}</span><strong>{value}</strong></div>; }
