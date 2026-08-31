import type { Pool, PoolClient } from "pg";
import { RepoReplayError } from "@/server/github/errors";

export interface CheckpointInput {
  jobId: string;
  runId: string;
  repositoryId: string;
  workerId: string;
  leaseGeneration: number;
  step: string;
  sequence: number;
}

export interface CommitInput {
  runId: string;
  id: string;
  sha: string;
  shortSha: string;
  firstParentSha: string | null;
  treeSha: string;
  sequence: number;
  message: string;
  authorName: string | null;
  authoredAt: Date | null;
  committedAt: Date;
  additions: number;
  deletions: number;
  changedFileCount: number;
  externalUrl: string;
  files: Array<{ id: string; path: string; previousPath: string | null; status: "ADDED" | "MODIFIED" | "REMOVED" | "RENAMED"; additions: number; deletions: number; changes: number }>;
}

export async function checkpointRun(client: PoolClient, input: CheckpointInput): Promise<boolean> {
  const result = await client.query(`UPDATE "ProcessingRun" r SET "currentStep"=$1::"ProcessingStep","checkpointSequence"=$2,"processedCommitCount"=$2+1,"checkpointUpdatedAt"=CURRENT_TIMESTAMP WHERE "id"=$3 AND "repositoryId"=$4 AND EXISTS (SELECT 1 FROM "ProcessingJob" j JOIN "Repository" repo ON repo."id"=r."repositoryId" WHERE j."id"=$5 AND j."runId"=r."id" AND j."status"='RUNNING' AND j."leaseOwner"=$6 AND j."leaseGeneration"=$7 AND j."leaseExpiresAt">CURRENT_TIMESTAMP AND repo."deletedAt" IS NULL)`, [input.step, input.sequence, input.runId, input.repositoryId, input.jobId, input.workerId, input.leaseGeneration]);
  return result.rowCount === 1;
}

export async function writeCommitBatch(client: PoolClient, job: CheckpointInput, commits: CommitInput[]): Promise<boolean> {
  const lease = await assertLease(client, job);
  if (!lease) return false;
  for (const commit of commits) {
    const commitResult = await client.query<{ id: string }>(
      `INSERT INTO "RunCommit"("id","runId","sha","shortSha","firstParentSha","treeSha","sequence","message","authorName","authoredAt","committedAt","additions","deletions","changedFileCount","externalUrl")
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT("runId","sha") DO UPDATE SET "shortSha"=EXCLUDED."shortSha","message"=EXCLUDED."message","authorName"=EXCLUDED."authorName","authoredAt"=EXCLUDED."authoredAt","committedAt"=EXCLUDED."committedAt","additions"=EXCLUDED."additions","deletions"=EXCLUDED."deletions","changedFileCount"=EXCLUDED."changedFileCount","externalUrl"=EXCLUDED."externalUrl"
       WHERE "RunCommit"."treeSha"=EXCLUDED."treeSha" AND "RunCommit"."firstParentSha" IS NOT DISTINCT FROM EXCLUDED."firstParentSha" AND "RunCommit"."sequence"=EXCLUDED."sequence"
       RETURNING "id"`,
      [commit.id, commit.runId, commit.sha, commit.shortSha, commit.firstParentSha, commit.treeSha, commit.sequence, commit.message, commit.authorName, commit.authoredAt, commit.committedAt, commit.additions, commit.deletions, commit.changedFileCount, commit.externalUrl],
    );
    if (commitResult.rowCount !== 1) throw new RepoReplayError("PROCESSING_FAILED", "Commit immutable fields conflict with existing staged data.", { sha: commit.sha });
    const persistedCommitId = commitResult.rows[0].id;
    for (const file of commit.files) {
      const fileResult = await client.query(
        `INSERT INTO "CommitFile"("id","runId","runCommitId","path","previousPath","status","additions","deletions","changes")
         VALUES($1,$2,$3,$4,$5,$6::"CommitFileStatus",$7,$8,$9)
         ON CONFLICT("runCommitId","path","status") DO UPDATE SET "previousPath"=EXCLUDED."previousPath","additions"=EXCLUDED."additions","deletions"=EXCLUDED."deletions","changes"=EXCLUDED."changes","runId"=EXCLUDED."runId"
         RETURNING "id"`,
        [file.id, commit.runId, persistedCommitId, file.path, file.previousPath, file.status, file.additions, file.deletions, file.changes],
      );
      if (fileResult.rowCount !== 1) throw new RepoReplayError("PROCESSING_FAILED", "File persistence failed: lease lost or constraint violation.", { path: file.path });
    }
  }
  return true;
}

export async function writeCheckpointedCommitBatch(pool: Pool, job: CheckpointInput, commits: CommitInput[]): Promise<boolean> {
  const client = await pool.connect();
  try { await client.query("BEGIN"); const written = await writeCommitBatch(client, job, commits); if (!written) { await client.query("ROLLBACK"); return false; } const last = commits.at(-1)?.sequence ?? job.sequence; const checkpointed = await checkpointRun(client, { ...job, sequence: last }); if (!checkpointed) { await client.query("ROLLBACK"); return false; } await client.query("COMMIT"); return true; } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

export async function writeCandidates(client: PoolClient, job: CheckpointInput, candidates: Array<{ id: string; path: string; manifestPath: string; routeRoots: string[] }>): Promise<boolean> {
  if (!(await assertLease(client, job))) return false;
  for (const candidate of candidates) await client.query(`INSERT INTO "RunAppRootCandidate"("id","runId","path","evidenceManifestPath","routeRoots") VALUES($1,$2,$3,$4,$5) ON CONFLICT("runId","path") DO UPDATE SET "evidenceManifestPath"=EXCLUDED."evidenceManifestPath","routeRoots"=EXCLUDED."routeRoots"`, [candidate.id, job.runId, candidate.path, candidate.manifestPath, candidate.routeRoots]);
  return true;
}

export async function assertLease(client: PoolClient, job: CheckpointInput): Promise<boolean> {
  const result = await client.query(`SELECT 1 FROM "ProcessingJob" j JOIN "ProcessingRun" r ON r."id"=j."runId" JOIN "Repository" repo ON repo."id"=r."repositoryId" WHERE j."id"=$1 AND j."runId"=$2 AND r."repositoryId"=$3 AND j."status"='RUNNING' AND j."leaseOwner"=$4 AND j."leaseGeneration"=$5 AND j."leaseExpiresAt">CURRENT_TIMESTAMP AND repo."deletedAt" IS NULL`, [job.jobId, job.runId, job.repositoryId, job.workerId, job.leaseGeneration]);
  return result.rowCount === 1;
}
