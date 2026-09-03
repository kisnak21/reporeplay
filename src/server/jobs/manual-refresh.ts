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
  candidatePaths: string[];
  defaultBranch: string;
  headSha: string;
  expectedCommitCount: number;
  headFileCount: number;
  maxCommitLimit: number;
  maxHeadFileLimit: number;
}

export type EnqueueRefreshResult =
  | { outcome: "QUEUED"; runId: string }
  | { outcome: "NOT_FOUND" | "NO_ACTIVE_SNAPSHOT" | "RUN_ALREADY_ACTIVE" | "CONFIGURATION_REQUIRED" };

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

    if (!repository.selectedAppRoot || !input.candidatePaths.includes(repository.selectedAppRoot)) {
      await client.query("ROLLBACK");
      return { outcome: "CONFIGURATION_REQUIRED" };
    }

    const runResult = await client.query<{ id: string }>(
      `INSERT INTO "ProcessingRun"(
         "id","repositoryId","kind","status","selectedAppRoot","defaultBranch","headSha",
         "expectedCommitCount","headFileCount","maxCommitLimit","maxHeadFileLimit","schemaVersion",
         "classifierVersion","dependencyDetectorVersion","routeDetectorVersion","currentStep"
       )
       VALUES(gen_random_uuid(),$1,'REFRESH','QUEUED',$2,$3,$4,$5,$6,$7,$8,'1','1','1','1','DISCOVER_HISTORY')
       RETURNING "id"`,
      [
        input.repositoryId,
        repository.selectedAppRoot,
        input.defaultBranch,
        input.headSha,
        input.expectedCommitCount,
        input.headFileCount,
        input.maxCommitLimit,
        input.maxHeadFileLimit,
      ],
    );
    const runId = runResult.rows[0].id;
    await client.query(
      `INSERT INTO "ProcessingJob"("id","runId","status","updatedAt")
       VALUES(gen_random_uuid(),$1,'QUEUED',CURRENT_TIMESTAMP)`,
      [runId],
    );
    await client.query("COMMIT");
    return { outcome: "QUEUED", runId };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
