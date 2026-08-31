import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimNextDueJob, heartbeatJob, recoverExpiredJobs, requestCancellation } from "../../src/server/jobs/repository";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const retryPolicy = { baseSeconds: 1, maxSeconds: 10, jitterPercent: 0 };

describeDatabase("durable PostgreSQL jobs", () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 6 });
  beforeAll(async () => pool.query("SELECT 1"));
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
