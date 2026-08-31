import { RepoReplayError } from "./errors";
import type { GitHubRepositorySource } from "./source";
import { discoverAppRoots } from "./app-root-discovery";
import { traverseFirstParent } from "../processing/first-parent";

export interface PreflightInput {
  source: GitHubRepositorySource;
  owner: string;
  name: string;
  maxCommits: number;
  maxFiles: number;
}

export async function runPreflight(input: PreflightInput) {
  const repo = await input.source.getRepository(input.owner, input.name);
  const headSha = await input.source.getBranchHead(input.owner, input.name, repo.defaultBranch);
  const commit = await input.source.getCommit(input.owner, input.name, headSha);
  const tree = await input.source.getTree(input.owner, input.name, commit.treeSha);
  if (tree.paths.length > input.maxFiles) {
    throw new RepoReplayError("REPOSITORY_LIMIT_EXCEEDED", "Repository exceeds file limit.", { limit: "headFiles", actual: tree.paths.length, allowed: input.maxFiles });
  }
  let firstParentCount: number;
  try {
    const chain = await traverseFirstParent(input.source, input.owner, input.name, headSha, input.maxCommits + 1);
    firstParentCount = chain.commits.length;
    if (firstParentCount > input.maxCommits) throw new RepoReplayError("REPOSITORY_LIMIT_EXCEEDED", "Repository exceeds commit limit.", { limit: "firstParentCommits", actual: firstParentCount, allowed: input.maxCommits });
  } catch (error) {
    if (error instanceof RepoReplayError && error.code === "REPOSITORY_LIMIT_EXCEEDED") throw error;
    throw error;
  }
  const candidates = await discoverAppRoots(input.source, input.owner, input.name, headSha, tree.paths);
  if (candidates.length === 0) throw new RepoReplayError("UNSUPPORTED_REPOSITORY", "No supported Next.js application found.");
  return { repository: repo, headSha, headFileCount: tree.paths.length, firstParentCommitCount: firstParentCount!, treeSha: commit.treeSha, candidates };
}
