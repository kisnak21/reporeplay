import { RepoReplayError } from "./errors";
import { getInstallationToken, type AppAuth } from "./app-auth";
import {
  commitSchema,
  contentFileSchema,
  rateLimitSchema,
  refSchema,
  repositorySchema,
  treeSchema,
} from "./schemas";
import type {
  GitHubChangedFile,
  GitHubCommitDetail,
  GitHubRepositorySource,
  RateLimitState,
  RepositoryMetadata,
  RepositoryTree,
} from "./source";

const API_BASE = "https://api.github.com";
const API_VERSION = "2022-11-28";

function mapStatus(status: string): GitHubChangedFile["status"] {
  switch (status) {
    case "added":
      return "ADDED";
    case "removed":
      return "REMOVED";
    case "renamed":
      return "RENAMED";
    default:
      return "MODIFIED";
  }
}

function parseLinkHeader(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

function rateLimitFromHeaders(headers: Headers): RateLimitState | null {
  const remaining = headers.get("x-ratelimit-remaining");
  const reset = headers.get("x-ratelimit-reset");
  if (remaining === null || reset === null) return null;
  return { remaining: Number(remaining), resetAt: new Date(Number(reset) * 1000) };
}

function handleRateLimit(response: Response, headers: Headers): never {
  const state = rateLimitFromHeaders(headers);
  if (response.status === 403 && state && state.remaining === 0) {
    throw new RepoReplayError("GITHUB_RATE_LIMITED", "GitHub rate limit exceeded.", { resetAt: state.resetAt.toISOString() });
  }
  if (response.status === 429) throw new RepoReplayError("GITHUB_RATE_LIMITED", "GitHub rate limit exceeded.");
  throw new RepoReplayError("GITHUB_UNAVAILABLE", `GitHub unavailable: ${response.status}`);
}

export function createGitHubSourceFromEnvironment(environment: { GITHUB_APP_ID: string; GITHUB_APP_PRIVATE_KEY: string; GITHUB_APP_INSTALLATION_ID: string }, fetchImpl: typeof fetch = fetch): GitHubAppSource {
  return new GitHubAppSource({ appId: environment.GITHUB_APP_ID, privateKey: environment.GITHUB_APP_PRIVATE_KEY, installationId: environment.GITHUB_APP_INSTALLATION_ID }, fetchImpl);
}

export class GitHubAppSource implements GitHubRepositorySource {
  constructor(
    private readonly auth: AppAuth,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async token(): Promise<string> {
    return getInstallationToken(this.auth, this.fetchImpl);
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.token();
    const response = await this.fetchImpl(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
        Authorization: `Bearer ${token}`,
        "User-Agent": "reporeplay",
        ...(init.headers as Record<string, string>),
      },
    });
    if (response.status === 304) return response;
    if (response.ok) return response;
    if (response.status === 404) throw new RepoReplayError("REPOSITORY_NOT_FOUND", "Repository or resource not found.");
    if (response.status === 403 || response.status === 429) handleRateLimit(response, response.headers);
    if (response.status >= 500) throw new RepoReplayError("GITHUB_UNAVAILABLE", "GitHub is temporarily unavailable.");
    const text = await response.text().catch(() => "");
    throw new RepoReplayError("GITHUB_UNAVAILABLE", `GitHub request failed: ${response.status} ${text.slice(0, 200)}`);
  }

  async getRepository(owner: string, name: string): Promise<RepositoryMetadata> {
    const res = await this.request(`/repos/${owner}/${name}`);
    const json = await res.json();
    const parsed = repositorySchema.parse(json);
    if (parsed.private) throw new RepoReplayError("REPOSITORY_NOT_PUBLIC", "Repository is private.");
    if (!parsed.default_branch) throw new RepoReplayError("EMPTY_REPOSITORY", "Repository has no default branch.");
    return {
      externalId: String(parsed.id),
      owner: parsed.owner.login,
      name: parsed.name,
      fullName: parsed.full_name,
      defaultBranch: parsed.default_branch,
      canonicalUrl: parsed.html_url,
      isPrivate: parsed.private,
      isEmpty: parsed.size === 0,
    };
  }

  async getBranchHead(owner: string, name: string, branch: string): Promise<string> {
    const res = await this.request(`/repos/${owner}/${name}/git/ref/heads/${encodeURIComponent(branch)}`);
    const parsed = refSchema.parse(await res.json());
    return parsed.object.sha;
  }

  async getCommit(owner: string, name: string, sha: string): Promise<GitHubCommitDetail> {
    let url = `/repos/${owner}/${name}/commits/${sha}`;
    let first = true;
    const allFiles: GitHubChangedFile[] = [];
    let baseCommit: GitHubCommitDetail | null = null;

    while (url) {
      const res = await this.request(url);
      const json = await res.json();
      const parsed = commitSchema.parse(json);
      if (first) {
        baseCommit = {
          sha: parsed.sha,
          treeSha: parsed.commit.tree.sha,
          parentShas: parsed.parents.map((p) => p.sha),
          message: parsed.commit.message,
          authorName: parsed.commit.author?.name ?? null,
          authoredAt: parsed.commit.author?.date ? new Date(parsed.commit.author.date) : null,
          committedAt: parsed.commit.committer?.date ? new Date(parsed.commit.committer.date) : new Date(),
          externalUrl: parsed.html_url,
          additions: parsed.stats?.additions ?? 0,
          deletions: parsed.stats?.deletions ?? 0,
          changedFileCount: 0,
          files: [],
        };
        first = false;
      }
      for (const file of parsed.files ?? []) {
        allFiles.push({
          path: file.filename,
          previousPath: file.previous_filename ?? null,
          status: mapStatus(file.status),
          additions: file.additions,
          deletions: file.deletions,
          changes: file.changes,
        });
      }
      const link = parseLinkHeader(res.headers.get("link"));
      if (link && link.includes(`/commits/${sha}`)) {
        url = link.replace(API_BASE, "");
      } else {
        url = "";
      }
      if (allFiles.length > 3000) throw new RepoReplayError("GITHUB_DATA_TRUNCATED", "Commit file list exceeds supported size.", { sha, resource: "commitFiles" });
    }

    if (!baseCommit) throw new RepoReplayError("GITHUB_UNAVAILABLE", "Failed to fetch commit.");
    baseCommit.files = allFiles;
    baseCommit.changedFileCount = allFiles.length;
    if (baseCommit.changedFileCount === 0 && allFiles.length === 0) {
      // GitHub may omit files for some commits; treat empty as valid if commit has no files
    }
    return baseCommit;
  }

  async getTree(owner: string, name: string, treeSha: string): Promise<RepositoryTree> {
    const res = await this.request(`/repos/${owner}/${name}/git/trees/${treeSha}?recursive=1`);
    const parsed = treeSchema.parse(await res.json());
    if (parsed.truncated) throw new RepoReplayError("GITHUB_DATA_TRUNCATED", "Repository tree is truncated.", { treeSha, resource: "tree" });
    return { treeSha: parsed.sha, paths: parsed.tree.filter((e) => e.type === "blob").map((e) => e.path!).filter(Boolean), complete: true };
  }

  async getFile(owner: string, name: string, path: string, ref: string): Promise<string | null> {
    const encodedPath = path.split("/").map(encodeURIComponent).join("/");
    const res = await this.fetchImpl(`${API_BASE}/repos/${owner}/${name}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": API_VERSION,
        Authorization: `Bearer ${await this.token()}`,
        "User-Agent": "reporeplay",
      },
    });
    if (res.status === 404) return null;
    if (!res.ok) {
      if (res.status === 403 || res.status === 429) handleRateLimit(res, res.headers);
      throw new RepoReplayError("GITHUB_UNAVAILABLE", `Failed to fetch file: ${res.status}`);
    }
    const json = await res.json();
    const parsed = contentFileSchema.safeParse(json);
    if (!parsed.success) return null;
    if (parsed.data.encoding === "base64") return Buffer.from(parsed.data.content, "base64").toString("utf-8");
    return parsed.data.content;
  }

  async getRateLimit(): Promise<RateLimitState> {
    const res = await this.request("/rate_limit");
    const parsed = rateLimitSchema.parse(await res.json());
    const core = parsed.resources.core;
    return { remaining: core.remaining, resetAt: new Date(core.reset * 1000) };
  }
}
