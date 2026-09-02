import { describe, expect, it } from "vitest";
import { hasAdminBearerToken } from "../../src/server/security/admin-auth";

describe("admin bearer authentication", () => {
  const expectedToken = "health-token";

  it("rejects requests when the expected token is not configured", () => {
    expect(hasAdminBearerToken(new Request("http://localhost"), undefined)).toBe(false);
  });

  it("rejects missing, malformed, and incorrect authorization headers", () => {
    expect(hasAdminBearerToken(new Request("http://localhost"), expectedToken)).toBe(false);
    expect(hasAdminBearerToken(new Request("http://localhost", { headers: { authorization: "Basic health-token" } }), expectedToken)).toBe(false);
    expect(hasAdminBearerToken(new Request("http://localhost", { headers: { authorization: "Bearer wrong-token" } }), expectedToken)).toBe(false);
    expect(hasAdminBearerToken(new Request("http://localhost", { headers: { authorization: "Bearer health-token-extra" } }), expectedToken)).toBe(false);
  });

  it("accepts the exact bearer token", () => {
    const request = new Request("http://localhost", { headers: { authorization: `Bearer ${expectedToken}` } });
    expect(hasAdminBearerToken(request, expectedToken)).toBe(true);
  });
});
