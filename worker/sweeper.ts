import type { Pool } from "pg";
import { recoverExpiredJobs } from "../src/server/jobs/repository";
import type { RetryPolicy } from "../src/server/jobs/retry-policy";
import { inTransaction } from "../src/server/db/transaction";
import { cleanupRequestRecords } from "../src/server/security/import-controls";
import { cleanupRetainedRuns, type RunRetentionPolicy } from "../src/server/jobs/run-retention";
import { writeWorkerLog } from "./logging";

export interface SweeperController { stop(): void }

export function startSweeper(pool: Pool, intervalMs: number, retryPolicy: RetryPolicy, retentionPolicy: RunRetentionPolicy): SweeperController {
  let sweeping = false;
  const timer = setInterval(() => {
    if (sweeping) return;
    sweeping = true;
    void recoverExpiredJobs(pool, retryPolicy)
      .then(() => inTransaction(pool, cleanupRequestRecords))
      .then(() => cleanupRetainedRuns(pool, retentionPolicy))
      .catch((error: unknown) => {
        writeWorkerLog("error", "worker.sweep_failed", {
          errorType: error instanceof Error ? error.name : "UnknownError",
        });
      })
      .finally(() => { sweeping = false; });
  }, intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
