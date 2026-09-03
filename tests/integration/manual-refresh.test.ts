import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { enqueueRefreshRun, type RefreshRunInput } from "../../src/server/jobs/manual-refresh";
import { claimNextDueJob, completeJob } from "../../src/server/jobs/repository";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("manual repository refresh", () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 6 });

  beforeAll(async () => pool.query("SELECT 1"));
  beforeEach(async () => cleanupFixtures(pool));
  afterEach(async () => cleanupFixtures(pool));
  afterAll(async () => pool.end());

  it("queues a refresh without replacing the active snapshot", async () => {
    const fixture = await createActiveRepository(pool, "queue");
    const result = await enqueueRefreshRun(pool, refreshInput(fixture.repositoryId));
    expect(result.outcome).toBe("QUEUED");
    if (result.outcome !== "QUEUED") return;

    const state = await pool.query<{
      activeRunId: string;
      availability: string;
      runKind: string;
      runStatus: string;
      jobStatus: string;
    }>(
      `SELECT repository."activeRunId",repository."availability"::text,
         run."kind"::text AS "runKind",run."status"::text AS "runStatus",job."status"::text AS "jobStatus"
       FROM "Repository" repository
       JOIN "ProcessingRun" run ON run."id"=$2
       JOIN "ProcessingJob" job ON job."runId"=run."id"
       WHERE repository."id"=$1`,
      [fixture.repositoryId, result.runId],
    );
    expect(state.rows[0]).toEqual({
      activeRunId: fixture.activeRunId,
      availability: "READY",
      runKind: "REFRESH",
      runStatus: "QUEUED",
      jobStatus: "QUEUED",
    });
  });

  it("serializes concurrent refresh requests", async () => {
    const fixture = await createActiveRepository(pool, "concurrent");
    const results = await Promise.all([
      enqueueRefreshRun(pool, refreshInput(fixture.repositoryId)),
      enqueueRefreshRun(pool, refreshInput(fixture.repositoryId)),
    ]);
    expect(results.map((result) => result.outcome).sort()).toEqual(["QUEUED", "RUN_ALREADY_ACTIVE"]);

    const runCount = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM "ProcessingRun" WHERE "repositoryId"=$1 AND "kind"='REFRESH'`,
      [fixture.repositoryId],
    );
    expect(runCount.rows[0].count).toBe(1);
  });

  it("requires configuration without changing the active snapshot", async () => {
    const fixture = await createActiveRepository(pool, "configuration");
    const result = await enqueueRefreshRun(pool, {
      ...refreshInput(fixture.repositoryId),
      candidatePaths: ["apps/admin"],
    });
    expect(result).toEqual({ outcome: "CONFIGURATION_REQUIRED" });

    const state = await pool.query<{ activeRunId: string; refreshCount: number }>(
      `SELECT repository."activeRunId",
         (SELECT COUNT(*)::int FROM "ProcessingRun" run WHERE run."repositoryId"=repository."id" AND run."kind"='REFRESH') AS "refreshCount"
       FROM "Repository" repository WHERE repository."id"=$1`,
      [fixture.repositoryId],
    );
    expect(state.rows[0]).toEqual({ activeRunId: fixture.activeRunId, refreshCount: 0 });
  });

  it("updates repository metadata only when the refresh activates", async () => {
    const fixture = await createActiveRepository(pool, "activation");
    const queued = await enqueueRefreshRun(pool, {
      ...refreshInput(fixture.repositoryId),
      defaultBranch: "trunk",
    });
    expect(queued.outcome).toBe("QUEUED");
    if (queued.outcome !== "QUEUED") return;

    const before = await pool.query<{ activeRunId: string; previousRunId: string | null; defaultBranch: string }>(
      `SELECT "activeRunId","previousRunId","defaultBranch" FROM "Repository" WHERE "id"=$1`,
      [fixture.repositoryId],
    );
    expect(before.rows[0]).toEqual({ activeRunId: fixture.activeRunId, previousRunId: null, defaultBranch: "main" });

    const job = await claimNextDueJob(pool, "refresh-worker", 60);
    expect(job?.runId).toBe(queued.runId);
    if (!job) return;
    await pool.query(`UPDATE "ProcessingRun" SET "currentStep"='ACTIVATE_RUN' WHERE "id"=$1`, [queued.runId]);
    expect(await completeJob(pool, job)).toBe(true);

    const after = await pool.query<{ activeRunId: string; previousRunId: string; defaultBranch: string; selectedAppRoot: string }>(
      `SELECT "activeRunId","previousRunId","defaultBranch","selectedAppRoot" FROM "Repository" WHERE "id"=$1`,
      [fixture.repositoryId],
    );
    expect(after.rows[0]).toEqual({
      activeRunId: queued.runId,
      previousRunId: fixture.activeRunId,
      defaultBranch: "trunk",
      selectedAppRoot: "apps/web",
    });
  });
});

function refreshInput(repositoryId: string): RefreshRunInput {
  return {
    repositoryId,
    candidatePaths: ["apps/web"],
    defaultBranch: "main",
    headSha: "new-head",
    expectedCommitCount: 3,
    headFileCount: 12,
    maxCommitLimit: 500,
    maxHeadFileLimit: 25_000,
  };
}

async function createActiveRepository(pool: Pool, suffix: string): Promise<{ repositoryId: string; activeRunId: string }> {
  const externalId = `manual-refresh-${suffix}-${randomUUID()}`;
  const repository = await pool.query<{ id: string }>(
    `INSERT INTO "Repository"(
       "id","provider","externalId","owner","name","fullName","canonicalUrl","defaultBranch","selectedAppRoot","availability","updatedAt"
     ) VALUES(gen_random_uuid(),'GITHUB',$1,'test',$1,'test/'||$1,'https://github.com/test/'||$1,'main','apps/web','READY',CURRENT_TIMESTAMP)
     RETURNING "id"`,
    [externalId],
  );
  const repositoryId = repository.rows[0].id;
  const activeRun = await pool.query<{ id: string }>(
    `INSERT INTO "ProcessingRun"(
       "id","repositoryId","kind","status","selectedAppRoot","defaultBranch","rootSha","headSha",
       "expectedCommitCount","headFileCount","maxCommitLimit","maxHeadFileLimit","schemaVersion",
       "classifierVersion","dependencyDetectorVersion","routeDetectorVersion","currentStep","completedAt","activatedAt"
     ) VALUES(gen_random_uuid(),$1,'IMPORT','SUCCEEDED','apps/web','main','old-root','old-head',2,10,500,25000,'1','1','1','1','COMPLETE',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
     RETURNING "id"`,
    [repositoryId],
  );
  const activeRunId = activeRun.rows[0].id;
  await pool.query(`UPDATE "Repository" SET "activeRunId"=$1 WHERE "id"=$2`, [activeRunId, repositoryId]);
  return { repositoryId, activeRunId };
}

async function cleanupFixtures(pool: Pool): Promise<void> {
  await pool.query(`DELETE FROM "Repository" WHERE "externalId" LIKE 'manual-refresh-%'`);
}
