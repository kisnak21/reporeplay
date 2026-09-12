import { describe, expect, it } from "vitest";
import { signPreflightToken, verifyPreflightToken, type PreflightEvidence } from "../../src/server/security/preflight-token";

const secret = "test-signing-secret-with-at-least-32-characters";
const evidence: PreflightEvidence = {
  repository: { externalId: "123", owner: "acme", name: "web", fullName: "acme/web", canonicalUrl: "https://github.com/acme/web", defaultBranch: "main" },
  headSha: "a".repeat(40), firstParentCommitCount: 1, headFileCount: 2,
  candidates: [{ path: ".", manifestPath: "package.json", routeRoots: ["app"], routeFileCount: 1 }],
  limits: { maxFirstParentCommits: 500, maxHeadFiles: 25_000 },
};

describe("signed preflight evidence", () => {
  it("round-trips the frozen source, candidates and limits", () => {
    const token = signPreflightToken(evidence, { secret, now: 1_000, lifetimeSeconds: 10 });
    expect(verifyPreflightToken(token, { secret, now: 10_999 })).toEqual(evidence);
  });

  it("rejects expiry at the exact boundary", () => {
    const token = signPreflightToken(evidence, { secret, now: 1_000, lifetimeSeconds: 10 });
    expect(() => verifyPreflightToken(token, { secret, now: 11_000 })).toThrow("expired");
  });

  it("rejects a modified payload, a different key, and malformed tokens", () => {
    const token = signPreflightToken(evidence, { secret, lifetimeSeconds: 10 });
    const [payload, signature] = token.split(".");
    const changed = JSON.parse(Buffer.from(payload, "base64url").toString());
    changed.evidence.headSha = "b".repeat(40);
    const tampered = `${Buffer.from(JSON.stringify(changed)).toString("base64url")}.${signature}`;
    for (const invalid of [tampered, "bad-token", `${token}.extra`, `${payload}.AA`]) {
      expect(() => verifyPreflightToken(invalid, { secret })).toThrow("invalid");
    }
    expect(() => verifyPreflightToken(token, { secret: "different-secret" })).toThrow("invalid");
  });
});
