import { describe, expect, it } from "vitest";
import { formatWorkerLog } from "../../worker/logging";

describe("worker structured logs", () => {
  it("formats safe job context as a timestamped JSON line", () => {
    const line = formatWorkerLog(
      "warn",
      "worker.job.retry_scheduled",
      {
        workerId: "worker-a",
        jobId: "job-123",
        runId: "run-456",
        leaseGeneration: 3,
        attemptCount: 2,
        maxAttempts: 4,
        errorCode: "GITHUB_UNAVAILABLE",
        resultStatus: "RETRYABLE",
      },
      new Date("2026-09-13T08:00:00.000Z"),
    );

    expect(JSON.parse(line)).toEqual({
      timestamp: "2026-09-13T08:00:00.000Z",
      level: "warn",
      service: "reporeplay-worker",
      event: "worker.job.retry_scheduled",
      workerId: "worker-a",
      jobId: "job-123",
      runId: "run-456",
      leaseGeneration: 3,
      attemptCount: 2,
      maxAttempts: 4,
      errorCode: "GITHUB_UNAVAILABLE",
      resultStatus: "RETRYABLE",
    });
    expect(line.endsWith("\n")).toBe(true);
    expect(line).not.toContain("message");
  });
});
