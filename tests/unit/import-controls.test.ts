import { describe, expect, it } from "vitest";
import { parseEnvironment } from "../../src/lib/environment";
import { requestSubject } from "../../src/server/security/import-controls";

const environment = parseEnvironment({ NODE_ENV: "test", DATABASE_URL: "postgresql://localhost/test", GITHUB_APP_ID: "1", GITHUB_APP_PRIVATE_KEY: "test-key", GITHUB_APP_INSTALLATION_ID: "1" });

describe("trusted import identity", () => {
  it("ignores arbitrary forwarding headers until a trusted header is configured", () => {
    const request = (ip: string) => new Request("http://localhost/api/repositories", { headers: { "x-forwarded-for": ip } });
    expect(requestSubject(request("192.0.2.1"), environment)).toBe(requestSubject(request("192.0.2.2"), environment));
  });

  it("hashes validated client IPs and canonicalizes IPv6 spellings", () => {
    const trusted = { ...environment, TRUSTED_CLIENT_IP_HEADER: "x-real-ip" };
    const request = (ip: string) => new Request("http://localhost/api/repositories", { headers: { "x-real-ip": ip } });
    expect(requestSubject(request("2001:db8::1"), trusted)).toBe(requestSubject(request("2001:0db8:0:0:0:0:0:1"), trusted));
    expect(requestSubject(request("192.0.2.1"), trusted)).not.toBe(requestSubject(request("192.0.2.2"), trusted));
    expect(requestSubject(request("192.0.2.1"), trusted)).toMatch(/^[a-f0-9]{64}$/);
    expect(requestSubject(request("192.0.2.1, 192.0.2.2"), trusted)).toBe(requestSubject(new Request("http://localhost"), trusted));
  });
});
