"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ProcessingRunView } from "@/server/contracts/api";
import { fetchApi } from "@/lib/client-api";
import { ui } from "@/lib/ui";

const POLL_DELAY_MS = 2_000;
const PROCESSING_STEPS: Array<{ key: ProcessingRunView["step"]; label: string }> = [
  { key: "DISCOVER_HISTORY", label: "Discover first-parent history" },
  { key: "FETCH_COMMITS", label: "Fetch commit evidence" },
  { key: "CLASSIFY_COMMITS", label: "Classify commit messages" },
  { key: "DETECT_DEPENDENCIES", label: "Detect dependency transitions" },
  { key: "DETECT_ROUTES", label: "Detect route transitions" },
  { key: "VALIDATE_RUN", label: "Validate staged evidence" },
  { key: "ACTIVATE_RUN", label: "Activate snapshot" },
  { key: "COMPLETE", label: "Complete run" },
];

interface LiveProcessingViewProps {
  repositoryId: string;
  runId: string;
}

function isTerminal(status: ProcessingRunView["status"]): boolean {
  return status === "SUCCEEDED" || status === "FAILED" || status === "CANCELLED";
}

function retryTime(nextAttemptAt: string | null): string {
  if (!nextAttemptAt) return "after the recorded backoff";
  const date = new Date(nextAttemptAt);
  return Number.isNaN(date.getTime()) ? "after the recorded backoff" : `at ${date.toLocaleString()}`;
}

function getStatusMessage(run: ProcessingRunView): string {
  if (run.status === "SUCCEEDED") return "Snapshot activated. Staged evidence is now readable.";
  if (run.status === "FAILED") return "Retry is available without importing the repository again.";
  if (run.status === "CANCELLED") return "Run cancelled. No staged output was activated.";
  if (run.status === "WAITING_RATE_LIMIT") return `GitHub rate limit reached. Saved progress is preserved; the worker will retry ${retryTime(run.nextAttemptAt)}.`;
  if (run.status === "RETRYABLE") return `${run.error?.message ? `${run.error.message} ` : ""}The worker will retry ${retryTime(run.nextAttemptAt)}. Saved progress is preserved.`;
  if (run.status === "NEEDS_CONFIGURATION") return "Choose an application root before processing can continue.";
  if (run.status === "QUEUED" && run.worker.status === "OFFLINE") return "No worker heartbeat detected. Start npm run worker to process this run.";
  if (run.status === "QUEUED") return "Waiting for a worker to claim this run.";
  if (run.worker.status === "OFFLINE") return "Worker heartbeat is stale. The lease will recover this run after it expires.";
  if (run.step === "FETCH_COMMITS") return `Fetching commit evidence. ${run.fetchedCommits} of ${run.expectedCommits ?? "?"} commits fetched.`;
  return "Checkpoint persisted. The worker is continuing in the background.";
}

function getStepValue(run: ProcessingRunView, step: ProcessingRunView["step"], state: ReturnType<typeof getStepState>): string {
  if (step === "FETCH_COMMITS" && (state === "active" || state === "stopped")) return `${run.fetchedCommits} / ${run.expectedCommits ?? "?"}`;
  return state;
}

function getStepState(run: ProcessingRunView, index: number): "complete" | "active" | "queued" | "stopped" {
  const currentIndex = PROCESSING_STEPS.findIndex((step) => step.key === run.step);
  if (run.status === "FAILED" || run.status === "CANCELLED") return index < currentIndex ? "complete" : index === currentIndex ? "stopped" : "queued";
  if (run.status === "SUCCEEDED" || index < currentIndex) return "complete";
  if (index === currentIndex) return "active";
  return "queued";
}

export function LiveProcessingView({ repositoryId, runId }: LiveProcessingViewProps) {
  const [run, setRun] = useState<ProcessingRunView | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [selectedAppRoot, setSelectedAppRoot] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    let mounted = true;

    async function pollRun(): Promise<void> {
      try {
        const nextRun = await fetchApi<ProcessingRunView>(`/api/repositories/${repositoryId}/runs/${runId}`, { signal: controller.signal });
        if (!mounted) return;
        setRun(nextRun);
        setError("");
        setLoading(false);
        if (nextRun.status === "NEEDS_CONFIGURATION") {
          setSelectedAppRoot((current) => nextRun.appRootCandidates.some((candidate) => candidate.path === current)
            ? current
            : nextRun.appRootCandidates[0]?.path ?? "");
        } else if (!isTerminal(nextRun.status)) {
          timer = window.setTimeout(() => void pollRun(), POLL_DELAY_MS);
        }
      } catch (caught: unknown) {
        if (!mounted || controller.signal.aborted) return;
        setLoading(false);
        setError(caught instanceof Error ? caught.message : "The run status could not be loaded.");
      }
    }

    void pollRun();
    return () => {
      mounted = false;
      controller.abort();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [repositoryId, reloadKey, runId]);

  async function cancelRun(): Promise<void> {
    setCancelling(true);
    setError("");
    try {
      await fetchApi(`/api/repositories/${repositoryId}/runs/${runId}/cancel`, { method: "POST" });
      setReloadKey((value) => value + 1);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "The run could not be cancelled.");
    } finally {
      setCancelling(false);
    }
  }

  async function retryRun(): Promise<void> {
    setRetrying(true);
    setError("");
    try {
      await fetchApi(`/api/repositories/${repositoryId}/runs/${runId}/retry`, { method: "POST" });
      setReloadKey((value) => value + 1);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "The run could not be queued for retry.");
    } finally {
      setRetrying(false);
    }
  }

  async function configureAppRoot(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!selectedAppRoot || configuring) return;
    setConfiguring(true);
    setError("");

    try {
      await fetchApi(`/api/repositories/${repositoryId}/runs/${runId}/configuration`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ appRoot: selectedAppRoot }),
      });
      setRun((current) => current ? { ...current, status: "QUEUED", appRootCandidates: [] } : current);
      setReloadKey((value) => value + 1);
    } catch (caught: unknown) {
      setError(caught instanceof Error ? caught.message : "The application root could not be saved.");
    } finally {
      setConfiguring(false);
    }
  }

  if (loading && !run) return <p className="font-mono text-sm text-muted" role="status">Loading run status...</p>;
  if (error && !run) return <div className={ui.alert} role="alert"><strong>Run status unavailable.</strong><p>{error}</p><button className={`${ui.button} mt-3`} onClick={() => setReloadKey((value) => value + 1)} type="button">Retry status request</button></div>;
  if (!run) return null;

  const canCancel = ["QUEUED", "RUNNING", "WAITING_RATE_LIMIT", "RETRYABLE"].includes(run.status);
  const canRetry = run.status === "FAILED";
  const needsConfiguration = run.status === "NEEDS_CONFIGURATION";

  return <section aria-labelledby="processing-title"><header className={ui.screenHead}><div><p className={ui.eyebrow}>run {run.id.slice(0, 7)} / {run.kind ?? "IMPORT"}</p><h1 className={ui.sectionTitle} id="processing-title">{needsConfiguration ? "Select an application root." : "Processing durable evidence."}</h1></div><p className="m-0 text-muted"><code>repository {repositoryId.slice(0, 7)}</code><br /><code>{run.step === "FETCH_COMMITS" ? run.fetchedCommits : run.processedCommits} / {run.expectedCommits ?? "?"} commits</code><br /><code>{run.status}</code></p></header>{run.status === "FAILED" ? <div className={`${ui.alert} mt-4`} role="alert"><strong>{run.kind === "REFRESH" ? "Refresh failed." : "Import failed."}</strong><p>{run.error?.message ?? "The processing run could not complete."}</p><p>{run.kind === "REFRESH" ? "The previous successful snapshot remains available and unchanged." : "No staged output was activated."}</p>{run.error?.code ? <p className="font-mono text-xs">Error code: <code className="break-all">{run.error.code}</code></p> : null}</div> : null}<div className="mt-8 grid grid-cols-[minmax(0,1fr)_20rem] gap-8 max-[800px]:grid-cols-1"><div>{needsConfiguration ? <AppRootConfiguration candidates={run.appRootCandidates} configuring={configuring} kind={run.kind} onChange={setSelectedAppRoot} onSubmit={configureAppRoot} selectedAppRoot={selectedAppRoot} /> : <div className="border border-line bg-[#090d0f]" aria-label="Processing steps">{PROCESSING_STEPS.map((step, index) => { const state = getStepState(run, index); return <div className={`grid grid-cols-[3rem_minmax(0,1fr)_auto] gap-4 border-b border-soft p-4 font-mono text-xs last:border-b-0 max-[560px]:grid-cols-1 ${state === "active" ? "bg-[#1d1a12]" : ""}`} key={step.key} aria-current={state === "active" ? "step" : undefined}><span>{String(index + 1).padStart(2, "0")}</span><strong>{step.label}</strong><span className={state === "complete" ? ui.positive : state === "active" ? ui.signal : state === "stopped" ? ui.negative : ui.muted}>{getStepValue(run, step.key, state)}</span></div>; })}</div>}<p className="mt-3 font-mono text-xs text-muted" role="status" aria-live="polite">{configuring ? "Saving application root." : retrying ? "Retry requested. Waiting for the worker to claim this run." : getStatusMessage(run)}</p>{error ? <p className="mt-2 text-sm text-negative" role="alert">{error}</p> : null}</div><aside className={ui.terminal}><div className={ui.terminalHeader}><span>run state</span><span className={run.status === "FAILED" || run.status === "CANCELLED" ? ui.negative : run.status === "SUCCEEDED" ? ui.positive : ui.signal}>{run.status.toLowerCase()}</span></div><div className={ui.terminalBody}>{needsConfiguration ? <><div>{run.appRootCandidates.length} {run.appRootCandidates.length === 1 ? "root" : "roots"} discovered</div><div>snapshot unchanged</div></> : <><div>attempt {run.attemptCount}</div><div>step {run.step}</div><div>worker {run.worker.status.toLowerCase()}</div><div>{run.worker.heartbeatAgeSeconds === null ? "heartbeat unavailable" : `heartbeat ${Math.round(run.worker.heartbeatAgeSeconds)}s ago`}</div><div>{run.warnings?.length ?? 0} warnings recorded</div>{run.nextAttemptAt ? <div>next attempt {new Date(run.nextAttemptAt).toLocaleString()}</div> : null}</>}</div><div className="flex flex-col gap-3 px-4 pb-4">{canCancel ? <button className={ui.button} disabled={cancelling} onClick={() => void cancelRun()} type="button">{cancelling ? "Cancelling..." : "Cancel run"}</button> : null}{canRetry ? <button className={ui.button} disabled={retrying} onClick={() => void retryRun()} type="button">{retrying ? "Retrying..." : "Retry run"}</button> : null}<Link className={ui.primaryButton} href={`/repositories/${repositoryId}`}>{run.status === "SUCCEEDED" ? "View repository" : "Open repository"}</Link></div></aside></div></section>;
}

function AppRootConfiguration({ candidates, configuring, kind, onChange, onSubmit, selectedAppRoot }: {
  candidates: ProcessingRunView["appRootCandidates"];
  configuring: boolean;
  kind: ProcessingRunView["kind"];
  onChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  selectedAppRoot: string;
}) {
  return <section className="border border-line bg-[#090d0f] p-5" aria-labelledby="app-root-title"><h2 className="m-0 text-xl font-semibold" id="app-root-title">Choose the app whose history should continue.</h2><p className="mt-2 max-w-[70ch] text-muted">{kind === "REFRESH" ? "GitHub's current HEAD no longer contains the previous root. The active snapshot remains readable until the selected root finishes processing." : "Processing starts only after one discovered root is selected."}</p>{candidates.length === 0 ? <div className={ui.alert} role="alert"><strong>Candidate evidence unavailable.</strong><p>Reload the run status before continuing.</p></div> : <form className="mt-5" onSubmit={onSubmit}><fieldset className="m-0 border-0 p-0" disabled={configuring}><legend className="mb-2 font-mono text-xs uppercase text-cyan">Discovered application roots</legend><div className="grid gap-2">{candidates.map((candidate, index) => { const evidenceId = `app-root-evidence-${index}`; return <label className="grid min-h-11 grid-cols-[auto_minmax(0,1fr)] items-center gap-4 border border-line bg-panel p-4" key={candidate.path}><input aria-describedby={evidenceId} checked={selectedAppRoot === candidate.path} name="appRoot" onChange={() => onChange(candidate.path)} required type="radio" value={candidate.path} /><span className="min-w-0"><code className="break-all text-ink">{candidate.path}</code><small className="mt-1 block break-all font-mono text-muted" id={evidenceId}>{candidate.manifestPath}<br />routes: {candidate.routeRoots.join(", ")}</small></span></label>; })}</div><button className={`${ui.primaryButton} mt-4 w-full disabled:cursor-wait disabled:opacity-60`} disabled={!selectedAppRoot || configuring} type="submit">{configuring ? "Saving selection..." : "Queue selected root"}</button></fieldset></form>}</section>;
}
