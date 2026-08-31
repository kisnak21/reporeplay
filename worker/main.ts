import { setTimeout as sleep } from "node:timers/promises";
import { parseEnvironment } from "../src/lib/environment";
import { createDatabasePool } from "../src/server/db/pool";
import { claimNextDueJob, completeJob, failJob, getJobRunContext, markRateLimited, recordWorkerHeartbeat, scheduleRetry, type ClaimedJob } from "../src/server/jobs/repository";
import type { RetryPolicy } from "../src/server/jobs/retry-policy";
import { createGitHubSourceFromEnvironment } from "../src/server/github/client";
import { RepoReplayError } from "../src/server/github/errors";
import { ingestFirstParentHistory } from "../src/server/processing/ingest-first-parent";
import { persistCategoriesForRun } from "../src/server/processing/classifier";
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
      const execution = executeJob(job).finally(() => active.delete(execution));
      active.add(execution);
    }
    await sleep(environment.WORKER_POLL_INTERVAL_MS);
  }

  async function executeJob(job: ClaimedJob): Promise<void> {
    const heartbeat = startJobHeartbeat(pool, job, environment.JOB_HEARTBEAT_SECONDS, environment.JOB_LEASE_SECONDS);
    try {
      const context = await getJobRunContext(pool, job.runId);
      if (!context) throw new RepoReplayError("PROCESSING_FAILED", "Run context not found.");
      const source = createGitHubSourceFromEnvironment(environment);
      await Promise.race([
        ingestFirstParentHistory({ source, pool, job, owner: context.owner, name: context.name, headSha: context.headSha, maxCommits: context.maxCommits }),
        heartbeat.lostLease,
      ]);
      await Promise.race([
        persistCategoriesForRun(pool, { jobId: job.jobId, runId: job.runId, repositoryId: job.repositoryId, workerId: job.workerId, leaseGeneration: job.leaseGeneration, step: "CLASSIFY_COMMITS", sequence: 0 }),
        heartbeat.lostLease,
      ]);
      const completed = await completeJob(pool, job);
      if (!completed) throw new RepoReplayError("PROCESSING_FAILED", "Failed to complete job: lease lost.");
    } catch (error) {
      if (error instanceof RepoReplayError) {
        if (error.code === "GITHUB_RATE_LIMITED") {
          const resetAt = error.details.resetAt ? new Date(String(error.details.resetAt)) : new Date(Date.now() + 60_000);
          await markRateLimited(pool, job, resetAt, error.code, error.message);
          return;
        }
        if (error.code === "GITHUB_UNAVAILABLE" || error.code === "GITHUB_DATA_TRUNCATED") {
          const result = await scheduleRetry(pool, job, retryPolicy, error.code, error.message);
          if (result === "LEASE_LOST") return;
          return;
        }
        if (error.code === "REPOSITORY_LIMIT_EXCEEDED" || error.code === "REPOSITORY_NOT_FOUND" || error.code === "EMPTY_REPOSITORY" || error.code === "UNSUPPORTED_REPOSITORY") {
          await failJob(pool, job, error.code, error.message);
          return;
        }
        await failJob(pool, job, error.code, error.message);
        return;
      }
      await scheduleRetry(pool, job, retryPolicy, "PROCESSING_FAILED", error instanceof Error ? error.message : "Unknown processing failure");
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
