import { describe, expect, it } from "vitest";
import { parseEnvironment } from "../../src/lib/environment";

const validEnvironment: NodeJS.ProcessEnv = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/reporeplay",
  GITHUB_APP_ID: "1",
  GITHUB_APP_PRIVATE_KEY: "private-key",
  GITHUB_APP_INSTALLATION_ID: "2",
};

describe("parseEnvironment", () => {
  it("applies documented defaults", () => {
    const environment = parseEnvironment(validEnvironment);

    expect(environment.MAX_FIRST_PARENT_COMMITS).toBe(500);
    expect(environment.MAX_HEAD_FILES).toBe(25_000);
    expect(environment.JOB_HEARTBEAT_SECONDS * 2).toBeLessThan(environment.JOB_LEASE_SECONDS);
    expect(environment.WORKER_CONCURRENCY).toBe(2);
    expect(environment.JOB_RETRY_MAX_SECONDS).toBe(3_600);
  });

  it("rejects a heartbeat that cannot renew before lease expiry", () => {
    expect(() => parseEnvironment({
      ...validEnvironment,
      JOB_HEARTBEAT_SECONDS: "30",
      JOB_LEASE_SECONDS: "60",
    })).toThrow("JOB_HEARTBEAT_SECONDS must be less than half of JOB_LEASE_SECONDS");
  });
});
