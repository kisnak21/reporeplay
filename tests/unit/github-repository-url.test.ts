import { describe, expect, it } from "vitest";
import { parseGitHubRepositoryUrl } from "../../src/server/github/repository-url";

describe("parseGitHubRepositoryUrl", () => {
  it("parses canonical URLs", () => {
    expect(parseGitHubRepositoryUrl("https://github.com/acme/ledger").canonicalUrl).toBe("https://github.com/acme/ledger");
  });

  it("normalizes .git suffix and trailing slash", () => {
    expect(parseGitHubRepositoryUrl("https://github.com/acme/ledger.git").fullName).toBe("acme/ledger");
    expect(parseGitHubRepositoryUrl("https://github.com/acme/ledger/").fullName).toBe("acme/ledger");
  });

  it("rejects non-github hosts and encoded slashes", () => {
    expect(() => parseGitHubRepositoryUrl("http://github.com/acme/ledger")).toThrow(expect.objectContaining({ code: "INVALID_REPOSITORY_URL" }));
    expect(() => parseGitHubRepositoryUrl("https://github.com/acme%2Fledger")).toThrow(expect.objectContaining({ code: "INVALID_REPOSITORY_URL" }));
    expect(() => parseGitHubRepositoryUrl("https://github.com/acme")).toThrow(expect.objectContaining({ code: "INVALID_REPOSITORY_URL" }));
    expect(() => parseGitHubRepositoryUrl("https://github.com/acme/ledger/extra")).toThrow(expect.objectContaining({ code: "INVALID_REPOSITORY_URL" }));
  });

  it("rejects credentials and query strings", () => {
    expect(() => parseGitHubRepositoryUrl("https://user:pass@github.com/acme/ledger")).toThrow(expect.objectContaining({ code: "INVALID_REPOSITORY_URL" }));
    expect(() => parseGitHubRepositoryUrl("https://github.com/acme/ledger?tab=repositories")).toThrow(expect.objectContaining({ code: "INVALID_REPOSITORY_URL" }));
  });

  it("lowercases identity key", () => {
    expect(parseGitHubRepositoryUrl("https://github.com/Acme/Ledger").identityKey).toBe("acme/ledger");
  });
});
