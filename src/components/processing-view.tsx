"use client";

import Link from "next/link";
import { useState } from "react";
import type { ProcessingRunView } from "@/server/contracts/api";
import { ui } from "@/lib/ui";

const PROCESSING_STEPS = [
  "Discover first-parent history",
  "Fetch commit evidence",
  "Classify commit messages",
  "Detect dependency transitions",
  "Detect route transitions",
  "Validate and activate snapshot",
];

interface ProcessingViewProps {
  run: ProcessingRunView;
}

export function ProcessingView({ run }: ProcessingViewProps) {
  const [cancelled, setCancelled] = useState(false);

  return (
    <section aria-labelledby="processing-title">
      <header className={ui.screenHead}>
        <div>
          <p className={ui.eyebrow}>run {run.id} / lease active</p>
          <h1 className={ui.sectionTitle} id="processing-title">
            Processing durable evidence.
          </h1>
        </div>
        <p className="m-0 text-muted">
          <code>acme/ledger</code>
          <br />
          <code>main@9d8e7f6</code>
          <br />
          <code>apps/storefront</code>
        </p>
      </header>

      <div className="mt-8 grid grid-cols-[minmax(0,1fr)_20rem] gap-8 max-[800px]:grid-cols-1">
        <div>
          <ol
            aria-label="Processing steps"
            className="m-0 list-none border border-line bg-[#090d0f] p-0"
          >
            {PROCESSING_STEPS.map((step, index) => {
              const active = index === 1 && !cancelled;
              const status = cancelled
                ? "cancelled"
                : index === 0
                  ? "complete"
                  : active
                    ? `${run.processedCommits} / ${run.expectedCommits}`
                    : "queued";
              const statusClass = cancelled
                ? ui.muted
                : index === 0
                  ? ui.positive
                  : active
                    ? ui.signal
                    : ui.muted;

              return (
                <li
                  aria-current={active ? "step" : undefined}
                  className={`grid grid-cols-[3rem_minmax(0,1fr)_auto] gap-4 border-b border-soft p-4 font-mono text-xs last:border-b-0 max-[560px]:grid-cols-1 ${active ? "bg-[#1d1a12]" : ""}`}
                  key={step}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{step}</strong>
                  <span className={statusClass}>{status}</span>
                </li>
              );
            })}
          </ol>

          <p className="mt-3 font-mono text-xs text-muted" role="status" aria-live="polite">
            {cancelled
              ? "Run cancelled. No staged output was activated."
              : "Checkpoint persisted. Closing this page will not stop the worker."}
          </p>
        </div>

        <aside className={ui.terminal}>
          <div className={ui.terminalHeader}>
            <span>worker</span>
            <span className={cancelled ? ui.signal : ui.positive}>
              {cancelled ? "stopped" : "healthy"}
            </span>
          </div>
          <div className={ui.terminalBody}>
            <div>attempt {run.attemptCount} / 4</div>
            <div>github quota sufficient</div>
            <div>worker {run.worker.status.toLowerCase()}</div>
            <div>previous snapshot none</div>
          </div>
          <div className="flex flex-col gap-3 px-4 pb-4">
            <button
              className={ui.button}
              onClick={() => setCancelled((wasCancelled) => !wasCancelled)}
              type="button"
            >
              {cancelled ? "Retry run" : "Cancel run"}
            </button>
            <Link className={ui.primaryButton} href="/repositories/demo">
              Preview completed run
            </Link>
          </div>
        </aside>
      </div>
    </section>
  );
}
