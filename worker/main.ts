import { setTimeout as sleep } from "node:timers/promises";
import { parseEnvironment } from "../src/lib/environment";
import { createDatabasePool } from "../src/server/db/pool";
import { claimNextDueJob, completeJob, failJob, finalizeCancellation, getJobRunContext, markRateLimited, recordWorkerHeartbeat, scheduleRetry, type ClaimedJob } from "../src/server/jobs/repository";
import type { RetryPolicy } from "../src/server/jobs/retry-policy";
import { createGitHubSourceFromEnvironment } from "../src/server/github/client";
import { RepoReplayError } from "../src/server/github/errors";
import { ingestFirstParentHistory } from "../src/server/processing/ingest-first-parent";
import { persistCategoriesForRun } from "../src/server/processing/classifier";
import { detectDependenciesForHistory, detectRoutesForHistory } from "../src/server/processing/detectors";
import { advanceRunStep, persistDetectorOutput, persistIngestionMetadata, updateFetchProgress } from "../src/server/jobs/staged-repository";
import { validateRun } from "../src/server/processing/validate-run";
import { startJobHeartbeat, type HeartbeatController } from "./heartbeat";
import { createWorkerId } from "./identity";
import { startSweeper } from "./sweeper";

async function raceWithHeartbeat<T>(operation: Promise<T>, heartbeat: HeartbeatController): Promise<T> {
  const leaseFailure = heartbeat.lostLease.then(() => {
    throw new Error("Job lease was lost.");
  });
  return Promise.race([operation, leaseFailure]);
}

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
      const fetchStepStarted = await setRunStep(pool, job, "FETCH_COMMITS");
      if (!fetchStepStarted) throw new RepoReplayError("PROCESSING_FAILED", "Failed to start commit fetch: lease lost.");
      const ingestion = await raceWithHeartbeat(
        ingestFirstParentHistory({ source, pool, job, owner: context.owner, name: context.name, headSha: context.headSha, maxCommits: context.maxCommits, expectedCommitCount: context.expectedCommitCount, onCommitFetched: async (fetchedCommitCount) => {
          const updated = await updateFetchProgress(pool, job, fetchedCommitCount);
          if (!updated) throw new RepoReplayError("PROCESSING_FAILED", "Failed to persist fetch progress: lease lost.");
        } }),
        heartbeat,
      );
      const metadataPersisted = await persistIngestionMetadata(pool, job, { rootSha: ingestion.rootSha, expectedCommitCount: ingestion.count });
      if (!metadataPersisted) throw new RepoReplayError("PROCESSING_FAILED", "Failed to persist ingestion metadata: lease lost.");

      await raceWithHeartbeat(
        persistCategoriesForRun(pool, { jobId: job.jobId, runId: job.runId, repositoryId: job.repositoryId, workerId: job.workerId, leaseGeneration: job.leaseGeneration, step: "CLASSIFY_COMMITS", sequence: 0 }),
        heartbeat,
      );

      const historyInput = { source, owner: context.owner, name: context.name, selectedAppRoot: context.selectedAppRoot, commits: ingestion.commits };
      const dependencyOutput = await raceWithHeartbeat(detectDependenciesForHistory(historyInput), heartbeat);
      const dependenciesPersisted = await persistDetectorOutput(pool, { ...job, step: "DETECT_DEPENDENCIES", output: { dependencies: dependencyOutput.changes, warnings: dependencyOutput.warnings } });
      if (!dependenciesPersisted) throw new RepoReplayError("PROCESSING_FAILED", "Failed to persist dependency detection: lease lost.");

      const routeOutput = await raceWithHeartbeat(detectRoutesForHistory(historyInput), heartbeat);
      const routesPersisted = await persistDetectorOutput(pool, { ...job, step: "DETECT_ROUTES", output: routeOutput });
      if (!routesPersisted) throw new RepoReplayError("PROCESSING_FAILED", "Failed to persist route detection: lease lost.");

      const validated = await raceWithHeartbeat(validateRun(pool, job), heartbeat);
      if (!validated) throw new RepoReplayError("PROCESSING_FAILED", "Failed to validate run: lease lost.");
      const completed = await completeJob(pool, job);
      if (!completed) throw new RepoReplayError("PROCESSING_FAILED", "Failed to complete job: lease lost.");
    } catch (error) {
      if (await finalizeCancellation(pool, job)) return;
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

  async function setRunStep(jobPool: typeof pool, job: ClaimedJob, step: string): Promise<boolean> {
    const client = await jobPool.connect();
    try {
      return await advanceRunStep(client, job, step);
    } finally {
      client.release();
    }
  }
}

startWorker().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown worker startup failure";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
