"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ui } from "@/lib/ui";
import type { PreflightResult, PublicLimits } from "@/server/contracts/api";

type Stage = "IMPORT" | "PREFLIGHT";

interface FlowError {
  code: string;
  message: string;
}

interface ErrorPayload {
  error?: { code?: string; message?: string };
}

function errorFromPayload(payload: ErrorPayload, fallback: string): FlowError {
  return { code: payload.error?.code ?? "REQUEST_FAILED", message: payload.error?.message ?? fallback };
}

function errorFromUnknown(caught: unknown, fallback: string): FlowError {
  return { code: "REQUEST_FAILED", message: caught instanceof Error ? caught.message : fallback };
}

function errorPresentation(code: string): { title: string; recovery: string } {
  switch (code) {
    case "INVALID_REPOSITORY_URL":
      return { title: "Invalid repository URL.", recovery: "Enter a public GitHub repository URL in the form github.com/owner/repository." };
    case "REPOSITORY_NOT_FOUND":
      return { title: "Repository not found.", recovery: "Check the owner and repository name, then try again." };
    case "REPOSITORY_NOT_PUBLIC":
      return { title: "Repository is not public.", recovery: "Use a public GitHub repository URL to continue." };
    case "UNSUPPORTED_REPOSITORY":
      return { title: "Unsupported Next.js application.", recovery: "RepoReplay needs a supported app or pages route root." };
    case "REPOSITORY_LIMIT_EXCEEDED":
      return { title: "Repository exceeds current limits.", recovery: "Try a repository within the displayed commit and file limits." };
    case "GITHUB_DATA_TRUNCATED":
      return { title: "GitHub returned incomplete data.", recovery: "No partial import was created. Try preflight again when the source response is complete." };
    case "GITHUB_RATE_LIMITED":
      return { title: "GitHub rate limit reached.", recovery: "Wait for the recorded reset window, then run preflight again." };
    case "CONFIGURATION_REQUIRED":
      return { title: "Application root selection required.", recovery: "Select one discovered application root before queuing the import." };
    default:
      return { title: "Repository check could not complete.", recovery: "Check the repository URL and try again." };
  }
}

export function ImportFlow() {
  const router = useRouter();
  const [limits, setLimits] = useState<PublicLimits | null>(null);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);
  const [stage, setStage] = useState<Stage>("IMPORT");
  const [url, setUrl] = useState("https://github.com/kisnak21/reporeplay");
  const [selectedRoot, setSelectedRoot] = useState("");
  const [error, setError] = useState<FlowError | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/config/limits").then((r) => r.json()).then((j) => setLimits(j.data)).catch(() => setLimits({ maxFirstParentCommits: 500, maxHeadFiles: 25000, timelineDefaultLimit: 30, timelineMaxLimit: 100 }));
  }, []);

  async function inspectRepository(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/repositories/preflight", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
      const json = await res.json() as ErrorPayload & { data?: PreflightResult };
      if (!res.ok) {
        setError(errorFromPayload(json, "Preflight failed."));
        return;
      }
      if (!json.data) {
        setError({ code: "REQUEST_FAILED", message: "Preflight returned an incomplete response." });
        return;
      }
      setPreflight(json.data);
      setSelectedRoot(json.data.appRootCandidates[0]?.path ?? "");
      setStage("PREFLIGHT");
    } catch (e: unknown) {
      setError(errorFromUnknown(e, "Preflight failed."));
    } finally {
      setLoading(false);
    }
  }

  async function queueRepository(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/repositories", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url, appRoot: selectedRoot || undefined }) });
      const json = await res.json() as ErrorPayload & { data?: { repositoryId: string; runId: string } };
      if (!res.ok) {
        setError(errorFromPayload(json, "Import failed."));
        return;
      }
      if (!json.data) {
        setError({ code: "REQUEST_FAILED", message: "Import returned an incomplete response." });
        return;
      }
      const { repositoryId, runId } = json.data;
      router.push(`/repositories/${repositoryId}/processing/${runId}`);
    } catch (e: unknown) {
      setError(errorFromUnknown(e, "Import failed."));
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
        <form onSubmit={queueRepository}><fieldset className="mt-8 border-0 p-0"><legend className="mb-2 font-mono text-xs uppercase text-cyan">Application root candidates</legend>{preflight.appRootCandidates.map((candidate) => <label className="grid grid-cols-[auto_1fr_auto] items-center gap-4 border border-line border-b-0 bg-panel p-4 last:border-b max-[560px]:grid-cols-[auto_1fr]" key={candidate.path}><input checked={selectedRoot === candidate.path} name="root" onChange={() => setSelectedRoot(candidate.path)} type="radio" /><span><code>{candidate.path}</code><small className="block break-words font-mono text-muted">{candidate.manifestPath} · {candidate.routeRoots.join(", ")} · {candidate.routeFileCount} route files</small></span><span className={ui.positive}>supported</span></label>)}</fieldset><div className="mt-4 flex gap-3 max-[560px]:flex-col"><button className={ui.button} onClick={() => { setError(null); setStage("IMPORT"); }} type="button">Change repository</button><button className={ui.primaryButton} disabled={loading} type="submit">{loading ? "Queuing..." : "Queue selected root"}</button></div>{error ? <ErrorPanel error={error} id="import-error" /> : null}</form>
      </section>
    );
  }

  return (
    <section className="grid grid-cols-[minmax(0,1.3fr)_minmax(19rem,.7fr)] items-end gap-[clamp(2rem,6vw,6rem)] max-[800px]:grid-cols-1" aria-labelledby="import-title">
      <div><p className={ui.eyebrow}>Repository evolution console</p><h1 className={ui.title} id="import-title">Trace mainline change to source.</h1><p className={ui.lede}>Inspect complete first-parent history for a public Next.js application. Every route and dependency transition resolves to commit and file evidence.</p></div>
      <aside className={ui.terminal} aria-label="Supported analysis"><div className={ui.terminalHeader}><span>capabilities</span><span>ready</span></div><div className={ui.terminalBody}><div><span className={ui.positive}>ok</span> public GitHub source</div><div><span className={ui.positive}>ok</span> App and Pages Router</div><div><span className={ui.positive}>ok</span> package.json declarations</div><div><span className={ui.signal}>limit</span> {limits ? `${limits.maxFirstParentCommits} commits / ${limits.maxHeadFiles.toLocaleString("en-US")} files` : "loading limits..."}</div></div></aside>
      <form className="col-span-full border border-line bg-panel p-4" noValidate onSubmit={inspectRepository}><label className="block text-sm font-semibold text-muted" htmlFor="repository-url">Public GitHub repository URL</label><div className="mt-2 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 max-[560px]:grid-cols-[auto_minmax(0,1fr)]"><span className="font-mono text-lg font-semibold text-signal">$</span><input className={ui.input} aria-describedby={error ? "url-error" : "url-note"} aria-invalid={Boolean(error)} id="repository-url" onChange={(event) => setUrl(event.target.value)} type="url" value={url} /><button className={`${ui.primaryButton} max-[560px]:col-span-full max-[560px]:w-full`} disabled={loading} type="submit">{loading ? "Checking..." : "Run preflight"}</button></div>{error ? <ErrorPanel error={error} id="url-error" /> : <p className="mt-3 font-mono text-xs text-muted" id="url-note">Live preflight via GitHub App — no processing begins until support and completeness checks pass.</p>}</form>
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) { return <div className={ui.datum}><span className="block text-xs uppercase text-muted">{label}</span><strong className="mt-1 block break-words text-lg">{value}</strong></div>; }

function ErrorPanel({ error, id }: { error: FlowError; id: string }) {
  const presentation = errorPresentation(error.code);
  return <div className={`${ui.alert} mt-4`} id={id} role="alert"><strong>{presentation.title}</strong><p>{error.message}</p><p>{presentation.recovery}</p><p className="font-mono text-xs">Error code: <code className="break-all">{error.code}</code></p></div>;
}
