import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { claimNextDueJob, completeJob, heartbeatJob, recoverExpiredJobs, requestCancellation, retryFailedRun } from "../../src/server/jobs/repository";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const retryPolicy = { baseSeconds: 1, maxSeconds: 10, jitterPercent: 0 };

describeDatabase("durable PostgreSQL jobs", () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 6 });
  beforeAll(async () => pool.query("SELECT 1"));
  beforeEach(async () => cleanupFixtures(pool));
  afterEach(async () => cleanupFixtures(pool));
  afterAll(async () => pool.end());

  it("allows only one competing worker to claim a job", async () => {
    const fixture = await createFixture(pool, "competing");
    const [first, second] = await Promise.all([claimNextDueJob(pool, "worker-a", 60), claimNextDueJob(pool, "worker-b", 60)]);
    const claims = [first, second].filter(Boolean);
    expect(claims).toHaveLength(1);
    expect(claims[0]?.jobId).toBe(fixture.jobId);
    await cleanup(pool, fixture.repositoryId);
  });

  it("fences heartbeat by owner and lease generation", async () => {
    const fixture = await createFixture(pool, "heartbeat");
    const job = await claimNextDueJob(pool, "worker-a", 60);
    expect(job).not.toBeNull();
    if (!job) return;
    expect(await heartbeatJob(pool, job, 60)).toBe(true);
    expect(await heartbeatJob(pool, { ...job, workerId: "worker-b" }, 60)).toBe(false);
    expect(await heartbeatJob(pool, { ...job, leaseGeneration: job.leaseGeneration - 1 }, 60)).toBe(false);
    await cleanup(pool, fixture.repositoryId);
  });

  it("cancels queued jobs immediately", async () => {
    const fixture = await createFixture(pool, "cancel");
    expect(await requestCancellation(pool, fixture.jobId)).toBe("CANCELLED");
    expect(await claimNextDueJob(pool, "worker-a", 60)).toBeNull();
    const run = await pool.query<{ status: string }>(`SELECT "status"::text FROM "ProcessingRun" WHERE "id"=$1`, [fixture.runId]);
    expect(run.rows[0].status).toBe("CANCELLED");
    await cleanup(pool, fixture.repositoryId);
  });

  it("requeues a failed run in place and clears its previous errors", async () => {
    const fixture = await createFixture(pool, "manual-retry");
    await pool.query(`UPDATE "ProcessingJob" SET "status"='FAILED',"attemptCount"=4,"leaseGeneration"=3,"lastErrorCode"='GITHUB_UNAVAILABLE',"lastErrorMessage"='temporary failure' WHERE "id"=$1`, [fixture.jobId]);
    await pool.query(`UPDATE "ProcessingRun" SET "status"='FAILED',"currentStep"='DETECT_ROUTES',"fetchedCommitCount"=7,"processedCommitCount"=7,"checkpointSequence"=6,"errorCode"='GITHUB_UNAVAILABLE',"errorMessage"='temporary failure',"completedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`, [fixture.runId]);

    expect(await retryFailedRun(pool, fixture.repositoryId, fixture.runId)).toBe("QUEUED");
    const result = await pool.query<{ jobStatus: string; runStatus: string; attemptCount: number; leaseGeneration: number; jobErrorCode: string | null; runErrorCode: string | null; step: string; fetched: number; processed: number; checkpoint: number; jobCount: number }>(
      `SELECT j."status"::text AS "jobStatus",r."status"::text AS "runStatus",j."attemptCount",j."leaseGeneration",j."lastErrorCode" AS "jobErrorCode",r."errorCode" AS "runErrorCode",r."currentStep"::text AS "step",r."fetchedCommitCount" AS "fetched",r."processedCommitCount" AS "processed",r."checkpointSequence" AS "checkpoint",(SELECT COUNT(*)::int FROM "ProcessingJob" WHERE "runId"=r."id") AS "jobCount" FROM "ProcessingJob" j JOIN "ProcessingRun" r ON r."id"=j."runId" WHERE j."id"=$1`,
      [fixture.jobId],
    );
    expect(result.rows[0]).toMatchObject({ jobStatus: "QUEUED", runStatus: "QUEUED", attemptCount: 0, leaseGeneration: 3, jobErrorCode: null, runErrorCode: null, step: "DISCOVER_HISTORY", fetched: 0, processed: 0, checkpoint: -1, jobCount: 1 });
    await cleanup(pool, fixture.repositoryId);
  });

  it("serializes concurrent retries without creating a second job", async () => {
    const fixture = await createFixture(pool, "concurrent-retry");
    await pool.query(`UPDATE "ProcessingJob" SET "status"='FAILED' WHERE "id"=$1`, [fixture.jobId]);
    await pool.query(`UPDATE "ProcessingRun" SET "status"='FAILED' WHERE "id"=$1`, [fixture.runId]);

    const results = await Promise.all([
      retryFailedRun(pool, fixture.repositoryId, fixture.runId),
      retryFailedRun(pool, fixture.repositoryId, fixture.runId),
    ]);
    expect(results.sort()).toEqual(["NOT_RETRYABLE", "QUEUED"]);
    const jobs = await pool.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM "ProcessingJob" WHERE "runId"=$1`, [fixture.runId]);
    expect(jobs.rows[0].count).toBe(1);
    await cleanup(pool, fixture.repositoryId);
  });

  it("recovers an expired lease as retryable", async () => {
    const fixture = await createFixture(pool, "expired");
    const job = await claimNextDueJob(pool, "worker-a", 60);
    expect(job).not.toBeNull();
    await pool.query(`UPDATE "ProcessingJob" SET "leaseExpiresAt"=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE "id"=$1`, [fixture.jobId]);
    expect(await recoverExpiredJobs(pool, retryPolicy)).toBe(1);
    const result = await pool.query<{ jobStatus: string; runStatus: string; leaseOwner: string | null }>(`SELECT j."status"::text AS "jobStatus",r."status"::text AS "runStatus",j."leaseOwner" FROM "ProcessingJob" j JOIN "ProcessingRun" r ON r."id"=j."runId" WHERE j."id"=$1`, [fixture.jobId]);
    expect(result.rows[0]).toMatchObject({ jobStatus: "RETRYABLE", runStatus: "RETRYABLE", leaseOwner: null });
    await cleanup(pool, fixture.repositoryId);
  });

  it("fails an expired job after attempt exhaustion", async () => {
    const fixture = await createFixture(pool, "exhausted", 1);
    await claimNextDueJob(pool, "worker-a", 60);
    await pool.query(`UPDATE "ProcessingJob" SET "leaseExpiresAt"=CURRENT_TIMESTAMP-INTERVAL '1 second' WHERE "id"=$1`, [fixture.jobId]);
    await recoverExpiredJobs(pool, retryPolicy);
    const result = await pool.query<{ status: string; errorCode: string }>(`SELECT "status"::text,"lastErrorCode" AS "errorCode" FROM "ProcessingJob" WHERE "id"=$1`, [fixture.jobId]);
    expect(result.rows[0]).toMatchObject({ status: "FAILED", errorCode: "JOB_ATTEMPTS_EXHAUSTED" });
    await cleanup(pool, fixture.repositoryId);
  });

  it("clears retry errors when a run completes", async () => {
    const fixture = await createFixture(pool, "completion-errors");
    const job = await claimNextDueJob(pool, "worker-a", 60);
    expect(job).not.toBeNull();
    if (!job) return;
    await pool.query(`UPDATE "ProcessingJob" SET "lastErrorCode"='PROCESSING_FAILED',"lastErrorMessage"='previous attempt' WHERE "id"=$1`, [fixture.jobId]);
    await pool.query(`UPDATE "ProcessingRun" SET "errorCode"='PROCESSING_FAILED',"errorMessage"='previous attempt',"currentStep"='ACTIVATE_RUN' WHERE "id"=$1`, [fixture.runId]);
    expect(await completeJob(pool, job)).toBe(true);
    const result = await pool.query<{ jobErrorCode: string | null; jobErrorMessage: string | null; runErrorCode: string | null; runErrorMessage: string | null }>(`SELECT j."lastErrorCode" AS "jobErrorCode",j."lastErrorMessage" AS "jobErrorMessage",r."errorCode" AS "runErrorCode",r."errorMessage" AS "runErrorMessage" FROM "ProcessingJob" j JOIN "ProcessingRun" r ON r."id"=j."runId" WHERE j."id"=$1`, [fixture.jobId]);
    expect(result.rows[0]).toEqual({ jobErrorCode: null, jobErrorMessage: null, runErrorCode: null, runErrorMessage: null });
    await cleanup(pool, fixture.repositoryId);
  });
});

async function createFixture(pool: Pool, suffix: string, maxAttempts = 4): Promise<{ repositoryId: string; runId: string; jobId: string }> {
  const result = await pool.query<{ repositoryId: string; runId: string; jobId: string }>(`WITH repository AS (
    INSERT INTO "Repository"("id","provider","externalId","owner","name","fullName","canonicalUrl","defaultBranch","updatedAt")
    VALUES(gen_random_uuid(),'GITHUB',$1,'test',$1,'test/'||$1,'https://github.com/test/'||$1,'main',CURRENT_TIMESTAMP) RETURNING "id"
  ), run AS (
    INSERT INTO "ProcessingRun"("id","repositoryId","kind","status","defaultBranch","headSha","headFileCount","maxCommitLimit","maxHeadFileLimit","schemaVersion","classifierVersion","dependencyDetectorVersion","routeDetectorVersion","currentStep")
    SELECT gen_random_uuid(),"id",'IMPORT','QUEUED','main','head-'||$1,1,500,25000,'1','1','1','1','DISCOVER_HISTORY' FROM repository RETURNING "id","repositoryId"
  ), job AS (
    INSERT INTO "ProcessingJob"("id","runId","status","maxAttempts","updatedAt") SELECT gen_random_uuid(),"id",'QUEUED',$2,CURRENT_TIMESTAMP FROM run RETURNING "id","runId"
  ) SELECT r."repositoryId",r."id" AS "runId",j."id" AS "jobId" FROM run r JOIN job j ON j."runId"=r."id"`, [`durable-${suffix}-${Date.now()}-${Math.random()}`, maxAttempts]);
  return result.rows[0];
}

async function cleanup(pool: Pool, repositoryId: string): Promise<void> {
  await pool.query(`DELETE FROM "Repository" WHERE "id"=$1`, [repositoryId]);
}

async function cleanupFixtures(pool: Pool): Promise<void> {
  await pool.query(`DELETE FROM "Repository" WHERE "externalId" LIKE 'durable-%'`);
}
