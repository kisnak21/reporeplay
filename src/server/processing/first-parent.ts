import { RepoReplayError } from "@/server/github/errors";
import type { GitHubCommitDetail, GitHubRepositorySource } from "@/server/github/source";

export interface FirstParentCommit extends GitHubCommitDetail { firstParentSha: string | null; sequence: number }
export interface FirstParentChain { rootSha: string; headSha: string; commits: FirstParentCommit[] }
export type FirstParentProgress = (fetchedCommitCount: number) => Promise<void>;

export async function traverseFirstParent(source: GitHubRepositorySource, owner: string, name: string, headSha: string, maxCommits: number, onCommitFetched?: FirstParentProgress): Promise<FirstParentChain> {
  const seen = new Set<string>(); const reverse: GitHubCommitDetail[] = []; let currentSha: string | null = headSha;
  while (currentSha) {
    if (seen.has(currentSha)) throw new RepoReplayError("PROCESSING_FAILED", "Git history contains a cycle.");
    seen.add(currentSha);
    const commit = await source.getCommit(owner, name, currentSha);
    reverse.push(commit);
    await onCommitFetched?.(reverse.length);
    if (reverse.length > maxCommits) throw new RepoReplayError("REPOSITORY_LIMIT_EXCEEDED", "The repository exceeds the configured first-parent history limit.", { limit: "firstParentCommits", actual: reverse.length, allowed: maxCommits });
    currentSha = commit.parentShas[0] ?? null;
  }
  if (reverse.length === 0) throw new RepoReplayError("PROCESSING_FAILED", "Git history did not contain a root commit.");
  const commits = reverse.reverse().map((commit, sequence) => ({ ...commit, firstParentSha: commit.parentShas[0] ?? null, sequence }));
  if (commits[0].firstParentSha !== null || commits.at(-1)?.sha !== headSha) throw new RepoReplayError("PROCESSING_FAILED", "Git history did not match the frozen head contract.");
  for (let index = 1; index < commits.length; index += 1) if (commits[index].firstParentSha !== commits[index - 1].sha) throw new RepoReplayError("PROCESSING_FAILED", "Git history contains an invalid first-parent chain.");
  return { rootSha: commits[0].sha, headSha, commits };
}
