import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { configureRunAppRoot, enqueueRefreshRun, type RefreshRunInput } from "../../src/server/jobs/manual-refresh";
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

  it("creates a configurable refresh without changing the active snapshot", async () => {
    const fixture = await createActiveRepository(pool, "configuration");
    const result = await enqueueRefreshRun(pool, ambiguousRefreshInput(fixture.repositoryId));
    expect(result.outcome).toBe("NEEDS_CONFIGURATION");
    if (result.outcome !== "NEEDS_CONFIGURATION") return;
    expect(result.appRootCandidates.map((candidate) => candidate.path)).toEqual(["apps/admin", "apps/storefront"]);

    const state = await pool.query<{
      activeRunId: string;
      repositoryRoot: string;
      availability: string;
      runStatus: string;
      runRoot: string | null;
      candidateCount: number;
      jobCount: number;
    }>(
      `SELECT repository."activeRunId",repository."selectedAppRoot" AS "repositoryRoot",repository."availability"::text,
         run."status"::text AS "runStatus",run."selectedAppRoot" AS "runRoot",
         (SELECT COUNT(*)::int FROM "RunAppRootCandidate" candidate WHERE candidate."runId"=run."id") AS "candidateCount",
         (SELECT COUNT(*)::int FROM "ProcessingJob" job WHERE job."runId"=run."id") AS "jobCount"
       FROM "Repository" repository JOIN "ProcessingRun" run ON run."id"=$2
       WHERE repository."id"=$1`,
      [fixture.repositoryId, result.runId],
    );
    expect(state.rows[0]).toEqual({
      activeRunId: fixture.activeRunId,
      repositoryRoot: "apps/web",
      availability: "READY",
      runStatus: "NEEDS_CONFIGURATION",
      runRoot: null,
      candidateCount: 2,
      jobCount: 0,
    });
  });

  it("rejects a root that was not discovered by the refresh", async () => {
    const fixture = await createActiveRepository(pool, "invalid-selection");
    const refresh = await enqueueRefreshRun(pool, ambiguousRefreshInput(fixture.repositoryId));
    expect(refresh.outcome).toBe("NEEDS_CONFIGURATION");
    if (refresh.outcome !== "NEEDS_CONFIGURATION") return;

    expect(await configureRunAppRoot(pool, fixture.repositoryId, refresh.runId, "apps/unknown")).toEqual({ outcome: "INVALID_APP_ROOT_SELECTION" });
    const state = await pool.query<{ status: string; jobCount: number }>(
      `SELECT run."status"::text,
         (SELECT COUNT(*)::int FROM "ProcessingJob" job WHERE job."runId"=run."id") AS "jobCount"
       FROM "ProcessingRun" run WHERE run."id"=$1`,
      [refresh.runId],
    );
    expect(state.rows[0]).toEqual({ status: "NEEDS_CONFIGURATION", jobCount: 0 });
  });

  it("queues the same run after selecting a discovered root", async () => {
    const fixture = await createActiveRepository(pool, "select-root");
    const refresh = await enqueueRefreshRun(pool, ambiguousRefreshInput(fixture.repositoryId));
    expect(refresh.outcome).toBe("NEEDS_CONFIGURATION");
    if (refresh.outcome !== "NEEDS_CONFIGURATION") return;

    expect(await configureRunAppRoot(pool, fixture.repositoryId, refresh.runId, "apps/admin")).toEqual({ outcome: "QUEUED" });
    const state = await pool.query<{
      activeRunId: string;
      repositoryRoot: string;
      availability: string;
      runStatus: string;
      runRoot: string;
      jobStatus: string;
    }>(
      `SELECT repository."activeRunId",repository."selectedAppRoot" AS "repositoryRoot",repository."availability"::text,
         run."status"::text AS "runStatus",run."selectedAppRoot" AS "runRoot",job."status"::text AS "jobStatus"
       FROM "Repository" repository
       JOIN "ProcessingRun" run ON run."id"=$2
       JOIN "ProcessingJob" job ON job."runId"=run."id"
       WHERE repository."id"=$1`,
      [fixture.repositoryId, refresh.runId],
    );
    expect(state.rows[0]).toEqual({
      activeRunId: fixture.activeRunId,
      repositoryRoot: "apps/web",
      availability: "READY",
      runStatus: "QUEUED",
      runRoot: "apps/admin",
      jobStatus: "QUEUED",
    });
  });

  it("serializes concurrent app-root selections", async () => {
    const fixture = await createActiveRepository(pool, "concurrent-selection");
    const refresh = await enqueueRefreshRun(pool, ambiguousRefreshInput(fixture.repositoryId));
    expect(refresh.outcome).toBe("NEEDS_CONFIGURATION");
    if (refresh.outcome !== "NEEDS_CONFIGURATION") return;

    const results = await Promise.all([
      configureRunAppRoot(pool, fixture.repositoryId, refresh.runId, "apps/admin"),
      configureRunAppRoot(pool, fixture.repositoryId, refresh.runId, "apps/storefront"),
    ]);
    expect(results.map((result) => result.outcome).sort()).toEqual(["QUEUED", "RUN_NOT_CONFIGURABLE"]);
    const jobs = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM "ProcessingJob" WHERE "runId"=$1`,
      [refresh.runId],
    );
    expect(jobs.rows[0].count).toBe(1);
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
    candidates: [{ path: "apps/web", manifestPath: "apps/web/package.json", routeRoots: ["src/app"] }],
    defaultBranch: "main",
    headSha: "new-head",
    expectedCommitCount: 3,
    headFileCount: 12,
    maxCommitLimit: 500,
    maxHeadFileLimit: 25_000,
  };
}

function ambiguousRefreshInput(repositoryId: string): RefreshRunInput {
  return {
    ...refreshInput(repositoryId),
    candidates: [
      { path: "apps/admin", manifestPath: "apps/admin/package.json", routeRoots: ["pages"] },
      { path: "apps/storefront", manifestPath: "apps/storefront/package.json", routeRoots: ["src/app"] },
    ],
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
