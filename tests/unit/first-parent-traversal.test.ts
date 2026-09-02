import { describe, expect, it, vi } from "vitest";
import { traverseFirstParent } from "../../src/server/processing/first-parent";
import type { GitHubRepositorySource } from "../../src/server/github/source";

function createSource(commits: Record<string, { parentShas: string[]; treeSha?: string }>): GitHubRepositorySource {
  return {
    getRepository: vi.fn(),
    getBranchHead: vi.fn(),
    getCommit: async (_o: string, _r: string, sha: string) => {
      const entry = commits[sha];
      if (!entry) throw new Error(`missing ${sha}`);
      return {
        sha,
        treeSha: entry.treeSha ?? `tree-${sha}`,
        parentShas: entry.parentShas,
        message: `commit ${sha}`,
        authorName: "Test",
        authoredAt: new Date("2024-01-01"),
        committedAt: new Date("2024-01-01"),
        externalUrl: `https://github.com/test/repo/commit/${sha}`,
        additions: 1,
        deletions: 0,
        changedFileCount: 1,
        files: [{ path: "file.ts", previousPath: null, status: "ADDED", additions: 1, deletions: 0, changes: 1 }],
      };
    },
    getTree: vi.fn(),
    getFile: vi.fn(),
    getRateLimit: vi.fn(),
  } as unknown as GitHubRepositorySource;
}

describe("traverseFirstParent", () => {
  it("traverses linear history and assigns sequences", async () => {
    const source = createSource({ c1: { parentShas: [] }, c2: { parentShas: ["c1"] }, c3: { parentShas: ["c2"] } });
    const chain = await traverseFirstParent(source, "o", "r", "c3", 10);
    expect(chain.commits.map((c) => c.sha)).toEqual(["c1", "c2", "c3"]);
    expect(chain.commits.map((c) => c.sequence)).toEqual([0, 1, 2]);
    expect(chain.rootSha).toBe("c1");
  });

  it("follows only first parent on merges", async () => {
    const source = createSource({ c1: { parentShas: [] }, c2: { parentShas: ["c1"] }, c3: { parentShas: ["c1"] }, m1: { parentShas: ["c2", "c3"] } });
    const chain = await traverseFirstParent(source, "o", "r", "m1", 10);
    expect(chain.commits.map((c) => c.sha)).toEqual(["c1", "c2", "m1"]);
  });

  it("reports each fetched commit in head-to-root order", async () => {
    const source = createSource({ c1: { parentShas: [] }, c2: { parentShas: ["c1"] }, c3: { parentShas: ["c2"] } });
    const progress: number[] = [];
    await traverseFirstParent(source, "o", "r", "c3", 10, async (count) => { progress.push(count); });
    expect(progress).toEqual([1, 2, 3]);
  });

  it("rejects cycles", async () => {
    const source = createSource({ c1: { parentShas: ["c2"] }, c2: { parentShas: ["c1"] } });
    await expect(traverseFirstParent(source, "o", "r", "c1", 10)).rejects.toThrow("cycle");
  });

  it("rejects limit exceeded", async () => {
    const source = createSource({ c1: { parentShas: [] }, c2: { parentShas: ["c1"] }, c3: { parentShas: ["c2"] } });
    await expect(traverseFirstParent(source, "o", "r", "c3", 2)).rejects.toThrow("exceeds");
  });
});
