import { randomUUID } from "node:crypto";
import type { GitHubCommitDetail, GitHubRepositorySource } from "@/server/github/source";
import { traverseFirstParent, type FirstParentCommit } from "@/server/processing/first-parent";
import type { CheckpointInput, CommitInput } from "@/server/jobs/staged-repository";
import { RepoReplayError } from "@/server/github/errors";
import { loadStagedHistory, writeCheckpointedCommitBatch } from "@/server/jobs/staged-repository";
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
  onCommitFetched?: (fetchedCommitCount: number) => Promise<void>;
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
  const checkpoint = await getStoredCheckpoint(pool, job.runId);
  let rootSha: string;
  let newCommits: FirstParentCommit[];

  if (!checkpoint) {
    const chain = await traverseFirstParent(source, owner, name, headSha, maxCommits, options.onCommitFetched);
    if (chain.commits.length !== expectedCommitCount) {
      throw new RepoReplayError("PROCESSING_FAILED", "The first-parent history changed after preflight.", { expected: expectedCommitCount, actual: chain.commits.length, headSha });
    }
    rootSha = chain.rootSha;
    newCommits = chain.commits;
  } else {
    if (checkpoint.sequence >= expectedCommitCount) throw new RepoReplayError("PROCESSING_FAILED", "The stored ingestion checkpoint exceeds the frozen history count.", { checkpoint: checkpoint.sequence, expected: expectedCommitCount });
    rootSha = checkpoint.rootSha;
    await options.onCommitFetched?.(checkpoint.sequence + 1);
    if (checkpoint.sequence === expectedCommitCount - 1) {
      if (checkpoint.sha !== headSha) throw new RepoReplayError("PROCESSING_FAILED", "The stored ingestion checkpoint does not match the frozen head.", { checkpointSha: checkpoint.sha, headSha });
      newCommits = [];
    } else {
      newCommits = await traverseFromCheckpoint(source, {
        owner,
        name,
        headSha,
        maxCommits,
        expectedCommitCount,
        checkpoint,
        onCommitFetched: options.onCommitFetched,
      });
    }
  }

  const commits = newCommits.map((commit) => toCommitInput(job.runId, commit));
  for (let index = 0; index < commits.length; index += batchSize) {
    const batch = commits.slice(index, index + batchSize);
    const lastSequence = batch.at(-1)?.sequence ?? 0;
    const checkpoint: CheckpointInput = { jobId: job.jobId, runId: job.runId, repositoryId: job.repositoryId, workerId: job.workerId, leaseGeneration: job.leaseGeneration, sequence: lastSequence, step: "FETCH_COMMITS" };
    const written = await writeCheckpointedCommitBatch(pool, checkpoint, batch);
    if (!written) throw new RepoReplayError("PROCESSING_FAILED", "Failed to persist commit batch: lease lost.", { sequence: lastSequence });
  }
  const stagedCommits = await loadStagedHistory(pool, job.runId);
  if (stagedCommits.length !== expectedCommitCount) {
    throw new RepoReplayError("PROCESSING_FAILED", "The persisted first-parent history does not match the frozen commit count.", { expected: expectedCommitCount, actual: stagedCommits.length, headSha });
  }
  return { rootSha, count: stagedCommits.length, commits: stagedCommits };
}

interface StoredCheckpoint {
  sequence: number;
  sha: string;
  rootSha: string;
}

async function getStoredCheckpoint(pool: Pool, runId: string): Promise<StoredCheckpoint | null> {
  const result = await pool.query<{ checkpointSequence: number; checkpointSha: string | null; rootSha: string | null }>(
    `SELECT r."checkpointSequence",checkpoint."sha" AS "checkpointSha",root."sha" AS "rootSha"
     FROM "ProcessingRun" r
     LEFT JOIN "RunCommit" checkpoint ON checkpoint."runId"=r."id" AND checkpoint."sequence"=r."checkpointSequence"
     LEFT JOIN "RunCommit" root ON root."runId"=r."id" AND root."sequence"=0
     WHERE r."id"=$1`,
    [runId],
  );
  const row = result.rows[0];
  if (!row || row.checkpointSequence < 0) return null;
  if (!row.checkpointSha || !row.rootSha) throw new RepoReplayError("PROCESSING_FAILED", "The stored ingestion checkpoint has incomplete commit evidence.", { checkpoint: row.checkpointSequence });
  return { sequence: row.checkpointSequence, sha: row.checkpointSha, rootSha: row.rootSha };
}

async function traverseFromCheckpoint(source: GitHubRepositorySource, input: {
  owner: string;
  name: string;
  headSha: string;
  maxCommits: number;
  expectedCommitCount: number;
  checkpoint: StoredCheckpoint;
  onCommitFetched?: (fetchedCommitCount: number) => Promise<void>;
}): Promise<FirstParentCommit[]> {
  const reverse: GitHubCommitDetail[] = [];
  const seen = new Set<string>();
  let currentSha: string | null = input.headSha;

  while (currentSha !== input.checkpoint.sha) {
    if (currentSha === null) throw new RepoReplayError("PROCESSING_FAILED", "The first-parent history no longer reaches its stored checkpoint.", { checkpointSha: input.checkpoint.sha, headSha: input.headSha });
    if (seen.has(currentSha)) throw new RepoReplayError("PROCESSING_FAILED", "Git history contains a cycle while resuming ingestion.");
    seen.add(currentSha);
    const commit = await source.getCommit(input.owner, input.name, currentSha);
    reverse.push(commit);
    const fetchedCount = input.checkpoint.sequence + 1 + reverse.length;
    await input.onCommitFetched?.(fetchedCount);
    if (fetchedCount > input.maxCommits) throw new RepoReplayError("REPOSITORY_LIMIT_EXCEEDED", "The repository exceeds the configured first-parent history limit.", { limit: "firstParentCommits", actual: fetchedCount, allowed: input.maxCommits });
    currentSha = commit.parentShas[0] ?? null;
  }

  if (input.checkpoint.sequence + 1 + reverse.length !== input.expectedCommitCount) {
    throw new RepoReplayError("PROCESSING_FAILED", "The first-parent history changed after preflight.", { expected: input.expectedCommitCount, actual: input.checkpoint.sequence + 1 + reverse.length, headSha: input.headSha });
  }
  const commits = reverse.reverse().map((commit, index) => ({ ...commit, firstParentSha: commit.parentShas[0] ?? null, sequence: input.checkpoint.sequence + 1 + index }));
  if (commits[0]?.firstParentSha !== input.checkpoint.sha || commits.at(-1)?.sha !== input.headSha) {
    throw new RepoReplayError("PROCESSING_FAILED", "The resumed first-parent history does not match the stored checkpoint and frozen head.", { checkpointSha: input.checkpoint.sha, headSha: input.headSha });
  }
  for (let index = 1; index < commits.length; index += 1) {
    if (commits[index].firstParentSha !== commits[index - 1].sha) throw new RepoReplayError("PROCESSING_FAILED", "Git history contains an invalid first-parent chain while resuming ingestion.");
  }
  return commits;
}
