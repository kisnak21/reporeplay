import type { Pool, PoolClient } from "pg";
import { computeRetryDelaySeconds, hasExhaustedAttempts, type RetryPolicy } from "./retry-policy";

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
    const jobs = await client.query<{ id: string; runId: string; attemptCount: number; maxAttempts: number }>(`SELECT "id","runId","attemptCount","maxAttempts" FROM "ProcessingJob" WHERE "status"='RUNNING' AND "leaseExpiresAt"<=CURRENT_TIMESTAMP FOR UPDATE SKIP LOCKED`);
    for (const job of jobs.rows) {
      const exhausted = hasExhaustedAttempts(job.attemptCount, job.maxAttempts); const status = exhausted ? "FAILED" : "RETRYABLE"; const delay = exhausted ? 0 : computeRetryDelaySeconds(job.attemptCount, policy, () => 0);
      await client.query(`UPDATE "ProcessingJob" SET "status"=$1::"ProcessingJobStatus","nextAttemptAt"=CURRENT_TIMESTAMP + ($2 * INTERVAL '1 second'),"leaseOwner"=NULL,"leaseExpiresAt"=NULL,"heartbeatAt"=NULL,"lastErrorCode"=$3,"lastErrorMessage"=$4,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$5`, [status, delay, exhausted ? "JOB_ATTEMPTS_EXHAUSTED" : "WORKER_LEASE_EXPIRED", exhausted ? "The job exceeded its attempt limit." : "The worker lease expired before completion.", job.id]);
      await client.query(`UPDATE "ProcessingRun" SET "status"=$1::"ProcessingRunStatus","errorCode"=$2,"errorMessage"=$3,"completedAt"=CASE WHEN $1='FAILED' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE "id"=$4`, [status, exhausted ? "JOB_ATTEMPTS_EXHAUSTED" : "WORKER_LEASE_EXPIRED", exhausted ? "The job exceeded its attempt limit." : "The worker lease expired before completion.", job.runId]);
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

export async function getJobRunContext(pool: Pool, runId: string): Promise<{ repositoryId: string; owner: string; name: string; headSha: string; defaultBranch: string; maxCommits: number } | null> {
  const result = await pool.query<{ repositoryId: string; owner: string; name: string; headSha: string; defaultBranch: string; maxCommits: number }>(
    `SELECT r."repositoryId", repo."owner", repo."name", r."headSha", r."defaultBranch", r."maxCommitLimit" AS "maxCommits" FROM "ProcessingRun" r JOIN "Repository" repo ON repo."id"=r."repositoryId" WHERE r."id"=$1`,
    [runId],
  );
  return result.rows[0] ?? null;
}

export async function completeJob(pool: Pool, job: ClaimedJob): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const jobResult = await client.query(
      `UPDATE "ProcessingJob" SET "status"='SUCCEEDED',"leaseOwner"=NULL,"leaseExpiresAt"=NULL,"heartbeatAt"=NULL,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "runId"=$2 AND "status"='RUNNING' AND "leaseOwner"=$3 AND "leaseGeneration"=$4 AND "leaseExpiresAt">CURRENT_TIMESTAMP RETURNING "runId"`,
      [job.jobId, job.runId, job.workerId, job.leaseGeneration],
    );
    if (jobResult.rowCount !== 1) { await client.query("ROLLBACK"); return false; }
    await client.query(`UPDATE "ProcessingRun" SET "status"='SUCCEEDED',"completedAt"=CURRENT_TIMESTAMP,"currentStep"='COMPLETE',"checkpointSequence"=(SELECT COALESCE(MAX("sequence"),-1) FROM "RunCommit" WHERE "runId"=$1) WHERE "id"=$1`, [job.runId]);
    await client.query("COMMIT");
    return true;
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function failJob(pool: Pool, job: ClaimedJob, code: string, message: string): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const jobResult = await client.query(`UPDATE "ProcessingJob" SET "status"='FAILED',"leaseOwner"=NULL,"leaseExpiresAt"=NULL,"heartbeatAt"=NULL,"lastErrorCode"=$1,"lastErrorMessage"=$2,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$3 AND "runId"=$4 AND "status"='RUNNING' AND "leaseOwner"=$5 AND "leaseGeneration"=$6 RETURNING "runId"`, [code, message, job.jobId, job.runId, job.workerId, job.leaseGeneration]);
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
    const jobResult = await client.query(`UPDATE "ProcessingJob" SET "status"='WAITING_RATE_LIMIT',"nextAttemptAt"=$1,"leaseOwner"=NULL,"leaseExpiresAt"=NULL,"heartbeatAt"=NULL,"lastErrorCode"=$2,"lastErrorMessage"=$3,"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$4 AND "runId"=$5 AND "status"='RUNNING' AND "leaseOwner"=$6 AND "leaseGeneration"=$7 RETURNING "runId"`, [resetAt, code, message, job.jobId, job.runId, job.workerId, job.leaseGeneration]);
    if (jobResult.rowCount !== 1) { await client.query("ROLLBACK"); return false; }
    await client.query(`UPDATE "ProcessingRun" SET "status"='WAITING_RATE_LIMIT',"errorCode"=$1,"errorMessage"=$2 WHERE "id"=$3`, [code, message, job.runId]);
    await client.query("COMMIT");
    return true;
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function withTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect(); try { await client.query("BEGIN"); const result = await operation(client); await client.query("COMMIT"); return result; } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
