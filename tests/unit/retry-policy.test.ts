import { describe, expect, it } from "vitest";
import { computeRetryDelaySeconds, hasExhaustedAttempts } from "../../src/server/jobs/retry-policy";

const policy = { baseSeconds: 5, maxSeconds: 60, jitterPercent: 20 };

describe("retry policy", () => {
  it("uses bounded exponential backoff", () => {
    expect(computeRetryDelaySeconds(1, policy, () => 0)).toBe(5);
    expect(computeRetryDelaySeconds(2, policy, () => 0)).toBe(10);
    expect(computeRetryDelaySeconds(8, policy, () => 0)).toBe(60);
  });

  it("applies deterministic positive jitter", () => {
    expect(computeRetryDelaySeconds(2, policy, () => 1)).toBe(12);
  });

  it("exhausts at the configured attempt count", () => {
    expect(hasExhaustedAttempts(3, 4)).toBe(false);
    expect(hasExhaustedAttempts(4, 4)).toBe(true);
  });
});
