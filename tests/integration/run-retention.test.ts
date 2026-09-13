import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { cleanupRetainedRunsForRepositories } from "../../src/server/jobs/run-retention";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("processing run retention", () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 4 });
  beforeAll(async () => pool.query("SELECT 1"));
  beforeEach(async () => cleanupFixtures(pool));
  afterEach(async () => cleanupFixtures(pool));
  afterAll(async () => pool.end());

  it("keeps the active and previous successful runs and deletes older graphs", async () => {
    const repositoryId = await createRepository(pool);
    const activeRunId = await createRun(pool, repositoryId, "SUCCEEDED", "active", 0);
    const previousRunId = await createRun(pool, repositoryId, "SUCCEEDED", "previous", 1);
    const oldRunId = await createRun(pool, repositoryId, "SUCCEEDED", "old", 2);
    const oldestRunId = await createRun(pool, repositoryId, "SUCCEEDED", "oldest", 3);
    await pool.query(`UPDATE "Repository" SET "activeRunId"=$1,"previousRunId"=$2 WHERE "id"=$3`, [activeRunId, previousRunId, repositoryId]);
    await pool.query(
      `INSERT INTO "RunCommit"("id","runId","sha","shortSha","treeSha","sequence","message","committedAt","additions","deletions","changedFileCount","externalUrl")
       VALUES(gen_random_uuid(),$1,'old-sha','old-sha','old-tree',0,'old history',CURRENT_TIMESTAMP,0,0,0,'https://github.com/retention/old')`,
      [oldestRunId],
    );

    const result = await cleanupRetainedRunsForRepositories(pool, [repositoryId], { maxFailedRunsPerRepository: 5, failedRunRetentionDays: 30 });

    expect(result).toEqual({ successfulRunsDeleted: 2, failedRunsDeleted: 0 });
    const retained = await pool.query<{ id: string }>(`SELECT "id" FROM "ProcessingRun" WHERE "id"=ANY($1::uuid[]) ORDER BY "id"`, [[activeRunId, previousRunId, oldRunId, oldestRunId]]);
    expect(retained.rows.map((row) => row.id).sort()).toEqual([activeRunId, previousRunId].sort());
    const deletedGraph = await pool.query<{ count: number }>(`SELECT COUNT(*)::int AS "count" FROM "RunCommit" WHERE "runId"=$1`, [oldestRunId]);
    expect(deletedGraph.rows[0].count).toBe(0);
    await cleanup(pool, repositoryId);
  });

  it("bounds failed runs by per-repository count and diagnostic age", async () => {
    const repositoryId = await createRepository(pool);
    const recentFailures = await Promise.all(Array.from({ length: 6 }, (_, index) => createRun(pool, repositoryId, "FAILED", `recent-${index}`, index)));
    const secondRepositoryId = await createRepository(pool);
    const expiredFailureId = await createRun(pool, secondRepositoryId, "FAILED", "expired", 45);
    const recentFailureId = await createRun(pool, secondRepositoryId, "FAILED", "recent", 1);

    const result = await cleanupRetainedRunsForRepositories(pool, [repositoryId, secondRepositoryId], { maxFailedRunsPerRepository: 3, failedRunRetentionDays: 30 });

    expect(result).toEqual({ successfulRunsDeleted: 0, failedRunsDeleted: 4 });
    const retained = await pool.query<{ id: string }>(`SELECT "id" FROM "ProcessingRun" WHERE "id"=ANY($1::uuid[])`, [[...recentFailures, expiredFailureId, recentFailureId]]);
    expect(retained.rows.map((row) => row.id).sort()).toEqual([
      ...recentFailures.slice(0, 3),
      recentFailureId,
    ].sort());
    await cleanup(pool, repositoryId);
    await cleanup(pool, secondRepositoryId);
  });
});

async function createRepository(pool: Pool): Promise<string> {
  const suffix = randomUUID();
  const result = await pool.query<{ id: string }>(
    `INSERT INTO "Repository"("id","provider","externalId","owner","name","fullName","canonicalUrl","defaultBranch","updatedAt")
     VALUES(gen_random_uuid(),'GITHUB',$1,'retention',$1,'retention/'||$1,'https://github.com/retention/'||$1,'main',CURRENT_TIMESTAMP) RETURNING "id"`,
    [`retention-${suffix}`],
  );
  return result.rows[0].id;
}

async function createRun(pool: Pool, repositoryId: string, status: "SUCCEEDED" | "FAILED", headSha: string, ageDays: number): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO "ProcessingRun"("id","repositoryId","kind","status","defaultBranch","headSha","headFileCount","maxCommitLimit","maxHeadFileLimit","schemaVersion","classifierVersion","dependencyDetectorVersion","routeDetectorVersion","currentStep")
     VALUES(gen_random_uuid(),$1,'IMPORT',$2::"ProcessingRunStatus",'main',$3,1,500,25000,'1','1','1','1',$4::"ProcessingStep") RETURNING "id"`,
    [repositoryId, status, headSha, status === "SUCCEEDED" ? "COMPLETE" : "DISCOVER_HISTORY"],
  );
  const runId = result.rows[0].id;
  await pool.query(`INSERT INTO "ProcessingJob"("id","runId","status","updatedAt") VALUES(gen_random_uuid(),$1,$2::"ProcessingJobStatus",CURRENT_TIMESTAMP)`, [runId, status]);
  await pool.query(
    `UPDATE "ProcessingRun" SET "requestedAt"=CURRENT_TIMESTAMP-($1 * INTERVAL '1 day'),"completedAt"=CURRENT_TIMESTAMP-($1 * INTERVAL '1 day'),"activatedAt"=CASE WHEN "status"='SUCCEEDED' THEN CURRENT_TIMESTAMP-($1 * INTERVAL '1 day') ELSE NULL END WHERE "id"=$2`,
    [ageDays, runId],
  );
  return runId;
}

async function cleanup(pool: Pool, repositoryId: string): Promise<void> {
  await pool.query(`DELETE FROM "Repository" WHERE "id"=$1`, [repositoryId]);
}

async function cleanupFixtures(pool: Pool): Promise<void> {
  await pool.query(`DELETE FROM "Repository" WHERE "externalId" LIKE 'retention-%'`);
}
