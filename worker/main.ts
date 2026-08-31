import { setTimeout as sleep } from "node:timers/promises";
import { parseEnvironment } from "../src/lib/environment";
import { createDatabasePool } from "../src/server/db/pool";
import { claimNextDueJob, recordWorkerHeartbeat, scheduleRetry, type ClaimedJob } from "../src/server/jobs/repository";
import type { RetryPolicy } from "../src/server/jobs/retry-policy";
import { startJobHeartbeat } from "./heartbeat";
import { createWorkerId } from "./identity";
import { startSweeper } from "./sweeper";

async function startWorker(): Promise<void> {
  const environment = parseEnvironment(process.env);
  const workerId = createWorkerId(environment.WORKER_ID);
  const pool = createDatabasePool(environment.DATABASE_URL);
  const retryPolicy: RetryPolicy = { baseSeconds: environment.JOB_RETRY_BASE_SECONDS, maxSeconds: environment.JOB_RETRY_MAX_SECONDS, jitterPercent: environment.JOB_RETRY_JITTER_PERCENT };
  const sweeper = startSweeper(pool, environment.WORKER_SWEEP_INTERVAL_MS, retryPolicy);
  const active = new Set<Promise<void>>();
  let shuttingDown = false;

  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    sweeper.stop();
    await Promise.race([Promise.allSettled(active), sleep(environment.WORKER_GRACEFUL_SHUTDOWN_MS)]);
    await pool.end();
  }

  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
  await recordWorkerHeartbeat(pool, workerId, "0.1.0");
  process.stdout.write(`RepoReplay worker ${workerId} ready\n`);

  while (!shuttingDown) {
    await recordWorkerHeartbeat(pool, workerId, "0.1.0");
    while (!shuttingDown && active.size < environment.WORKER_CONCURRENCY) {
      const job = await claimNextDueJob(pool, workerId, environment.JOB_LEASE_SECONDS);
      if (!job) break;
      const execution = executePlaceholderJob(job).finally(() => active.delete(execution));
      active.add(execution);
    }
    await sleep(environment.WORKER_POLL_INTERVAL_MS);
  }

  async function executePlaceholderJob(job: ClaimedJob): Promise<void> {
    const heartbeat = startJobHeartbeat(pool, job, environment.JOB_HEARTBEAT_SECONDS, environment.JOB_LEASE_SECONDS);
    try {
      await Promise.race([sleep(50), heartbeat.lostLease]);
      await scheduleRetry(pool, job, retryPolicy, "PROCESSOR_NOT_IMPLEMENTED", "Repository processing steps are not implemented yet.");
    } finally {
      heartbeat.stop();
    }
  }
}

startWorker().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown worker startup failure";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
