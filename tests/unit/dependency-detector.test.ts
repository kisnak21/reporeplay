import { describe, expect, it, vi } from "vitest";
import type { GitHubRepositorySource } from "../../src/server/github/source";
import { detectDependencyHistory } from "../../src/server/processing/dependency-detector";
import type { FirstParentCommit } from "../../src/server/processing/first-parent";

function createCommit(sha: string, firstParentSha: string | null, files: FirstParentCommit["files"]): FirstParentCommit {
  return {
    sha,
    treeSha: `tree-${sha}`,
    parentShas: firstParentSha ? [firstParentSha] : [],
    firstParentSha,
    sequence: firstParentSha ? 1 : 0,
    message: sha,
    authorName: "Test",
    authoredAt: new Date("2024-01-01"),
    committedAt: new Date("2024-01-01"),
    externalUrl: `https://github.com/test/repo/commit/${sha}`,
    additions: 1,
    deletions: 0,
    changedFileCount: files.length,
    files,
  };
}

function createSource(files: Record<string, string | null>): GitHubRepositorySource {
  return {
    getRepository: vi.fn(),
    getBranchHead: vi.fn(),
    getCommit: vi.fn(),
    getTree: vi.fn(),
    getFile: vi.fn(async (_owner, _name, path, ref) => files[`${ref}:${path}`] ?? null),
    getRateLimit: vi.fn(),
  } as unknown as GitHubRepositorySource;
}

describe("detectDependencyHistory", () => {
  it("detects additions, updates, removals, and dependency group moves", async () => {
    const source = createSource({
      "root:apps/storefront/package.json": JSON.stringify({ dependencies: { react: "18.0.0", legacy: "1.0.0" } }),
      "change:apps/storefront/package.json": JSON.stringify({ dependencies: { react: "18.2.0" }, devDependencies: { legacy: "1.0.0", vitest: "2.0.0" } }),
      "remove:apps/storefront/package.json": null,
    });
    const commits = [
      createCommit("root", null, [{ path: "apps/storefront/package.json", previousPath: null, status: "ADDED", additions: 1, deletions: 0, changes: 1 }]),
      createCommit("change", "root", [{ path: "apps/storefront/package.json", previousPath: null, status: "MODIFIED", additions: 1, deletions: 1, changes: 2 }]),
      createCommit("remove", "change", [{ path: "apps/storefront/package.json", previousPath: "apps/storefront/package.json", status: "REMOVED", additions: 0, deletions: 1, changes: 1 }]),
    ];

    const result = await detectDependencyHistory({ source, owner: "test", name: "repo", selectedAppRoot: "apps/storefront", commits });

    expect(result.warnings).toEqual([]);
    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ commitSha: "root", packageName: "react", dependencyGroup: "DEPENDENCY", changeType: "ADDED", previousValue: null, currentValue: "18.0.0" }),
      expect.objectContaining({ commitSha: "change", packageName: "react", dependencyGroup: "DEPENDENCY", changeType: "UPDATED", previousValue: "18.0.0", currentValue: "18.2.0" }),
      expect.objectContaining({ commitSha: "change", packageName: "legacy", dependencyGroup: "DEPENDENCY", changeType: "REMOVED", previousValue: "1.0.0", currentValue: null }),
      expect.objectContaining({ commitSha: "change", packageName: "legacy", dependencyGroup: "DEV_DEPENDENCY", changeType: "ADDED", previousValue: null, currentValue: "1.0.0" }),
      expect.objectContaining({ commitSha: "remove", packageName: "react", changeType: "REMOVED", previousValue: "18.2.0", currentValue: null }),
    ]));
  });

  it("withholds transitions for malformed manifests and reports a warning", async () => {
    const source = createSource({ "bad:package.json": "{not-json" });
    const result = await detectDependencyHistory({
      source,
      owner: "test",
      name: "repo",
      selectedAppRoot: ".",
      commits: [createCommit("bad", null, [{ path: "package.json", previousPath: null, status: "ADDED", additions: 1, deletions: 0, changes: 1 }])],
    });

    expect(result.changes).toEqual([]);
    expect(result.warnings).toEqual([expect.objectContaining({ commitSha: "bad", code: "MALFORMED_MANIFEST", path: "package.json" })]);
  });
});
