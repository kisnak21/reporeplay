import type { Pool, PoolClient } from "pg";
import { computeRetryDelaySeconds, hasExhaustedAttempts, type RetryPolicy } from "./retry-policy";

export const DEFAULT_WORKER_HEARTBEAT_TIMEOUT_SECONDS = 120;
export const WORKER_HEALTH_STATES = ["HEALTHY", "DEGRADED", "OFFLINE"] as const;
export type WorkerHealthState = (typeof WORKER_HEALTH_STATES)[number];

export interface WorkerLiveness {
  status: WorkerHealthState;
  lastHeartbeatAt: Date | null;
  heartbeatAgeSeconds: number | null;
}

export interface WorkerHealthSnapshot {
  status: WorkerHealthState;
  checkedAt: Date;
  heartbeatTimeoutSeconds: number;
  workers: Array<{
    workerId: string;
    processVersion: string;
    lastHeartbeatAt: Date;
    heartbeatAgeSeconds: number;
    lastClaimAt: Date | null;
    lastSuccessAt: Date | null;
    activeJobCount: number;
  }>;
  queue: { dueJobs: number; expiredJobs: number; oldestDueSeconds: number | null };
}

export interface ClaimedJob {
  jobId: string;
  runId: string;
  repositoryId: string;
  workerId: string;
  leaseGeneration: number;
  leaseExpiresAt: Date;
  attemptCount: number;
  maxAttempts: number;
}

interface ClaimRow {
  jobId: string; runId: string; repositoryId: string; leaseGeneration: number; leaseExpiresAt: Date; attemptCount: number; maxAttempts: number;
}

export async function claimNextDueJob(pool: Pool, workerId: string, leaseSeconds: number): Promise<ClaimedJob | null> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<ClaimRow>(`WITH candidate AS (
      SELECT j."id" FROM "ProcessingJob" j
      JOIN "ProcessingRun" r ON r."id" = j."runId"
      JOIN "Repository" repo ON repo."id" = r."repositoryId"
      WHERE j."status" IN ('QUEUED','RETRYABLE','WAITING_RATE_LIMIT')
        AND j."nextAttemptAt" <= CURRENT_TIMESTAMP
        AND r."status" IN ('QUEUED','RETRYABLE','WAITING_RATE_LIMIT')
        AND repo."deletedAt" IS NULL
      ORDER BY j."priority" DESC, j."nextAttemptAt", j."createdAt", j."id"
      FOR UPDATE OF j SKIP LOCKED LIMIT 1
    ), claimed AS (
      UPDATE "ProcessingJob" j SET "status"='RUNNING', "leaseOwner"=$1,
        "leaseExpiresAt"=CURRENT_TIMESTAMP + ($2 * INTERVAL '1 second'),
        "heartbeatAt"=CURRENT_TIMESTAMP, "attemptCount"=j."attemptCount"+1,
        "leaseGeneration"=j."leaseGeneration"+1, "updatedAt"=CURRENT_TIMESTAMP
      FROM candidate c WHERE j."id"=c."id"
      RETURNING j."id",j."runId",j."leaseGeneration",j."leaseExpiresAt",j."attemptCount",j."maxAttempts"
    ), updated_run AS (
      UPDATE "ProcessingRun" r SET "status"='RUNNING', "startedAt"=COALESCE(r."startedAt",CURRENT_TIMESTAMP)
      FROM claimed c WHERE r."id"=c."runId"
      RETURNING r."id",r."repositoryId"
    )
    SELECT c."id" AS "jobId",c."runId",u."repositoryId",c."leaseGeneration",c."leaseExpiresAt",c."attemptCount",c."maxAttempts"
    FROM claimed c JOIN updated_run u ON u."id"=c."runId"`, [workerId, leaseSeconds]);
    await client.query("COMMIT");
    const row = result.rows[0];
    return row ? { ...row, workerId } : null;
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function heartbeatJob(pool: Pool, job: ClaimedJob, leaseSeconds: number): Promise<boolean> {
  const result = await pool.query(`UPDATE "ProcessingJob" SET "leaseExpiresAt"=CURRENT_TIMESTAMP + ($1 * INTERVAL '1 second'),"heartbeatAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP
    WHERE "id"=$2 AND "runId"=$3 AND "status"='RUNNING' AND "leaseOwner"=$4 AND "leaseGeneration"=$5 AND "leaseExpiresAt">CURRENT_TIMESTAMP RETURNING "id"`, [leaseSeconds, job.jobId, job.runId, job.workerId, job.leaseGeneration]);
  return result.rowCount === 1;
}

export async function requestCancellation(pool: Pool, jobId: string): Promise<"CANCELLED" | "REQUESTED" | "NOT_FOUND"> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const immediate = await client.query<{ runId: string }>(`UPDATE "ProcessingJob" SET "status"='CANCELLED',"updatedAt"=CURRENT_TIMESTAMP
      WHERE "id"=$1 AND "status" IN ('QUEUED','RETRYABLE','WAITING_RATE_LIMIT') RETURNING "runId"`, [jobId]);
    if (immediate.rows[0]) { await client.query(`UPDATE "ProcessingRun" SET "status"='CANCELLED',"completedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, [immediate.rows[0].runId]); await client.query("COMMIT"); return "CANCELLED"; }
    const requested = await client.query(`UPDATE "ProcessingJob" SET "cancelRequestedAt"=CURRENT_TIMESTAMP,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "status"='RUNNING' RETURNING "id"`, [jobId]);
    await client.query("COMMIT"); return requested.rowCount ? "REQUESTED" : "NOT_FOUND";
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export type RetryRunResult = "QUEUED" | "NOT_FOUND" | "NOT_RETRYABLE" | "RUN_ALREADY_ACTIVE";

export async function retryFailedRun(pool: Pool, repositoryId: string, runId: string): Promise<RetryRunResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const repository = await client.query(`SELECT "id" FROM "Repository" WHERE "id"=$1 FOR UPDATE`, [repositoryId]);
    if (!repository.rows[0]) { await client.query("ROLLBACK"); return "NOT_FOUND"; }

    const runResult = await client.query<{ status: string; jobId: string }>(
      `SELECT r."status"::text,j."id" AS "jobId" FROM "ProcessingRun" r JOIN "ProcessingJob" j ON j."runId"=r."id" WHERE r."id"=$1 AND r."repositoryId"=$2 FOR UPDATE OF r,j`,
      [runId, repositoryId],
    );
    const run = runResult.rows[0];
    if (!run) { await client.query("ROLLBACK"); return "NOT_FOUND"; }
    if (run.status !== "FAILED") { await client.query("ROLLBACK"); return "NOT_RETRYABLE"; }

    const activeRun = await client.query(
      `SELECT "id" FROM "ProcessingRun" WHERE "repositoryId"=$1 AND "id"<>$2 AND "status" IN ('NEEDS_CONFIGURATION','QUEUED','RUNNING','WAITING_RATE_LIMIT','RETRYABLE') LIMIT 1`,
      [repositoryId, runId],
    );
    if (activeRun.rows[0]) { await client.query("ROLLBACK"); return "RUN_ALREADY_ACTIVE"; }

    await client.query(
      `UPDATE "ProcessingJob" SET "status"='QUEUED',"attemptCount"=0,"nextAttemptAt"=CURRENT_TIMESTAMP,"leaseOwner"=NULL,"leaseExpiresAt"=NULL,"heartbeatAt"=NULL,"cancelRequestedAt"=NULL,"lastErrorCode"=NULL,"lastErrorMessage"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "runId"=$2 AND "status"='FAILED'`,
      [run.jobId, runId],
    );
    await client.query(
      `UPDATE "ProcessingRun" SET "status"='QUEUED',"currentStep"='DISCOVER_HISTORY',"fetchedCommitCount"=0,"processedCommitCount"=0,"checkpointSequence"=-1,"checkpointUpdatedAt"=NULL,"startedAt"=NULL,"completedAt"=NULL,"activatedAt"=NULL,"errorCode"=NULL,"errorMessage"=NULL WHERE "id"=$1 AND "repositoryId"=$2 AND "status"='FAILED'`,
      [runId, repositoryId],
    );
    await client.query("COMMIT");
    return "QUEUED";
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function finalizeCancellation(pool: Pool, job: ClaimedJob): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query<{ runId: string }>(`UPDATE "ProcessingJob" SET "status"='CANCELLED',"leaseOwner"=NULL,"leaseExpiresAt"=NULL,"heartbeatAt"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "runId"=$2 AND "status"='RUNNING' AND "leaseOwner"=$3 AND "leaseGeneration"=$4 AND "cancelRequestedAt" IS NOT NULL RETURNING "runId"`, [job.jobId, job.runId, job.workerId, job.leaseGeneration]);
    if (!updated.rows[0]) { await client.query("ROLLBACK"); return false; }
    await client.query(`UPDATE "ProcessingRun" SET "status"='CANCELLED',"completedAt"=CURRENT_TIMESTAMP,"errorCode"=NULL,"errorMessage"=NULL WHERE "id"=$1`, [updated.rows[0].runId]);
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function scheduleRetry(pool: Pool, job: ClaimedJob, policy: RetryPolicy, code: string, message: string, random?: () => number): Promise<"RETRYABLE" | "FAILED" | "LEASE_LOST"> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const exhausted = hasExhaustedAttempts(job.attemptCount, job.maxAttempts);
    const status = exhausted ? "FAILED" : "RETRYABLE";
    const delay = exhausted ? 0 : computeRetryDelaySeconds(job.attemptCount, policy, random);
    const updated = await client.query<{ runId: string }>(`UPDATE "ProcessingJob" SET "status"=$1::"ProcessingJobStatus","nextAttemptAt"=CURRENT_TIMESTAMP + ($2 * INTERVAL '1 second'),"leaseOwner"=NULL,"leaseExpiresAt"=NULL,"heartbeatAt"=NULL,"lastErrorCode"=$3,"lastErrorMessage"=$4,"updatedAt"=CURRENT_TIMESTAMP
      WHERE "id"=$5 AND "status"='RUNNING' AND "leaseOwner"=$6 AND "leaseGeneration"=$7 AND "leaseExpiresAt">CURRENT_TIMESTAMP RETURNING "runId"`, [status, delay, code, message, job.jobId, job.workerId, job.leaseGeneration]);
    if (!updated.rows[0]) { await client.query("ROLLBACK"); return "LEASE_LOST"; }
    await client.query(`UPDATE "ProcessingRun" SET "status"=$1::"ProcessingRunStatus","errorCode"=$2,"errorMessage"=$3,"completedAt"=CASE WHEN $1='FAILED' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE "id"=$4`, [status, code, message, updated.rows[0].runId]);
    await client.query("COMMIT"); return status;
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function recoverExpiredJobs(pool: Pool, policy: RetryPolicy): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const jobs = await client.query<{ id: string; runId: string; attemptCount: number; maxAttempts: number; cancelRequestedAt: Date | null }>(`SELECT "id","runId","attemptCount","maxAttempts","cancelRequestedAt" FROM "ProcessingJob" WHERE "status"='RUNNING' AND "leaseExpiresAt"<=CURRENT_TIMESTAMP FOR UPDATE SKIP LOCKED`);
    for (const job of jobs.rows) {
      const cancelled = job.cancelRequestedAt !== null;
      const exhausted = hasExhaustedAttempts(job.attemptCount, job.maxAttempts);
      const status = cancelled ? "CANCELLED" : exhausted ? "FAILED" : "RETRYABLE";
      const delay = cancelled || exhausted ? 0 : computeRetryDelaySeconds(job.attemptCount, policy, () => 0);
      const code = cancelled ? "JOB_CANCELLED" : exhausted ? "JOB_ATTEMPTS_EXHAUSTED" : "WORKER_LEASE_EXPIRED";
      const message = cancelled ? "The job was cancelled while its worker lease expired." : exhausted ? "The job exceeded its attempt limit." : "The worker lease expired before completion.";
      await client.query(`UPDATE "ProcessingJob" SET "status"=$1::"ProcessingJobStatus","nextAttemptAt"=CURRENT_TIMESTAMP + ($2 * INTERVAL '1 second'),"leaseOwner"=NULL,"leaseExpiresAt"=NULL,"heartbeatAt"=NULL,"lastErrorCode"=$3,"lastErrorMessage"=$4,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$5`, [status, delay, code, message, job.id]);
      await client.query(`UPDATE "ProcessingRun" SET "status"=$1::"ProcessingRunStatus","errorCode"=CASE WHEN $1='CANCELLED' THEN NULL ELSE $2 END,"errorMessage"=CASE WHEN $1='CANCELLED' THEN NULL ELSE $3 END,"completedAt"=CASE WHEN $1 IN ('FAILED','CANCELLED') THEN CURRENT_TIMESTAMP ELSE NULL END WHERE "id"=$4`, [status, code, message, job.runId]);
    }
    await client.query("COMMIT"); return jobs.rowCount ?? 0;
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function recordWorkerHeartbeat(pool: Pool, workerId: string, processVersion: string, currentJobId: string | null = null): Promise<void> {
  await pool.query(`INSERT INTO "WorkerHeartbeat"("workerId","processVersion","currentJobId") VALUES($1,$2,$3)
    ON CONFLICT("workerId") DO UPDATE SET "lastHeartbeatAt"=CURRENT_TIMESTAMP,"currentJobId"=EXCLUDED."currentJobId","processVersion"=EXCLUDED."processVersion"`, [workerId, processVersion, currentJobId]);
}

export async function getQueueHealth(pool: Pool): Promise<{ dueJobs: number; expiredJobs: number; oldestDueSeconds: number | null }> {
  const result = await pool.query<{ dueJobs: number; expiredJobs: number; oldestDueSeconds: number | null }>(`SELECT
    COUNT(*) FILTER (WHERE "status" IN ('QUEUED','RETRYABLE','WAITING_RATE_LIMIT') AND "nextAttemptAt"<=CURRENT_TIMESTAMP)::int AS "dueJobs",
    COUNT(*) FILTER (WHERE "status"='RUNNING' AND "leaseExpiresAt"<=CURRENT_TIMESTAMP)::int AS "expiredJobs",
    EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-MIN("nextAttemptAt") FILTER (WHERE "status" IN ('QUEUED','RETRYABLE','WAITING_RATE_LIMIT') AND "nextAttemptAt"<=CURRENT_TIMESTAMP)))::float AS "oldestDueSeconds"
    FROM "ProcessingJob"`);
  return result.rows[0];
}

export async function getWorkerLiveness(pool: Pool, heartbeatTimeoutSeconds = DEFAULT_WORKER_HEARTBEAT_TIMEOUT_SECONDS): Promise<WorkerLiveness> {
  const result = await pool.query<{ lastHeartbeatAt: Date; heartbeatAgeSeconds: number }>(`SELECT "lastHeartbeatAt",EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-"lastHeartbeatAt"))::float AS "heartbeatAgeSeconds" FROM "WorkerHeartbeat" ORDER BY "lastHeartbeatAt" DESC LIMIT 1`);
  const row = result.rows[0];
  if (!row) return { status: "OFFLINE", lastHeartbeatAt: null, heartbeatAgeSeconds: null };
  const heartbeatAgeSeconds = Math.max(0, row.heartbeatAgeSeconds);
  return { status: heartbeatAgeSeconds <= heartbeatTimeoutSeconds ? "HEALTHY" : "OFFLINE", lastHeartbeatAt: row.lastHeartbeatAt, heartbeatAgeSeconds };
}

export async function getWorkerHealth(pool: Pool, heartbeatTimeoutSeconds: number, queueLagWarnSeconds: number): Promise<WorkerHealthSnapshot> {
  const [queue, workers, activeJobs] = await Promise.all([
    getQueueHealth(pool),
    pool.query<{ workerId: string; processVersion: string; lastHeartbeatAt: Date; heartbeatAgeSeconds: number; lastClaimAt: Date | null; lastSuccessAt: Date | null }>(`SELECT "workerId","processVersion","lastHeartbeatAt",EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP-"lastHeartbeatAt"))::float AS "heartbeatAgeSeconds","lastClaimAt","lastSuccessAt" FROM "WorkerHeartbeat" ORDER BY "lastHeartbeatAt" DESC`),
    pool.query<{ workerId: string; activeJobCount: number }>(`SELECT "leaseOwner" AS "workerId",COUNT(*)::int AS "activeJobCount" FROM "ProcessingJob" WHERE "status"='RUNNING' AND "leaseOwner" IS NOT NULL AND "leaseExpiresAt">CURRENT_TIMESTAMP GROUP BY "leaseOwner"`),
  ]);
  const activeJobCounts = new Map(activeJobs.rows.map((row) => [row.workerId, row.activeJobCount]));
  const workerRows = workers.rows.map((worker) => ({ ...worker, heartbeatAgeSeconds: Math.max(0, worker.heartbeatAgeSeconds), activeJobCount: activeJobCounts.get(worker.workerId) ?? 0 }));
  const liveWorkers = workerRows.filter((worker) => worker.heartbeatAgeSeconds <= heartbeatTimeoutSeconds);
  const queueLagging = queue.oldestDueSeconds !== null && queue.oldestDueSeconds > queueLagWarnSeconds;
  const status: WorkerHealthState = liveWorkers.length === 0 ? "OFFLINE" : queue.expiredJobs > 0 || queueLagging ? "DEGRADED" : "HEALTHY";
  return { status, checkedAt: new Date(), heartbeatTimeoutSeconds, workers: workerRows, queue };
}

export async function getJobRunContext(pool: Pool, runId: string): Promise<{ repositoryId: string; owner: string; name: string; headSha: string; defaultBranch: string; selectedAppRoot: string; maxCommits: number; expectedCommitCount: number } | null> {
  const result = await pool.query<{ repositoryId: string; owner: string; name: string; headSha: string; defaultBranch: string; selectedAppRoot: string | null; maxCommits: number; expectedCommitCount: number | null }>(
    `SELECT r."repositoryId", repo."owner", repo."name", r."headSha", r."defaultBranch", r."selectedAppRoot", r."maxCommitLimit" AS "maxCommits", r."expectedCommitCount" FROM "ProcessingRun" r JOIN "Repository" repo ON repo."id"=r."repositoryId" WHERE r."id"=$1`,
    [runId],
  );
  const row = result.rows[0];
  if (!row || !row.selectedAppRoot || row.expectedCommitCount === null) return null;
  return { ...row, selectedAppRoot: row.selectedAppRoot, expectedCommitCount: row.expectedCommitCount };
}

export async function completeJob(pool: Pool, job: ClaimedJob): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const jobResult = await client.query(
      `UPDATE "ProcessingJob" SET "status"='SUCCEEDED',"leaseOwner"=NULL,"leaseExpiresAt"=NULL,"heartbeatAt"=NULL,"lastErrorCode"=NULL,"lastErrorMessage"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "runId"=$2 AND "status"='RUNNING' AND "leaseOwner"=$3 AND "leaseGeneration"=$4 AND "leaseExpiresAt">CURRENT_TIMESTAMP AND "cancelRequestedAt" IS NULL AND EXISTS (SELECT 1 FROM "ProcessingRun" r WHERE r."id"=$2 AND r."status"='RUNNING' AND r."currentStep"='ACTIVATE_RUN') RETURNING "runId"`,
      [job.jobId, job.runId, job.workerId, job.leaseGeneration],
    );
    if (jobResult.rowCount !== 1) { await client.query("ROLLBACK"); return false; }
    await client.query(`UPDATE "ProcessingRun" SET "status"='SUCCEEDED',"completedAt"=CURRENT_TIMESTAMP,"activatedAt"=CURRENT_TIMESTAMP,"currentStep"='COMPLETE',"checkpointSequence"=(SELECT COALESCE(MAX("sequence"),-1) FROM "RunCommit" WHERE "runId"=$1),"errorCode"=NULL,"errorMessage"=NULL WHERE "id"=$1`, [job.runId]);
    await client.query(
      `UPDATE "Repository" repository
       SET "previousRunId"=repository."activeRunId",
         "activeRunId"=$1,
         "defaultBranch"=run."defaultBranch",
         "selectedAppRoot"=run."selectedAppRoot",
         "availability"='READY',
         "updatedAt"=CURRENT_TIMESTAMP
       FROM "ProcessingRun" run
       WHERE repository."id"=$2 AND run."id"=$1 AND run."repositoryId"=repository."id"`,
      [job.runId, job.repositoryId],
    );
    await client.query("COMMIT");
    return true;
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function failJob(pool: Pool, job: ClaimedJob, code: string, message: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const jobResult = await client.query(`UPDATE "ProcessingJob" SET "status"='FAILED',"leaseOwner"=NULL,"leaseExpiresAt"=NULL,"heartbeatAt"=NULL,"lastErrorCode"=$1,"lastErrorMessage"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$3 AND "runId"=$4 AND "status"='RUNNING' AND "leaseOwner"=$5 AND "leaseGeneration"=$6 AND "leaseExpiresAt">CURRENT_TIMESTAMP RETURNING "runId"`, [code, message, job.jobId, job.runId, job.workerId, job.leaseGeneration]);
    if (jobResult.rowCount !== 1) { await client.query("ROLLBACK"); return false; }
    await client.query(`UPDATE "ProcessingRun" SET "status"='FAILED',"errorCode"=$1,"errorMessage"=$2,"completedAt"=CURRENT_TIMESTAMP WHERE "id"=$3`, [code, message, job.runId]);
    await client.query("COMMIT");
    return true;
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function markRateLimited(pool: Pool, job: ClaimedJob, resetAt: Date, code = "GITHUB_RATE_LIMITED", message = "GitHub rate limit exceeded."): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const jobResult = await client.query(`UPDATE "ProcessingJob" SET "status"='WAITING_RATE_LIMIT',"nextAttemptAt"=$1,"leaseOwner"=NULL,"leaseExpiresAt"=NULL,"heartbeatAt"=NULL,"lastErrorCode"=$2,"lastErrorMessage"=$3,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$4 AND "runId"=$5 AND "status"='RUNNING' AND "leaseOwner"=$6 AND "leaseGeneration"=$7 AND "leaseExpiresAt">CURRENT_TIMESTAMP RETURNING "runId"`, [resetAt, code, message, job.jobId, job.runId, job.workerId, job.leaseGeneration]);
    if (jobResult.rowCount !== 1) { await client.query("ROLLBACK"); return false; }
    await client.query(`UPDATE "ProcessingRun" SET "status"='WAITING_RATE_LIMIT',"errorCode"=$1,"errorMessage"=$2 WHERE "id"=$3`, [code, message, job.runId]);
    await client.query("COMMIT");
    return true;
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function withTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect(); try { await client.query("BEGIN"); const result = await operation(client); await client.query("COMMIT"); return result; } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
