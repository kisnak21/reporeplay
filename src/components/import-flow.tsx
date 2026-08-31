"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ui } from "@/lib/ui";
import type { PreflightResult, PublicLimits } from "@/server/contracts/api";

type Stage = "IMPORT" | "PREFLIGHT";

export function ImportFlow() {
  const router = useRouter();
  const [limits, setLimits] = useState<PublicLimits | null>(null);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [stage, setStage] = useState<Stage>("IMPORT");
  const [url, setUrl] = useState("https://github.com/kisnak21/reporeplay");
  const [selectedRoot, setSelectedRoot] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/config/limits").then((r) => r.json()).then((j) => setLimits(j.data)).catch(() => setLimits({ maxFirstParentCommits: 500, maxHeadFiles: 25000, timelineDefaultLimit: 30, timelineMaxLimit: 100 }));
  }, []);

  async function inspectRepository(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/repositories/preflight", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message || "Preflight failed");
      setPreflight(json.data);
      setSelectedRoot(json.data.appRootCandidates[0]?.path ?? "");
      setStage("PREFLIGHT");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Preflight failed");
    } finally {
      setLoading(false);
    }
  }

  async function queueRepository(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/repositories", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url, appRoot: selectedRoot || undefined }) });
      const json = await res.json();
      if (!res.ok) {
        if (json.error?.code === "CONFIGURATION_REQUIRED") {
          setError("Multiple apps found — please select one.");
          return;
        }
        throw new Error(json.error?.message || "Import failed");
      }
      const { repositoryId, runId } = json.data;
      router.push(`/repositories/${repositoryId}/processing/${runId}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setLoading(false);
    }
  }

  if (stage === "PREFLIGHT" && preflight) {
    return (
      <section aria-labelledby="preflight-title">
        <header className={ui.screenHead}><div><p className={ui.eyebrow}>preflight / source validated</p><h1 className={ui.sectionTitle} id="preflight-title">Select one application root.</h1></div><p className="m-0 text-muted">Live GitHub data — choose the application whose history you want to inspect.</p></header>
        <div className={ui.dataGrid} aria-label="Preflight facts"><Fact label="repository" value={preflight.repository.fullName} /><Fact label="target" value={`${preflight.repository.defaultBranch}@${preflight.repository.headSha.slice(0,7)}`} /><Fact label="first-parent commits" value={`${preflight.firstParentCommitCount} / ${preflight.limits.maxFirstParentCommits}`} /><Fact label="head files" value={`${preflight.headFileCount.toLocaleString("en-US")} / ${preflight.limits.maxHeadFiles.toLocaleString("en-US")}`} /></div>
        <div className={ui.alert}><strong>Completeness check passed.</strong><p>The entire first-parent chain is within current limits. RepoReplay will not create a partial import.</p></div>
        <form onSubmit={queueRepository}><fieldset className="mt-8 border-0 p-0"><legend className="mb-2 font-mono text-xs uppercase text-cyan">Application root candidates</legend>{preflight.appRootCandidates.map((candidate) => <label className="grid grid-cols-[auto_1fr_auto] items-center gap-4 border border-line border-b-0 bg-panel p-4 last:border-b max-[560px]:grid-cols-[auto_1fr]" key={candidate.path}><input checked={selectedRoot === candidate.path} name="root" onChange={() => setSelectedRoot(candidate.path)} type="radio" /><span><code>{candidate.path}</code><small className="block break-words font-mono text-muted">{candidate.manifestPath} · {candidate.routeRoots.join(", ")} · {candidate.routeFileCount} route files</small></span><span className={ui.positive}>supported</span></label>)}</fieldset><div className="mt-4 flex gap-3 max-[560px]:flex-col"><button className={ui.button} onClick={() => setStage("IMPORT")} type="button">Change repository</button><button className={ui.primaryButton} disabled={loading} type="submit">{loading ? "Queuing..." : "Queue selected root"}</button></div>{error && <p className="mt-3 text-xs text-negative">{error}</p>}</form>
      </section>
    );
  }

  return (
    <section className="grid grid-cols-[minmax(0,1.3fr)_minmax(19rem,.7fr)] items-end gap-[clamp(2rem,6vw,6rem)] max-[800px]:grid-cols-1" aria-labelledby="import-title">
      <div><p className={ui.eyebrow}>Repository evolution console</p><h1 className={ui.title} id="import-title">Trace mainline change to source.</h1><p className={ui.lede}>Inspect complete first-parent history for a public Next.js application. Every route and dependency transition resolves to commit and file evidence.</p></div>
      <aside className={ui.terminal} aria-label="Supported analysis"><div className={ui.terminalHeader}><span>capabilities</span><span>ready</span></div><div className={ui.terminalBody}><div><span className={ui.positive}>ok</span> public GitHub source</div><div><span className={ui.positive}>ok</span> App and Pages Router</div><div><span className={ui.positive}>ok</span> package.json declarations</div><div><span className={ui.signal}>limit</span> {limits ? `${limits.maxFirstParentCommits} commits / ${limits.maxHeadFiles.toLocaleString("en-US")} files` : "loading limits..."}</div></div></aside>
      <form className="col-span-full border border-line bg-panel p-4" noValidate onSubmit={inspectRepository}><label className="block text-sm font-semibold text-muted" htmlFor="repository-url">Public GitHub repository URL</label><div className="mt-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 max-[560px]:grid-cols-[auto_minmax(0,1fr)]"><span className="font-mono text-lg font-semibold text-signal">$</span><input className={ui.input} aria-describedby={error ? "url-error" : "url-note"} aria-invalid={Boolean(error)} id="repository-url" onChange={(event) => setUrl(event.target.value)} type="url" value={url} /><button className={`${ui.primaryButton} max-[560px]:col-span-full max-[560px]:w-full`} disabled={loading} type="submit">{loading ? "Checking..." : "Run preflight"}</button></div>{error ? <p className="mt-3 text-xs text-negative" id="url-error">{error}</p> : <p className="mt-3 font-mono text-xs text-muted" id="url-note">Live preflight via GitHub App — no processing begins until support and completeness checks pass.</p>}</form>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) { return <div className={ui.datum}><span className="block text-xs uppercase text-muted">{label}</span><strong className="mt-1 block break-words text-lg">{value}</strong></div>; }
