import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { getWorkerHealth, getWorkerLiveness } from "../../src/server/jobs/repository";

function createPool(query: (sql: string) => unknown): Pool {
  return { query: vi.fn(async (sql: string) => query(sql)) } as unknown as Pool;
}

describe("worker health", () => {
  it("reports no worker as offline", async () => {
    const pool = createPool(() => ({ rows: [] }));

    await expect(getWorkerLiveness(pool)).resolves.toEqual({
      status: "OFFLINE",
      lastHeartbeatAt: null,
      heartbeatAgeSeconds: null,
    });
  });

  it("reports a stale heartbeat as offline", async () => {
    const lastHeartbeatAt = new Date("2026-09-02T02:00:00.000Z");
    const pool = createPool(() => ({ rows: [{ lastHeartbeatAt, heartbeatAgeSeconds: 121 }] }));

    await expect(getWorkerLiveness(pool, 120)).resolves.toEqual({
      status: "OFFLINE",
      lastHeartbeatAt,
      heartbeatAgeSeconds: 121,
    });
  });

  it("reports queue lag as degraded while preserving worker details", async () => {
    const lastHeartbeatAt = new Date("2026-09-02T02:00:00.000Z");
    const pool = createPool((sql) => {
      if (sql.includes("COUNT(*) FILTER")) return { rows: [{ dueJobs: 2, expiredJobs: 0, oldestDueSeconds: 90 }] };
      if (sql.includes('"lastClaimAt"')) return { rows: [{ workerId: "worker-a", processVersion: "test", lastHeartbeatAt, heartbeatAgeSeconds: 3, lastClaimAt: null, lastSuccessAt: null }] };
      return { rows: [{ workerId: "worker-a", activeJobCount: 1 }] };
    });

    await expect(getWorkerHealth(pool, 120, 60)).resolves.toMatchObject({
      status: "DEGRADED",
      heartbeatTimeoutSeconds: 120,
      workers: [{ workerId: "worker-a", activeJobCount: 1, heartbeatAgeSeconds: 3 }],
      queue: { dueJobs: 2, expiredJobs: 0, oldestDueSeconds: 90 },
    });
  });
});
