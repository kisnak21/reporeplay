export type ChangedFileStatus = "ADDED" | "MODIFIED" | "REMOVED" | "RENAMED";

export interface GitHubChangedFile { path: string; previousPath: string | null; status: ChangedFileStatus; additions: number; deletions: number; changes: number }
export interface GitHubCommitDetail { sha: string; treeSha: string; parentShas: string[]; message: string; authorName: string | null; authoredAt: Date | null; committedAt: Date; externalUrl: string; additions: number; deletions: number; changedFileCount: number; files: GitHubChangedFile[] }
export interface RepositoryMetadata { externalId: string; owner: string; name: string; fullName: string; defaultBranch: string; canonicalUrl: string; isPrivate: boolean; isEmpty: boolean }
export interface RepositoryTree { treeSha: string; paths: string[]; complete: true }
export interface RateLimitState { remaining: number; resetAt: Date }

export interface GitHubRepositorySource {
  getRepository(owner: string, name: string): Promise<RepositoryMetadata>;
  getBranchHead(owner: string, name: string, branch: string): Promise<string>;
  getCommit(owner: string, name: string, sha: string): Promise<GitHubCommitDetail>;
  getTree(owner: string, name: string, treeSha: string): Promise<RepositoryTree>;
  getFile(owner: string, name: string, path: string, ref: string): Promise<string | null>;
  getRateLimit(): Promise<RateLimitState>;
}
