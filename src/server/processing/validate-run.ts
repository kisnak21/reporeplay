import type { Pool } from "pg";
import { RepoReplayError } from "@/server/github/errors";
import { advanceRunStep, assertLease, type JobLease } from "@/server/jobs/staged-repository";

interface RunCommitValidationRow {
  sequence: number;
  sha: string;
  firstParentSha: string | null;
  changedFileCount: number;
  persistedFileCount: number;
  categoryCount: number;
}

function failValidation(message: string, details: Record<string, unknown> = {}): never {
  throw new RepoReplayError("PROCESSING_FAILED", message, details);
}

function validateCommitSequence(rows: RunCommitValidationRow[], expectedCount: number, rootSha: string | null, headSha: string): void {
  if (rows.length !== expectedCount) failValidation("Persisted commit count does not match preflight.", { expected: expectedCount, actual: rows.length });
  if (!rows.length || rows[0].sequence !== 0 || rows.at(-1)?.sequence !== expectedCount - 1) failValidation("Persisted commit sequence is not contiguous.");
  if (!rootSha || rows[0].sha !== rootSha || rows.at(-1)?.sha !== headSha) failValidation("Persisted history does not match the frozen root and head.", { rootSha, headSha });

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.persistedFileCount !== row.changedFileCount) failValidation("Changed-file evidence is incomplete.", { sha: row.sha, expected: row.changedFileCount, actual: row.persistedFileCount });
    if (row.categoryCount !== 1) failValidation("Every persisted commit must have exactly one category.", { sha: row.sha });
    if (index > 0 && row.firstParentSha !== rows[index - 1].sha) failValidation("Persisted history contains an invalid first-parent relationship.", { sha: row.sha });
    if (index === 0 && row.firstParentSha !== null) failValidation("The root commit cannot have a first parent.", { sha: row.sha });
  }
}

export async function validateRun(pool: Pool, job: JobLease): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (!(await assertLease(client, job))) { await client.query("ROLLBACK"); return false; }

    const runResult = await client.query<{ status: string; currentStep: string; expectedCommitCount: number | null; rootSha: string | null; headSha: string }>(
      `SELECT "status","currentStep","expectedCommitCount","rootSha","headSha" FROM "ProcessingRun" WHERE "id"=$1 AND "repositoryId"=$2`,
      [job.runId, job.repositoryId],
    );
    const run = runResult.rows[0];
    if (!run) failValidation("Run context not found during validation.");
    if (run.status !== "RUNNING" || run.currentStep !== "DETECT_ROUTES") failValidation("Run reached validation from an unexpected state.", { status: run.status, step: run.currentStep });
    if (run.expectedCommitCount === null) failValidation("Run is missing its frozen expected commit count.");

    const commitResult = await client.query<RunCommitValidationRow>(
      `SELECT c."sequence",c."sha",c."firstParentSha",c."changedFileCount",COUNT(DISTINCT f."id")::int AS "persistedFileCount",COUNT(DISTINCT cat."runCommitId")::int AS "categoryCount"
       FROM "RunCommit" c
       LEFT JOIN "CommitFile" f ON f."runId"=c."runId" AND f."runCommitId"=c."id"
       LEFT JOIN "CommitCategory" cat ON cat."runId"=c."runId" AND cat."runCommitId"=c."id"
       WHERE c."runId"=$1
       GROUP BY c."id"
       ORDER BY c."sequence"`,
      [job.runId],
    );
    validateCommitSequence(commitResult.rows, run.expectedCommitCount, run.rootSha, run.headSha);

    if (!(await advanceRunStep(client, job, "ACTIVATE_RUN"))) { await client.query("ROLLBACK"); return false; }
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
