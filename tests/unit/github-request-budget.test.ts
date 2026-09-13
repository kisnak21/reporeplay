import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/github/app-auth", () => ({
  getInstallationToken: vi.fn().mockResolvedValue("fixture-token"),
}));

import { GitHubAppSource } from "../../src/server/github/client";
import { runPreflight } from "../../src/server/github/preflight";
import { detectDependenciesForHistory, detectRoutesForHistory } from "../../src/server/processing/detectors";
import { traverseFirstParent } from "../../src/server/processing/first-parent";

const SHOWCASE_SIZED_FIXTURE = {
  firstParentCommitCount: 184,
  headFileCount: 3_210,
  manifestPaths: ["apps/storefront/package.json", "apps/admin/package.json"],
  dependencyChangeSequences: [80, 150],
};

const LINEAR_FIXTURE = {
  firstParentCommitCount: 2,
  headFileCount: 10,
  manifestPaths: SHOWCASE_SIZED_FIXTURE.manifestPaths,
  dependencyChangeSequences: [1],
};

interface RequestCounts {
  repository: number;
  branch: number;
  commit: number;
  tree: number;
  content: number;
}

function createCountedFetch(fixture = SHOWCASE_SIZED_FIXTURE) {
  const { firstParentCommitCount, headFileCount, manifestPaths, dependencyChangeSequences } = fixture;
  const changes = new Set(dependencyChangeSequences);
  const shaBySequence = Array.from({ length: firstParentCommitCount }, (_, sequence) => commitSha(sequence));
  const sequenceBySha = new Map(shaBySequence.map((sha, sequence) => [sha, sequence]));
  const paths = createTreePaths(headFileCount, manifestPaths);
  const requestPaths: string[] = [];
  let treeRequests = 0;

  const fetchImpl: typeof globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    requestPaths.push(url.pathname);

    if (url.pathname === "/repos/acme/ledger") {
      return jsonResponse({
        id: 1842,
        full_name: "acme/ledger",
        name: "ledger",
        private: false,
        default_branch: "main",
        html_url: "https://github.com/acme/ledger",
        owner: { login: "acme" },
        size: 100,
      });
    }
    if (url.pathname.endsWith("/git/ref/heads/main")) {
      return jsonResponse({
        ref: "refs/heads/main",
        object: { sha: shaBySequence.at(-1), type: "commit", url: "https://api.github.com/fixture" },
      });
    }
    if (url.pathname.includes("/commits/")) {
      const sha = url.pathname.split("/").at(-1) ?? "";
      const sequence = sequenceBySha.get(sha);
      if (sequence === undefined) return jsonResponse({ message: "unknown fixture commit" }, 404);
      return jsonResponse(commitResponse(sequence, sha, shaBySequence, changes.has(sequence)));
    }
    if (url.pathname.includes("/git/trees/")) {
      treeRequests += 1;
      const pathsForTree = treeRequests === 1 ? paths : paths.slice(0, 4);
      return jsonResponse({
        sha: "fixture-tree",
        tree: pathsForTree.map((path, index) => ({
          path,
          mode: "100644",
          type: "blob",
          sha: `blob-${index}`,
        })),
        truncated: false,
      });
    }
    if (url.pathname.includes("/contents/")) {
      const path = url.pathname.split("/contents/")[1]?.split("/").map(decodeURIComponent).join("/");
      const ref = url.searchParams.get("ref") ?? "";
      const sequence = sequenceBySha.get(ref) ?? firstParentCommitCount - 1;
      const version = path === manifestPaths[1] ? "15.5.0" : dependencyVersion(sequence);
      const content = Buffer.from(JSON.stringify({ dependencies: { next: version } })).toString("base64");
      return jsonResponse({ type: "file", encoding: "base64", content, sha: `manifest-${sequence}` });
    }

    return jsonResponse({ message: "unhandled fixture request" }, 404);
  };

  return {
    fetch: fetchImpl,
    counts(): RequestCounts {
      return {
        repository: requestPaths.filter((path) => path === "/repos/acme/ledger").length,
        branch: requestPaths.filter((path) => path.endsWith("/git/ref/heads/main")).length,
        commit: requestPaths.filter((path) => path.includes("/commits/")).length,
        tree: requestPaths.filter((path) => path.includes("/git/trees/")).length,
        content: requestPaths.filter((path) => path.includes("/contents/")).length,
      };
    },
  };
}

function commitSha(sequence: number): string {
  return `fixture-${String(sequence).padStart(3, "0")}`;
}

function dependencyVersion(sequence: number): string {
  if (sequence < 80) return "15.4.0";
  if (sequence < 150) return "15.5.0";
  return "15.6.0";
}

function createTreePaths(fileCount: number, manifestPaths: string[]): string[] {
  const paths = [
    manifestPaths[0],
    "apps/storefront/src/app/page.tsx",
    manifestPaths[1],
    "apps/admin/pages/page.tsx",
  ];
  for (let index = paths.length; index < fileCount; index += 1) {
    paths.push(`apps/storefront/src/components/component-${index}.tsx`);
  }
  return paths;
}

function commitResponse(
  sequence: number,
  sha: string,
  shaBySequence: string[],
  hasDependencyChange: boolean,
) {
  const parent = sequence > 0 ? [{ sha: shaBySequence[sequence - 1] }] : [];
  return {
    sha,
    commit: {
      message: `feat: fixture change ${sequence}`,
      author: { name: "Fixture Author", email: null, date: "2026-09-13T00:00:00Z" },
      committer: { name: "Fixture Author", email: null, date: "2026-09-13T00:00:00Z" },
      tree: { sha: `tree-${sequence}` },
    },
    parents: parent,
    html_url: `https://github.com/acme/ledger/commit/${sha}`,
    stats: { additions: 1, deletions: 1, total: 2 },
    files: hasDependencyChange
      ? [{ filename: "apps/storefront/package.json", status: "modified", additions: 1, deletions: 1, changes: 2 }]
      : [],
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function totalRequests(counts: RequestCounts): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0);
}

describe("GitHub REST request budget", () => {
  it("measures preflight and processing calls for showcase-sized fixture data", async () => {
    const github = createCountedFetch();
    const source = new GitHubAppSource(
      { appId: "fixture-app", privateKey: "unused by mocked auth", installationId: "fixture-installation" },
      github.fetch,
    );

    const preflight = await runPreflight({
      source,
      owner: "acme",
      name: "ledger",
      maxCommits: 500,
      maxFiles: 25_000,
    });

    expect(preflight.firstParentCommitCount).toBe(SHOWCASE_SIZED_FIXTURE.firstParentCommitCount);
    expect(preflight.headFileCount).toBe(SHOWCASE_SIZED_FIXTURE.headFileCount);
    expect(preflight.candidates).toHaveLength(2);
    expect(github.counts()).toEqual({ repository: 1, branch: 1, commit: 184, tree: 1, content: 2 });

    const chain = await traverseFirstParent(
      source,
      "acme",
      "ledger",
      preflight.headSha,
      500,
    );
    const history = { source, owner: "acme", name: "ledger", selectedAppRoot: "apps/storefront", commits: chain.commits };
    await detectDependenciesForHistory(history);
    await detectRoutesForHistory(history);

    expect(github.counts()).toEqual({ repository: 1, branch: 1, commit: 368, tree: 185, content: 6 });
    expect(totalRequests(github.counts())).toBe(561);
  });

  it("measures the linear two-commit fixture before a public import", async () => {
    const github = createCountedFetch(LINEAR_FIXTURE);
    const source = new GitHubAppSource(
      { appId: "fixture-app", privateKey: "unused by mocked auth", installationId: "fixture-installation" },
      github.fetch,
    );
    const preflight = await runPreflight({
      source,
      owner: "acme",
      name: "ledger",
      maxCommits: 500,
      maxFiles: 25_000,
    });

    expect(preflight.firstParentCommitCount).toBe(LINEAR_FIXTURE.firstParentCommitCount);
    expect(preflight.headFileCount).toBe(LINEAR_FIXTURE.headFileCount);
    expect(preflight.candidates).toHaveLength(2);
    expect(github.counts()).toEqual({ repository: 1, branch: 1, commit: 2, tree: 1, content: 2 });
    expect(totalRequests(github.counts())).toBe(7);
  });
});
