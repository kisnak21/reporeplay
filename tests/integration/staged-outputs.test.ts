import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { GitHubRepositorySource } from "../../src/server/github/source";
import { claimNextDueJob } from "../../src/server/jobs/repository";
import { advanceRunStep, loadStagedHistory, persistDetectorOutput, updateFetchProgress, writeCheckpointedCommitBatch, type CommitInput } from "../../src/server/jobs/staged-repository";
import { persistCategoriesForRun } from "../../src/server/processing/classifier";
import { ingestFirstParentHistory } from "../../src/server/processing/ingest-first-parent";
import { validateRun } from "../../src/server/processing/validate-run";

const databaseUrl = process.env.DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;

describeDatabase("staged output persistence", () => {
  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  beforeAll(async () => pool.query("SELECT 1"));
  beforeEach(async () => cleanupFixtures(pool));
  afterEach(async () => cleanupFixtures(pool));
  afterAll(async () => pool.end());

  it("replays a commit batch without duplicates and advances its checkpoint", async () => {
    const fixture = await createFixture(pool, "replay");
    const claim = await claimNextDueJob(pool, "writer-a", 60);
    expect(claim).not.toBeNull();
    if (!claim) return;
    const checkpoint = { ...claim, step: "FETCH_COMMITS", sequence: 0 };
    const commit = createCommit(claim.runId, 0);
    expect(await writeCheckpointedCommitBatch(pool, checkpoint, [commit])).toBe(true);
    expect(await writeCheckpointedCommitBatch(pool, checkpoint, [commit])).toBe(true);
    const result = await pool.query<{ count: number; checkpoint: number }>(`SELECT (SELECT COUNT(*)::int FROM "RunCommit" WHERE "runId"=$1) AS count,(SELECT "checkpointSequence" FROM "ProcessingRun" WHERE "id"=$1) AS checkpoint`, [claim.runId]);
    expect(result.rows[0]).toEqual({ count: 1, checkpoint: 0 });
    await cleanup(pool, fixture.repositoryId);
  });

  it("reconstructs ordered detector history and file evidence from staged commits", async () => {
    const fixture = await createFixture(pool, "staged-history");
    const claim = await claimNextDueJob(pool, "history-reader", 60);
    expect(claim).not.toBeNull();
    if (!claim) return;
    const commit = createCommit(claim.runId, 0);
    commit.changedFileCount = 1;
    commit.files.push({ id: randomUUID(), path: "package.json", previousPath: null, status: "ADDED", additions: 1, deletions: 0, changes: 1 });
    await writeCheckpointedCommitBatch(pool, { ...claim, step: "FETCH_COMMITS", sequence: 0 }, [commit]);

    const history = await loadStagedHistory(pool, claim.runId);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      sha: "sha-0",
      firstParentSha: null,
      parentShas: [],
      treeSha: "tree-0",
      sequence: 0,
      changedFileCount: 1,
      files: [{ path: "package.json", previousPath: null, status: "ADDED", additions: 1, deletions: 0, changes: 1 }],
    });
    await cleanup(pool, fixture.repositoryId);
  });

  it("continues ingestion after the last persisted commit batch", async () => {
    const fixture = await createFixture(pool, "ingestion-resume");
    const claim = await claimNextDueJob(pool, "ingestion-resumer", 60);
    expect(claim).not.toBeNull();
    if (!claim) return;
    await pool.query(`UPDATE "ProcessingRun" SET "headSha"='sha-2',"expectedCommitCount"=3 WHERE "id"=$1`, [claim.runId]);
    const root = createCommit(claim.runId, 0);
    root.sha = "sha-0";
    root.shortSha = "sha-0";
    root.treeSha = "tree-sha-0";
    const checkpoint = createCommit(claim.runId, 1);
    checkpoint.sha = "sha-1";
    checkpoint.shortSha = "sha-1";
    checkpoint.treeSha = "tree-sha-1";
    checkpoint.firstParentSha = "sha-0";
    await writeCheckpointedCommitBatch(pool, { ...claim, step: "FETCH_COMMITS", sequence: 0 }, [root, checkpoint]);

    const requestedShas: string[] = [];
    const source: GitHubRepositorySource = {
      getRepository: async () => { throw new Error("unused in ingestion resume"); },
      getBranchHead: async () => { throw new Error("unused in ingestion resume"); },
      getCommit: async (_owner, _name, sha) => {
        requestedShas.push(sha);
        if (sha !== "sha-2") throw new Error(`Unexpected history fetch for ${sha}`);
        return { sha: "sha-2", treeSha: "tree-sha-2", parentShas: ["sha-1"], message: "feat: resumed commit", authorName: null, authoredAt: null, committedAt: new Date(), externalUrl: "https://github.com/test", additions: 0, deletions: 0, changedFileCount: 0, files: [] };
      },
      getTree: async () => ({ treeSha: "unused", paths: [], complete: true }),
      getFile: async () => null,
      getRateLimit: async () => ({ remaining: 1, resetAt: new Date() }),
    };
    const progress: number[] = [];

    const result = await ingestFirstParentHistory({
      source,
      pool,
      job: claim,
      owner: "test",
      name: "repo",
      headSha: "sha-2",
      maxCommits: 500,
      expectedCommitCount: 3,
      batchSize: 1,
      onCommitFetched: async (count) => { progress.push(count); },
    });

    expect(requestedShas).toEqual(["sha-2"]);
    expect(progress).toEqual([2, 3]);
    expect(result).toMatchObject({ rootSha: "sha-0", count: 3, commits: [{ sha: "sha-0", sequence: 0 }, { sha: "sha-1", sequence: 1 }, { sha: "sha-2", sequence: 2 }] });
    const checkpointResult = await pool.query<{ sequence: number }>(`SELECT "checkpointSequence" AS "sequence" FROM "ProcessingRun" WHERE "id"=$1`, [claim.runId]);
    expect(checkpointResult.rows[0].sequence).toBe(2);
    await cleanup(pool, fixture.repositoryId);
  });

  it("rejects force-push drift without changing the checkpoint or active snapshot", async () => {
    const fixture = await createFixture(pool, "force-push-drift");
    const claim = await claimNextDueJob(pool, "force-push-resumer", 60);
    expect(claim).not.toBeNull();
    if (!claim) return;

    await pool.query(`UPDATE "ProcessingRun" SET "headSha"='sha-2',"expectedCommitCount"=3 WHERE "id"=$1`, [claim.runId]);
    const root = createCommit(claim.runId, 0);
    root.sha = "sha-0";
    root.shortSha = "sha-0";
    root.treeSha = "tree-sha-0";
    const checkpoint = createCommit(claim.runId, 1);
    checkpoint.sha = "sha-1";
    checkpoint.shortSha = "sha-1";
    checkpoint.treeSha = "tree-sha-1";
    checkpoint.firstParentSha = "sha-0";
    await writeCheckpointedCommitBatch(pool, { ...claim, step: "FETCH_COMMITS", sequence: 0 }, [root, checkpoint]);

    const activeRunId = await createSuccessfulSnapshot(pool, fixture.repositoryId, "active-before-force-push");
    await pool.query(`UPDATE "Repository" SET "activeRunId"=$1,"availability"='READY' WHERE "id"=$2`, [activeRunId, fixture.repositoryId]);

    const source: GitHubRepositorySource = {
      getRepository: async () => { throw new Error("unused in force-push drift test"); },
      getBranchHead: async () => { throw new Error("ingestion must use the frozen head SHA"); },
      getCommit: async (_owner, _name, sha) => {
        if (sha === "sha-2") return { sha, treeSha: "tree-sha-2", parentShas: ["rewritten-root"], message: "feat: new forced history", authorName: null, authoredAt: null, committedAt: new Date(), externalUrl: "https://github.com/test", additions: 0, deletions: 0, changedFileCount: 0, files: [] };
        if (sha === "rewritten-root") return { sha, treeSha: "rewritten-tree", parentShas: [], message: "feat: rewritten root", authorName: null, authoredAt: null, committedAt: new Date(), externalUrl: "https://github.com/test", additions: 0, deletions: 0, changedFileCount: 0, files: [] };
        throw new Error(`Unexpected history fetch for ${sha}`);
      },
      getTree: async () => ({ treeSha: "unused", paths: [], complete: true }),
      getFile: async () => null,
      getRateLimit: async () => ({ remaining: 1, resetAt: new Date() }),
    };

    await expect(ingestFirstParentHistory({
      source,
      pool,
      job: claim,
      owner: "test",
      name: "repo",
      headSha: "sha-2",
      maxCommits: 500,
      expectedCommitCount: 3,
    })).rejects.toThrow("The first-parent history no longer reaches its stored checkpoint.");

    const state = await pool.query<{ checkpointSequence: number; commitCount: number; activeRunId: string }>(
      `SELECT run."checkpointSequence",
         (SELECT COUNT(*)::int FROM "RunCommit" staged WHERE staged."runId"=run."id") AS "commitCount",
         repository."activeRunId"
       FROM "ProcessingRun" run JOIN "Repository" repository ON repository."id"=run."repositoryId"
       WHERE run."id"=$1`,
      [claim.runId],
    );
    expect(state.rows[0]).toEqual({ checkpointSequence: 1, commitCount: 2, activeRunId });
    await cleanup(pool, fixture.repositoryId);
  });

  it("rejects stale lease generations before writing", async () => {
    const fixture = await createFixture(pool, "stale");
    const claim = await claimNextDueJob(pool, "writer-a", 60);
    expect(claim).not.toBeNull();
    if (!claim) return;
    const stale = { ...claim, leaseGeneration: claim.leaseGeneration - 1, step: "FETCH_COMMITS", sequence: 0 };
    expect(await writeCheckpointedCommitBatch(pool, stale, [createCommit(claim.runId, 0)])).toBe(false);
    const count = await pool.query<{ count: number }>(`SELECT COUNT(*)::int AS count FROM "RunCommit" WHERE "runId"=$1`, [claim.runId]);
    expect(count.rows[0].count).toBe(0);
    await cleanup(pool, fixture.repositoryId);
  });

  it("persists fetched commit progress behind the active lease", async () => {
    const fixture = await createFixture(pool, "fetch-progress");
    const claim = await claimNextDueJob(pool, "writer-a", 60);
    expect(claim).not.toBeNull();
    if (!claim) return;
    const client = await pool.connect();
    try {
      expect(await advanceRunStep(client, claim, "FETCH_COMMITS")).toBe(true);
    } finally {
      client.release();
    }
    expect(await updateFetchProgress(pool, claim, 3)).toBe(true);
    expect(await updateFetchProgress(pool, { ...claim, leaseGeneration: claim.leaseGeneration - 1 }, 4)).toBe(false);
    const result = await pool.query<{ fetched: number; step: string }>(`SELECT "fetchedCommitCount" fetched,"currentStep" step FROM "ProcessingRun" WHERE "id"=$1`, [claim.runId]);
    expect(result.rows[0]).toEqual({ fetched: 3, step: "FETCH_COMMITS" });
    await cleanup(pool, fixture.repositoryId);
  });

  it("rejects children that reference a commit in another run", async () => {
    const first = await createFixture(pool, "cross-a");
    const second = await createTerminalFixture(pool, first.repositoryId, "cross-b");
    const commitId = randomUUID();
    await pool.query(`INSERT INTO "RunCommit"("id","runId","sha","shortSha","treeSha","sequence","message","committedAt","additions","deletions","changedFileCount","externalUrl") VALUES($1,$2,'sha-a','sha-a','tree-a',0,'test',CURRENT_TIMESTAMP,0,0,0,'https://github.com/test')`, [commitId, first.runId]);
    await expect(pool.query(`INSERT INTO "CommitFile"("id","runId","runCommitId","path","status","additions","deletions","changes") VALUES(gen_random_uuid(),$1,$2,'file.ts','ADDED',1,0,1)`, [second, commitId])).rejects.toMatchObject({ code: "23503" });
    await cleanup(pool, first.repositoryId);
  });

  it("persists detector output idempotently and advances detector checkpoints", async () => {
    const fixture = await createFixture(pool, "detectors");
    const claim = await claimNextDueJob(pool, "writer-a", 60);
    expect(claim).not.toBeNull();
    if (!claim) return;
    await writeCheckpointedCommitBatch(pool, { ...claim, step: "FETCH_COMMITS", sequence: 0 }, [createCommit(claim.runId, 0)]);

    const dependencyOutput = {
      dependencies: [{ commitSha: "sha-0", manifestPath: "package.json", packageName: "react", dependencyGroup: "DEPENDENCY" as const, changeType: "ADDED" as const, previousValue: null, currentValue: "18.0.0" }],
      warnings: [{ commitSha: "sha-0", detector: "DEPENDENCY" as const, code: "MALFORMED_MANIFEST", path: "package.json", message: "test warning", detectorVersion: "1" }],
    };
    expect(await persistDetectorOutput(pool, { ...claim, step: "DETECT_DEPENDENCIES", output: dependencyOutput })).toBe(true);
    expect(await persistDetectorOutput(pool, { ...claim, step: "DETECT_DEPENDENCIES", output: dependencyOutput })).toBe(true);
    expect(await persistDetectorOutput(pool, { ...claim, step: "DETECT_ROUTES", output: { routes: [{ commitSha: "sha-0", router: "APP", route: "/", sourcePath: "app/page.tsx", routeType: "PAGE", changeType: "ADDED" }], warnings: [] } })).toBe(true);

    const result = await pool.query<{ dependencies: number; routes: number; warnings: number; step: string }>(`SELECT (SELECT COUNT(*)::int FROM "DependencyChange" WHERE "runId"=$1) dependencies,(SELECT COUNT(*)::int FROM "RouteChange" WHERE "runId"=$1) routes,(SELECT COUNT(*)::int FROM "ProcessingWarning" WHERE "runId"=$1) warnings,(SELECT "currentStep" FROM "ProcessingRun" WHERE "id"=$1) step`, [claim.runId]);
    expect(result.rows[0]).toEqual({ dependencies: 1, routes: 1, warnings: 1, step: "DETECT_ROUTES" });
    await cleanup(pool, fixture.repositoryId);
  });

  it("validates the complete staged graph before activation", async () => {
    const fixture = await createFixture(pool, "validation");
    const claim = await claimNextDueJob(pool, "writer-a", 60);
    expect(claim).not.toBeNull();
    if (!claim) return;
    await pool.query(`UPDATE "ProcessingRun" SET "selectedAppRoot"='.',"rootSha"='sha-0',"headSha"='sha-0',"expectedCommitCount"=1 WHERE "id"=$1`, [claim.runId]);
    await writeCheckpointedCommitBatch(pool, { ...claim, step: "FETCH_COMMITS", sequence: 0 }, [createCommit(claim.runId, 0)]);
    await persistCategoriesForRun(pool, { ...claim, step: "CLASSIFY_COMMITS", sequence: 0 });
    await persistDetectorOutput(pool, { ...claim, step: "DETECT_DEPENDENCIES", output: { warnings: [] } });
    await persistDetectorOutput(pool, { ...claim, step: "DETECT_ROUTES", output: { warnings: [] } });

    expect(await validateRun(pool, claim)).toBe(true);
    const result = await pool.query<{ step: string; categoryCount: number }>(`SELECT (SELECT "currentStep" FROM "ProcessingRun" WHERE "id"=$1) step,(SELECT COUNT(*)::int FROM "CommitCategory" WHERE "runId"=$1) "categoryCount"`, [claim.runId]);
    expect(result.rows[0]).toEqual({ step: "ACTIVATE_RUN", categoryCount: 1 });
    await cleanup(pool, fixture.repositoryId);
  });

  it("keeps the active snapshot pointers unchanged when run validation fails", async () => {
    const fixture = await createFixture(pool, "validation-failure");
    const activeRunId = await createSuccessfulSnapshot(pool, fixture.repositoryId, "active-before-failed-validation");
    const previousRunId = await createSuccessfulSnapshot(pool, fixture.repositoryId, "previous-before-failed-validation");
    await pool.query(`UPDATE "Repository" SET "activeRunId"=$1,"previousRunId"=$2,"availability"='READY' WHERE "id"=$3`, [activeRunId, previousRunId, fixture.repositoryId]);
    const claim = await claimNextDueJob(pool, "validation-worker", 60);
    expect(claim).not.toBeNull();
    if (!claim) return;
    await pool.query(`UPDATE "ProcessingRun" SET "selectedAppRoot"='.',"rootSha"='root-sha',"headSha"='head-sha',"expectedCommitCount"=1,"currentStep"='DETECT_ROUTES' WHERE "id"=$1`, [claim.runId]);

    await expect(validateRun(pool, claim)).rejects.toMatchObject({ code: "PROCESSING_FAILED" });

    const result = await pool.query<{ activeRunId: string; previousRunId: string; runStatus: string; step: string }>(
      `SELECT repo."activeRunId",repo."previousRunId",r."status"::text AS "runStatus",r."currentStep"::text AS "step" FROM "Repository" repo JOIN "ProcessingRun" r ON r."repositoryId"=repo."id" WHERE repo."id"=$1 AND r."id"=$2`,
      [fixture.repositoryId, claim.runId],
    );
    expect(result.rows[0]).toEqual({ activeRunId, previousRunId, runStatus: "RUNNING", step: "DETECT_ROUTES" });
    await cleanup(pool, fixture.repositoryId);
  });

  it("cascades the staged graph when a run is deleted", async () => {
    const fixture = await createFixture(pool, "cascade");
    const commitId = randomUUID();
    await pool.query(`INSERT INTO "RunAppRootCandidate"("id","runId","path","evidenceManifestPath") VALUES(gen_random_uuid(),$1,'.','package.json')`, [fixture.runId]);
    await pool.query(`INSERT INTO "RunCommit"("id","runId","sha","shortSha","treeSha","sequence","message","committedAt","additions","deletions","changedFileCount","externalUrl") VALUES($2,$1,'sha-c','sha-c','tree-c',0,'test',CURRENT_TIMESTAMP,0,0,0,'https://github.com/test')`, [fixture.runId, commitId]);
    await pool.query(`INSERT INTO "CommitCategory"("id","runId","runCommitId","category","source") VALUES(gen_random_uuid(),$1,$2,'UNCATEGORIZED','NONE')`, [fixture.runId, commitId]);
    await pool.query(`INSERT INTO "ProcessingWarning"("id","runId","runCommitId","code","message") VALUES(gen_random_uuid(),$1,$2,'TEST_WARNING','warning')`, [fixture.runId, commitId]);
    await pool.query(`DELETE FROM "ProcessingRun" WHERE "id"=$1`, [fixture.runId]);
    const result = await pool.query<{ candidates: number; commits: number; warnings: number }>(`SELECT (SELECT COUNT(*)::int FROM "RunAppRootCandidate" WHERE "runId"=$1) candidates,(SELECT COUNT(*)::int FROM "RunCommit" WHERE "runId"=$1) commits,(SELECT COUNT(*)::int FROM "ProcessingWarning" WHERE "runId"=$1) warnings`, [fixture.runId]);
    expect(result.rows[0]).toEqual({ candidates: 0, commits: 0, warnings: 0 });
    await cleanup(pool, fixture.repositoryId);
  });
});

function createCommit(runId: string, sequence: number): CommitInput { return { runId, id: randomUUID(), sha: `sha-${sequence}`, shortSha: `sha-${sequence}`, firstParentSha: null, treeSha: `tree-${sequence}`, sequence, message: "test", authorName: null, authoredAt: null, committedAt: new Date(), additions: 0, deletions: 0, changedFileCount: 0, externalUrl: "https://github.com/test", files: [] }; }
async function createFixture(pool: Pool, suffix: string) { const id = `${suffix}-${randomUUID()}`; const result = await pool.query<{ repositoryId: string; runId: string }>(`WITH repo AS (INSERT INTO "Repository"("id","provider","externalId","owner","name","fullName","canonicalUrl","defaultBranch","updatedAt") VALUES(gen_random_uuid(),'GITHUB',$1,'test',$1,'test/'||$1,'https://github.com/test/'||$1,'main',CURRENT_TIMESTAMP) RETURNING "id"),run AS (INSERT INTO "ProcessingRun"("id","repositoryId","kind","status","defaultBranch","headSha","headFileCount","maxCommitLimit","maxHeadFileLimit","schemaVersion","classifierVersion","dependencyDetectorVersion","routeDetectorVersion","currentStep") SELECT gen_random_uuid(),"id",'IMPORT','QUEUED','main','head',1,500,25000,'1','1','1','1','DISCOVER_HISTORY' FROM repo RETURNING "id","repositoryId") INSERT INTO "ProcessingJob"("id","runId","status","updatedAt") SELECT gen_random_uuid(),"id",'QUEUED',CURRENT_TIMESTAMP FROM run RETURNING (SELECT "repositoryId" FROM run) "repositoryId","runId"`, [id]); return result.rows[0]; }
async function createTerminalFixture(pool: Pool, repositoryId: string, suffix: string) { const result = await pool.query<{ id: string }>(`INSERT INTO "ProcessingRun"("id","repositoryId","kind","status","defaultBranch","headSha","headFileCount","maxCommitLimit","maxHeadFileLimit","schemaVersion","classifierVersion","dependencyDetectorVersion","routeDetectorVersion","currentStep") VALUES(gen_random_uuid(),$1,'IMPORT','FAILED','main',$2,1,500,25000,'1','1','1','1','DISCOVER_HISTORY') RETURNING "id"`, [repositoryId, suffix]); return result.rows[0].id; }
async function createSuccessfulSnapshot(pool: Pool, repositoryId: string, headSha: string) { const result = await pool.query<{ id: string }>(`INSERT INTO "ProcessingRun"("id","repositoryId","kind","status","defaultBranch","headSha","headFileCount","maxCommitLimit","maxHeadFileLimit","schemaVersion","classifierVersion","dependencyDetectorVersion","routeDetectorVersion","currentStep") VALUES(gen_random_uuid(),$1,'IMPORT','SUCCEEDED','main',$2,1,500,25000,'1','1','1','1','COMPLETE') RETURNING "id"`, [repositoryId, headSha]); return result.rows[0].id; }
async function cleanup(pool: Pool, repositoryId: string) { await pool.query(`DELETE FROM "Repository" WHERE "id"=$1`, [repositoryId]); }
async function cleanupFixtures(pool: Pool) { await pool.query(`DELETE FROM "Repository" WHERE "externalId" LIKE 'replay-%' OR "externalId" LIKE 'stale-%' OR "externalId" LIKE 'cross-%' OR "externalId" LIKE 'cascade-%' OR "externalId" LIKE 'detectors-%' OR "externalId" LIKE 'validation-%' OR "externalId" LIKE 'staged-history-%' OR "externalId" LIKE 'ingestion-resume-%' OR "externalId" LIKE 'validation-failure-%'`); }
