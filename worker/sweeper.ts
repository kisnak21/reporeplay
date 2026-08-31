import type { Pool } from "pg";
import { recoverExpiredJobs } from "../src/server/jobs/repository";
import type { RetryPolicy } from "../src/server/jobs/retry-policy";

export interface SweeperController { stop(): void }

export function startSweeper(pool: Pool, intervalMs: number, policy: RetryPolicy): SweeperController {
  const timer = setInterval(() => void recoverExpiredJobs(pool, policy), intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
