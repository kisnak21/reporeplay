import type { Pool } from "pg";

const NONTERMINAL_RUN_STATUSES = [
  "NEEDS_CONFIGURATION",
  "QUEUED",
  "RUNNING",
  "WAITING_RATE_LIMIT",
  "RETRYABLE",
] as const;

export interface RefreshRunInput {
  repositoryId: string;
  candidates: RefreshAppRootCandidate[];
  defaultBranch: string;
  headSha: string;
  expectedCommitCount: number;
  headFileCount: number;
  maxCommitLimit: number;
  maxHeadFileLimit: number;
}

export interface RefreshAppRootCandidate {
  path: string;
  manifestPath: string;
  routeRoots: string[];
}

export type EnqueueRefreshResult =
  | { outcome: "QUEUED"; runId: string }
  | { outcome: "NEEDS_CONFIGURATION"; runId: string; appRootCandidates: RefreshAppRootCandidate[] }
  | { outcome: "NOT_FOUND" | "NO_ACTIVE_SNAPSHOT" | "RUN_ALREADY_ACTIVE" };

export type ConfigureRefreshResult =
  | { outcome: "QUEUED" }
  | { outcome: "NOT_FOUND" | "RUN_NOT_FOUND" | "RUN_NOT_CONFIGURABLE" | "INVALID_APP_ROOT_SELECTION" };

interface RepositoryRefreshState {
  activeRunId: string | null;
  selectedAppRoot: string | null;
}

export async function enqueueRefreshRun(pool: Pool, input: RefreshRunInput): Promise<EnqueueRefreshResult> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const repositoryResult = await client.query<RepositoryRefreshState>(
      `SELECT "activeRunId","selectedAppRoot"
       FROM "Repository"
       WHERE "id"=$1 AND "deletedAt" IS NULL
       FOR UPDATE`,
      [input.repositoryId],
    );
    const repository = repositoryResult.rows[0];

    if (!repository) {
      await client.query("ROLLBACK");
      return { outcome: "NOT_FOUND" };
    }
    if (!repository.activeRunId) {
      await client.query("ROLLBACK");
      return { outcome: "NO_ACTIVE_SNAPSHOT" };
    }

    const activeRunResult = await client.query<{ id: string }>(
      `SELECT "id"
       FROM "ProcessingRun"
       WHERE "repositoryId"=$1 AND "status" = ANY($2::"ProcessingRunStatus"[])
       LIMIT 1`,
      [input.repositoryId, NONTERMINAL_RUN_STATUSES],
    );
    if (activeRunResult.rows[0]) {
      await client.query("ROLLBACK");
      return { outcome: "RUN_ALREADY_ACTIVE" };
    }

    const selectedAppRoot = repository.selectedAppRoot && input.candidates.some((candidate) => candidate.path === repository.selectedAppRoot)
      ? repository.selectedAppRoot
      : null;
    const status = selectedAppRoot ? "QUEUED" : "NEEDS_CONFIGURATION";

    const runResult = await client.query<{ id: string }>(
      `INSERT INTO "ProcessingRun"(
         "id","repositoryId","kind","status","selectedAppRoot","defaultBranch","headSha",
         "expectedCommitCount","headFileCount","maxCommitLimit","maxHeadFileLimit","schemaVersion",
         "classifierVersion","dependencyDetectorVersion","routeDetectorVersion","currentStep"
       )
       VALUES(gen_random_uuid(),$1,'REFRESH',$2::"ProcessingRunStatus",$3,$4,$5,$6,$7,$8,$9,'1','1','1','1','DISCOVER_HISTORY')
       RETURNING "id"`,
      [
        input.repositoryId,
        status,
        selectedAppRoot,
        input.defaultBranch,
        input.headSha,
        input.expectedCommitCount,
        input.headFileCount,
        input.maxCommitLimit,
        input.maxHeadFileLimit,
      ],
    );
    const runId = runResult.rows[0].id;

    if (selectedAppRoot) {
      await client.query(
        `INSERT INTO "ProcessingJob"("id","runId","status","updatedAt")
         VALUES(gen_random_uuid(),$1,'QUEUED',CURRENT_TIMESTAMP)`,
        [runId],
      );
    } else {
      for (const candidate of input.candidates) {
        await client.query(
          `INSERT INTO "RunAppRootCandidate"("id","runId","path","evidenceManifestPath","routeRoots")
           VALUES(gen_random_uuid(),$1,$2,$3,$4)`,
          [runId, candidate.path, candidate.manifestPath, candidate.routeRoots],
        );
      }
    }

    await client.query("COMMIT");
    return selectedAppRoot
      ? { outcome: "QUEUED", runId }
      : { outcome: "NEEDS_CONFIGURATION", runId, appRootCandidates: input.candidates };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function configureRunAppRoot(
  pool: Pool,
  repositoryId: string,
  runId: string,
  appRoot: string,
): Promise<ConfigureRefreshResult> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const repositoryResult = await client.query<{ activeRunId: string | null }>(
      `SELECT "activeRunId"
       FROM "Repository"
       WHERE "id"=$1 AND "deletedAt" IS NULL
       FOR UPDATE`,
      [repositoryId],
    );
    const repository = repositoryResult.rows[0];
    if (!repository) {
      await client.query("ROLLBACK");
      return { outcome: "NOT_FOUND" };
    }

    const runResult = await client.query<{ status: string }>(
      `SELECT "status"::text AS "status"
       FROM "ProcessingRun"
       WHERE "id"=$1 AND "repositoryId"=$2
       FOR UPDATE`,
      [runId, repositoryId],
    );
    const run = runResult.rows[0];
    if (!run) {
      await client.query("ROLLBACK");
      return { outcome: "RUN_NOT_FOUND" };
    }
    if (run.status !== "NEEDS_CONFIGURATION") {
      await client.query("ROLLBACK");
      return { outcome: "RUN_NOT_CONFIGURABLE" };
    }

    const candidateResult = await client.query<{ path: string }>(
      `SELECT "path" FROM "RunAppRootCandidate" WHERE "runId"=$1 AND "path"=$2`,
      [runId, appRoot],
    );
    if (!candidateResult.rows[0]) {
      await client.query("ROLLBACK");
      return { outcome: "INVALID_APP_ROOT_SELECTION" };
    }

    await client.query(
      `UPDATE "ProcessingRun"
       SET "selectedAppRoot"=$1,"status"='QUEUED',"currentStep"='DISCOVER_HISTORY',
         "errorCode"=NULL,"errorMessage"=NULL,"completedAt"=NULL
       WHERE "id"=$2`,
      [appRoot, runId],
    );
    await client.query(
      `INSERT INTO "ProcessingJob"("id","runId","status","updatedAt")
       VALUES(gen_random_uuid(),$1,'QUEUED',CURRENT_TIMESTAMP)`,
      [runId],
    );
    if (!repository.activeRunId) {
      await client.query(
        `UPDATE "Repository" SET "availability"='PROCESSING',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=$1`,
        [repositoryId],
      );
    }

    await client.query("COMMIT");
    return { outcome: "QUEUED" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
