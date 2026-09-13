import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { completeJob, claimNextDueJob, heartbeatJob, type ClaimedJob } from "../../src/server/jobs/repository";
import { DELETE as deleteRepository } from "../../src/app/api/admin/repositories/[repositoryId]/route";
import { writeCheckpointedCommitBatch, type CommitInput } from "../../src/server/jobs/staged-repository";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
const pool = new Pool({ connectionString: databaseUrl, max: 10 });
const adminToken = "integration-admin-token";
const viMockPool = pool;

vi.mock("../../src/server/db/client-pool", () => ({ getPool: () => viMockPool }));

describeDatabase("protected permanent repository deletion", () => {
  beforeAll(async () => {
    await pool.query("SELECT 1");
    vi.stubEnv("GITHUB_APP_ID", "1");
    vi.stubEnv("GITHUB_APP_INSTALLATION_ID", "1");
    vi.stubEnv("GITHUB_APP_PRIVATE_KEY", "test-private-key");
    vi.stubEnv("ADMIN_HEALTH_TOKEN", adminToken);
  });
  beforeEach(async () => cleanupFixtures(pool));
  afterEach(async () => cleanupFixtures(pool));
  afterAll(async () => {
    await cleanupFixtures(pool);
    await pool.end();
    vi.unstubAllEnvs();
  });

  it("requires the configured administrator bearer token", async () => {
    const fixture = await createFixture(pool, "unauthorized");
    const response = await deleteRepository(new Request(`http://localhost/api/admin/repositories/${fixture.repositoryId}`, { method: "DELETE" }), { params: Promise.resolve({ repositoryId: fixture.repositoryId }) });
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "ADMIN_UNAUTHORIZED" } });
    const repository = await pool.query(`SELECT 1 FROM "Repository" WHERE "id"=$1`, [fixture.repositoryId]);
    expect(repository.rowCount).toBe(1);
    await cleanup(pool, fixture.repositoryId);
  });

  it("invalidates the worker lease and cascades the complete repository graph", async () => {
    const fixture = await createFixture(pool, "active-worker");
    const idempotencyKey = `delete-${randomUUID()}`;
    const response = await deleteRepository(deleteRequest(fixture.repositoryId, idempotencyKey), { params: Promise.resolve({ repositoryId: fixture.repositoryId }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { repositoryId: fixture.repositoryId, deleted: true } });

    expect(await heartbeatJob(pool, fixture.claim, 60)).toBe(false);
    expect(await completeJob(pool, fixture.claim)).toBe(false);
    expect(await writeCheckpointedCommitBatch(pool, { ...fixture.claim, step: "FETCH_COMMITS", sequence: 0 }, [createCommit(fixture.runId)])).toBe(false);
    const counts = await pool.query<{ repositories: number; runs: number; jobs: number; commits: number }>(
      `SELECT
         (SELECT COUNT(*)::int FROM "Repository" WHERE "id"=$1) AS "repositories",
         (SELECT COUNT(*)::int FROM "ProcessingRun" WHERE "repositoryId"=$1) AS "runs",
         (SELECT COUNT(*)::int FROM "ProcessingJob" WHERE "runId"=$2) AS "jobs",
         (SELECT COUNT(*)::int FROM "RunCommit" WHERE "runId"=$2) AS "commits"`,
      [fixture.repositoryId, fixture.runId],
    );
    expect(counts.rows[0]).toEqual({ repositories: 0, runs: 0, jobs: 0, commits: 0 });

    const replay = await deleteRepository(deleteRequest(fixture.repositoryId, idempotencyKey), { params: Promise.resolve({ repositoryId: fixture.repositoryId }) });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ data: { repositoryId: fixture.repositoryId, deleted: true } });
  });

  it("does not let an activation race recreate a repository being deleted", async () => {
    const fixture = await createFixture(pool, "activation-race");
    const lockClient = await pool.connect();
    let transactionOpen = false;
    try {
      await lockClient.query("BEGIN");
      transactionOpen = true;
      await lockClient.query(`SELECT "id" FROM "Repository" WHERE "id"=$1 FOR UPDATE`, [fixture.repositoryId]);

      const deletion = deleteRepository(deleteRequest(fixture.repositoryId), { params: Promise.resolve({ repositoryId: fixture.repositoryId }) });
      await pool.query("SELECT pg_sleep(0.05)");
      const completion = completeJob(pool, fixture.claim);
      await lockClient.query("COMMIT");
      transactionOpen = false;
      const [response, completed] = await Promise.all([deletion, completion]);

      expect(response.status).toBe(200);
      expect([true, false]).toContain(completed);
      const repository = await pool.query(`SELECT 1 FROM "Repository" WHERE "id"=$1`, [fixture.repositoryId]);
      expect(repository.rowCount).toBe(0);
      expect(await heartbeatJob(pool, fixture.claim, 60)).toBe(false);
    } finally {
      if (transactionOpen) await lockClient.query("ROLLBACK");
      lockClient.release();
      await cleanup(pool, fixture.repositoryId);
    }
  });

  it("returns not found for a missing repository", async () => {
    const repositoryId = randomUUID();
    const response = await deleteRepository(deleteRequest(repositoryId), { params: Promise.resolve({ repositoryId }) });
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "REPOSITORY_NOT_FOUND" } });
  });
});

function deleteRequest(repositoryId: string, idempotencyKey?: string): Request {
  const headers = new Headers({ authorization: `Bearer ${adminToken}` });
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  return new Request(`http://localhost/api/admin/repositories/${repositoryId}`, { method: "DELETE", headers });
}

async function createFixture(pool: Pool, suffix: string): Promise<{ repositoryId: string; runId: string; claim: ClaimedJob }> {
  const repositoryResult = await pool.query<{ id: string }>(
    `INSERT INTO "Repository"("id","provider","externalId","owner","name","fullName","canonicalUrl","defaultBranch","selectedAppRoot","availability","updatedAt")
     VALUES(gen_random_uuid(),'GITHUB',$1,'deletion',$1,'deletion/'||$1,'https://github.com/deletion/'||$1,'main','.', 'READY',CURRENT_TIMESTAMP) RETURNING "id"`,
    [`permanent-delete-${suffix}-${randomUUID()}`],
  );
  const repositoryId = repositoryResult.rows[0].id;
  const activeRun = await pool.query<{ id: string }>(
    `INSERT INTO "ProcessingRun"("id","repositoryId","kind","status","selectedAppRoot","defaultBranch","rootSha","headSha","expectedCommitCount","headFileCount","maxCommitLimit","maxHeadFileLimit","schemaVersion","classifierVersion","dependencyDetectorVersion","routeDetectorVersion","currentStep","completedAt","activatedAt")
     VALUES(gen_random_uuid(),$1,'IMPORT','SUCCEEDED','.','main','old-root','old-head',1,1,500,25000,'1','1','1','1','COMPLETE',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING "id"`,
    [repositoryId],
  );
  await pool.query(`UPDATE "Repository" SET "activeRunId"=$1 WHERE "id"=$2`, [activeRun.rows[0].id, repositoryId]);
  const run = await pool.query<{ id: string }>(
    `INSERT INTO "ProcessingRun"("id","repositoryId","kind","status","selectedAppRoot","defaultBranch","headSha","expectedCommitCount","headFileCount","maxCommitLimit","maxHeadFileLimit","schemaVersion","classifierVersion","dependencyDetectorVersion","routeDetectorVersion","currentStep")
     VALUES(gen_random_uuid(),$1,'REFRESH','QUEUED','.','main','new-head',1,1,500,25000,'1','1','1','1','ACTIVATE_RUN') RETURNING "id"`,
    [repositoryId],
  );
  const runId = run.rows[0].id;
  await pool.query(`INSERT INTO "ProcessingJob"("id","runId","status","updatedAt") VALUES(gen_random_uuid(),$1,'QUEUED',CURRENT_TIMESTAMP)`, [runId]);
  const claim = await claimNextDueJob(pool, `delete-worker-${suffix}`, 60);
  if (!claim) throw new Error("Unable to claim the deletion fixture job.");
  await pool.query(
    `INSERT INTO "RunCommit"("id","runId","sha","shortSha","treeSha","sequence","message","committedAt","additions","deletions","changedFileCount","externalUrl")
     VALUES(gen_random_uuid(),$1,'staged-sha','staged','staged-tree',0,'staged data',CURRENT_TIMESTAMP,0,0,0,'https://github.com/deletion/staged')`,
    [runId],
  );
  return { repositoryId, runId, claim };
}

function createCommit(runId: string): CommitInput {
  return { runId, id: randomUUID(), sha: "stale-write", shortSha: "stale", firstParentSha: null, treeSha: "stale-tree", sequence: 0, message: "stale worker write", authorName: null, authoredAt: null, committedAt: new Date(), additions: 0, deletions: 0, changedFileCount: 0, externalUrl: "https://github.com/deletion/stale", files: [] };
}

async function cleanup(pool: Pool, repositoryId: string): Promise<void> {
  await pool.query(`DELETE FROM "Repository" WHERE "id"=$1`, [repositoryId]);
}

async function cleanupFixtures(pool: Pool): Promise<void> {
  await pool.query(`DELETE FROM "Repository" WHERE "externalId" LIKE 'permanent-delete-%'`);
}
