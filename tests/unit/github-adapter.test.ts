import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/server/github/app-auth", async () => {
  const actual = await vi.importActual<typeof import("../../src/server/github/app-auth")>("../../src/server/github/app-auth");
  return { ...actual, createAppJwt: vi.fn().mockResolvedValue("jwt"), getInstallationToken: vi.fn().mockResolvedValue("tok") };
});

import { GitHubAppSource } from "../../src/server/github/client";

function createFetchMock(responses: Record<string, { status: number; body: unknown; headers?: Record<string, string> }>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    for (const [path, res] of Object.entries(responses)) {
      if (url.includes(path)) {
        return new Response(JSON.stringify(res.body), {
          status: res.status,
          headers: { "content-type": "application/json", ...(res.headers ?? {}) },
        });
      }
    }
    return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
  }) as typeof fetch;
}

describe("GitHubAppSource", () => {
  it("fetches repository metadata and validates private", async () => {
    const fetchMock = createFetchMock({
      "/repos/o/r": { status: 200, body: { id: 1, full_name: "o/r", name: "r", private: false, default_branch: "main", html_url: "https://github.com/o/r", owner: { login: "o" }, size: 10 } },
    });
    const source = new GitHubAppSource({ appId: "1", privateKey: "test", installationId: "123" }, fetchMock);
    const repo = await source.getRepository("o", "r");
    expect(repo.fullName).toBe("o/r");
  });

  it("throws on truncated tree", async () => {
    const fetchMock = createFetchMock({
      "/git/trees/abc": { status: 200, body: { sha: "abc", tree: [], truncated: true } },
    });
    const source = new GitHubAppSource({ appId: "1", privateKey: "test", installationId: "123" }, fetchMock);
    await expect(source.getTree("o", "r", "abc")).rejects.toThrow("truncated");
  });
});
