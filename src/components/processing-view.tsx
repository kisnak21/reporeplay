"use client";

import Link from "next/link";
import { useState } from "react";
import type { ProcessingRunView } from "@/server/contracts/api";

const steps = [
  "Discover first-parent history",
  "Fetch commit evidence",
  "Classify commit messages",
  "Detect dependency transitions",
  "Detect route transitions",
  "Validate and activate snapshot",
];

export function ProcessingView({ run }: { run: ProcessingRunView }) {
  const [cancelled, setCancelled] = useState(false);

  return (
    <section aria-labelledby="processing-title">
      <header className="screenHead">
        <div>
          <p className="eyebrow">run {run.id} / lease active</p>
          <h1 id="processing-title">Processing durable evidence.</h1>
        </div>
        <p><code>acme/ledger</code><br /><code>main@9d8e7f6</code><br /><code>apps/storefront</code></p>
      </header>
      <div className="processLayout">
        <div>
          <div className="log" aria-label="Processing steps">
            {steps.map((step, index) => (
              <div className={`logRow ${index === 1 && !cancelled ? "current" : ""}`} key={step}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{step}</strong>
                <span className={index === 0 ? "statusOk" : index === 1 && !cancelled ? "statusLimit" : "muted"}>
                  {cancelled ? "cancelled" : index === 0 ? "complete" : index === 1 ? `${run.processedCommits} / ${run.expectedCommits}` : "queued"}
                </span>
              </div>
            ))}
          </div>
          <p className="caption" role="status" aria-live="polite">
            {cancelled ? "Run cancelled. No staged output was activated." : "Checkpoint persisted. Closing this page will not stop the worker."}
          </p>
        </div>
        <aside className="terminal">
          <div className="terminalHeader"><span>worker</span><span className={cancelled ? "statusLimit" : "statusOk"}>{cancelled ? "stopped" : "healthy"}</span></div>
          <div className="terminalBody"><div>attempt {run.attemptCount} / 4</div><div>github quota sufficient</div><div>previous snapshot none</div></div>
          <div className="stackActions">
            {cancelled ? <button className="button" onClick={() => setCancelled(false)} type="button">Retry run</button> : <button className="button" onClick={() => setCancelled(true)} type="button">Cancel run</button>}
            <Link className="button primary" href="/repositories/demo">Preview completed run</Link>
          </div>
        </aside>
      </div>
    </section>
  );
}
