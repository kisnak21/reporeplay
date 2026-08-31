export interface RetryPolicy {
  baseSeconds: number;
  maxSeconds: number;
  jitterPercent: number;
}

export function computeRetryDelaySeconds(attemptCount: number, policy: RetryPolicy, random: () => number = Math.random): number {
  const exponent = Math.max(0, attemptCount - 1);
  const baseDelay = Math.min(policy.maxSeconds, policy.baseSeconds * 2 ** exponent);
  const jitterRange = baseDelay * (policy.jitterPercent / 100);
  return Math.round(Math.min(policy.maxSeconds, baseDelay + jitterRange * random()));
}

export function hasExhaustedAttempts(attemptCount: number, maxAttempts: number): boolean {
  return attemptCount >= maxAttempts;
}
