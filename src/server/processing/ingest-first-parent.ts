import { randomUUID } from "node:crypto";
import type { GitHubCommitDetail } from "@/server/github/source";
import { traverseFirstParent, type FirstParentCommit } from "@/server/processing/first-parent";
import type { GitHubRepositorySource } from "@/server/github/source";
import type { CheckpointInput, CommitInput } from "@/server/jobs/staged-repository";
import { RepoReplayError } from "@/server/github/errors";
import { writeCheckpointedCommitBatch } from "@/server/jobs/staged-repository";
import type { Pool } from "pg";

export interface IngestFirstParentOptions {
  source: GitHubRepositorySource;
  pool: Pool;
  job: { jobId: string; runId: string; repositoryId: string; workerId: string; leaseGeneration: number };
  owner: string;
  name: string;
  headSha: string;
  maxCommits: number;
  expectedCommitCount: number;
  batchSize?: number;
}

function toCommitInput(runId: string, commit: GitHubCommitDetail & { firstParentSha: string | null; sequence: number }): CommitInput {
  return {
    runId,
    id: randomUUID(),
    sha: commit.sha,
    shortSha: commit.sha.slice(0, 7),
    firstParentSha: commit.firstParentSha,
    treeSha: commit.treeSha,
    sequence: commit.sequence,
    message: commit.message,
    authorName: commit.authorName,
    authoredAt: commit.authoredAt,
    committedAt: commit.committedAt,
    additions: commit.additions,
    deletions: commit.deletions,
    changedFileCount: commit.changedFileCount,
    externalUrl: commit.externalUrl,
    files: commit.files.map((file) => ({
      id: randomUUID(),
      path: file.path,
      previousPath: file.previousPath,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      changes: file.changes,
    })),
  };
}

export async function ingestFirstParentHistory(options: IngestFirstParentOptions): Promise<{ rootSha: string; count: number; commits: FirstParentCommit[] }> {
  const { source, pool, job, owner, name, headSha, maxCommits, expectedCommitCount, batchSize = 20 } = options;
  const chain = await traverseFirstParent(source, owner, name, headSha, maxCommits);
  if (chain.commits.length !== expectedCommitCount) {
    throw new RepoReplayError("PROCESSING_FAILED", "The first-parent history changed after preflight.", { expected: expectedCommitCount, actual: chain.commits.length, headSha });
  }
  const commits = chain.commits.map((commit) => toCommitInput(job.runId, commit));
  for (let index = 0; index < commits.length; index += batchSize) {
    const batch = commits.slice(index, index + batchSize);
    const lastSequence = batch.at(-1)?.sequence ?? 0;
    const checkpoint: CheckpointInput = { jobId: job.jobId, runId: job.runId, repositoryId: job.repositoryId, workerId: job.workerId, leaseGeneration: job.leaseGeneration, sequence: lastSequence, step: "FETCH_COMMITS" };
    const written = await writeCheckpointedCommitBatch(pool, checkpoint, batch);
    if (!written) throw new RepoReplayError("PROCESSING_FAILED", "Failed to persist commit batch: lease lost.", { sequence: lastSequence });
  }
  return { rootSha: chain.rootSha, count: chain.commits.length, commits: chain.commits };
}
