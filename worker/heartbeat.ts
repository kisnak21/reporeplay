import type { Pool } from "pg";
import { heartbeatJob, type ClaimedJob } from "../src/server/jobs/repository";

export interface HeartbeatController {
  lostLease: Promise<void>;
  stop(): void;
}

export function startJobHeartbeat(pool: Pool, job: ClaimedJob, intervalSeconds: number, leaseSeconds: number): HeartbeatController {
  let rejectLease: (error: Error) => void = () => undefined;
  const lostLease = new Promise<void>((_, reject) => { rejectLease = reject; });
  async function renew(): Promise<void> {
    try {
      const renewed = await heartbeatJob(pool, job, leaseSeconds);
      if (!renewed) { if (timer) clearInterval(timer); rejectLease(new Error(`Lease lost for job ${job.jobId}`)); }
    } catch (error) { if (timer) clearInterval(timer); rejectLease(error instanceof Error ? error : new Error("Heartbeat failed")); }
  }
  const timer = setInterval(() => void renew(), intervalSeconds * 1_000);
  timer.unref();
  return { lostLease, stop: () => { if (timer) clearInterval(timer); } };
}
