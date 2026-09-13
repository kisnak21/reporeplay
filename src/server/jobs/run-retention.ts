import { inTransaction, type Database } from "@/server/db/transaction";

const RUN_RETENTION_BATCH_SIZE = 100;

export interface RunRetentionPolicy {
  maxFailedRunsPerRepository: number;
  failedRunRetentionDays: number;
}

export interface RunRetentionResult {
  successfulRunsDeleted: number;
  failedRunsDeleted: number;
}

export async function cleanupRetainedRuns(database: Database, policy: RunRetentionPolicy): Promise<RunRetentionResult> {
  return cleanupRuns(database, policy, null);
}

export async function cleanupRetainedRunsForRepositories(database: Database, repositoryIds: string[], policy: RunRetentionPolicy): Promise<RunRetentionResult> {
  if (repositoryIds.length === 0) return { successfulRunsDeleted: 0, failedRunsDeleted: 0 };
  return cleanupRuns(database, policy, repositoryIds);
}

async function cleanupRuns(database: Database, policy: RunRetentionPolicy, repositoryIds: string[] | null): Promise<RunRetentionResult> {
  return inTransaction(database, async (client) => {
    const repositories = await client.query<{ id: string }>(
      `SELECT repository."id"
       FROM "Repository" repository
       WHERE ($1::uuid[] IS NULL OR repository."id"=ANY($1::uuid[]))
         AND (
           EXISTS (
             SELECT 1 FROM "ProcessingRun" run
             WHERE run."repositoryId"=repository."id"
               AND run."status"='SUCCEEDED'
               AND run."id" IS DISTINCT FROM repository."activeRunId"
               AND run."id" IS DISTINCT FROM repository."previousRunId"
           )
           OR EXISTS (
             SELECT 1 FROM "ProcessingRun" run
             WHERE run."repositoryId"=repository."id"
               AND run."status"='FAILED'
               AND COALESCE(run."completedAt",run."requestedAt")<CURRENT_TIMESTAMP-($3 * INTERVAL '1 day')
           )
           OR (
             SELECT COUNT(*) FROM "ProcessingRun" run
             WHERE run."repositoryId"=repository."id" AND run."status"='FAILED'
           )>$2
         )
       ORDER BY repository."id"
       LIMIT $4
       FOR UPDATE OF repository SKIP LOCKED`,
      [repositoryIds, policy.maxFailedRunsPerRepository, policy.failedRunRetentionDays, RUN_RETENTION_BATCH_SIZE],
    );
    const lockedRepositoryIds = repositories.rows.map((repository) => repository.id);
    if (lockedRepositoryIds.length === 0) return { successfulRunsDeleted: 0, failedRunsDeleted: 0 };

    const successfulRuns = await client.query(
      `WITH candidates AS (
         SELECT run."id"
         FROM "ProcessingRun" run
         JOIN "Repository" repository ON repository."id"=run."repositoryId"
         WHERE run."status"='SUCCEEDED'
           AND run."repositoryId"=ANY($2::uuid[])
           AND run."id" IS DISTINCT FROM repository."activeRunId"
           AND run."id" IS DISTINCT FROM repository."previousRunId"
         ORDER BY run."activatedAt" ASC NULLS FIRST,run."requestedAt" ASC,run."id"
         LIMIT $1
         FOR UPDATE OF run SKIP LOCKED
       )
       DELETE FROM "ProcessingRun" run
       USING candidates
       WHERE run."id"=candidates."id"
         AND run."status"='SUCCEEDED'
         AND NOT EXISTS (
           SELECT 1 FROM "Repository" repository
           WHERE repository."activeRunId"=run."id" OR repository."previousRunId"=run."id"
         )
       RETURNING run."id"`,
      [RUN_RETENTION_BATCH_SIZE, lockedRepositoryIds],
    );

    const failedRuns = await client.query(
      `WITH ranked AS MATERIALIZED (
         SELECT "id",ROW_NUMBER() OVER (
           PARTITION BY "repositoryId"
           ORDER BY "completedAt" DESC NULLS LAST,"requestedAt" DESC,"id" DESC
         ) AS "retentionRank"
         FROM "ProcessingRun"
         WHERE "status"='FAILED' AND "repositoryId"=ANY($4::uuid[])
       ), candidates AS (
         SELECT run."id"
         FROM "ProcessingRun" run
         JOIN ranked ON ranked."id"=run."id"
         WHERE run."status"='FAILED'
           AND (
             ranked."retentionRank">$1
             OR COALESCE(run."completedAt",run."requestedAt")<CURRENT_TIMESTAMP-($2 * INTERVAL '1 day')
           )
         ORDER BY COALESCE(run."completedAt",run."requestedAt") ASC,run."requestedAt" ASC,run."id"
         LIMIT $3
         FOR UPDATE OF run SKIP LOCKED
       )
       DELETE FROM "ProcessingRun" run
       USING candidates
       WHERE run."id"=candidates."id" AND run."status"='FAILED'
       RETURNING run."id"`,
      [policy.maxFailedRunsPerRepository, policy.failedRunRetentionDays, RUN_RETENTION_BATCH_SIZE, repositoryIds],
    );

    return {
      successfulRunsDeleted: successfulRuns.rowCount ?? 0,
      failedRunsDeleted: failedRuns.rowCount ?? 0,
    };
  });
}
