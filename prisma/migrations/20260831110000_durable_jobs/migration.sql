CREATE TYPE "ProcessingJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'WAITING_RATE_LIMIT', 'RETRYABLE', 'SUCCEEDED', 'FAILED', 'CANCELLED');

ALTER TABLE "ProcessingJob"
  ALTER COLUMN "status" TYPE "ProcessingJobStatus"
  USING ("status"::text::"ProcessingJobStatus");

ALTER TABLE "ProcessingJob"
  ADD COLUMN "leaseGeneration" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ProcessingJob"
  ADD CONSTRAINT "ProcessingJob_attempts_check" CHECK ("attemptCount" >= 0 AND "maxAttempts" > 0),
  ADD CONSTRAINT "ProcessingJob_lease_generation_check" CHECK ("leaseGeneration" >= 0),
  ADD CONSTRAINT "ProcessingJob_running_lease_check" CHECK (
    "status" <> 'RUNNING'
    OR ("leaseOwner" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL AND "heartbeatAt" IS NOT NULL)
  );

CREATE TABLE "WorkerHeartbeat" (
  "workerId" TEXT NOT NULL,
  "startedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastHeartbeatAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastClaimAt" TIMESTAMPTZ,
  "lastSuccessAt" TIMESTAMPTZ,
  "currentJobId" UUID,
  "processVersion" TEXT NOT NULL,
  CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("workerId")
);

CREATE INDEX "WorkerHeartbeat_lastHeartbeatAt_idx" ON "WorkerHeartbeat"("lastHeartbeatAt");
CREATE INDEX "ProcessingJob_due_idx" ON "ProcessingJob"("priority" DESC, "nextAttemptAt", "createdAt", "id") WHERE "status" IN ('QUEUED', 'RETRYABLE', 'WAITING_RATE_LIMIT');
CREATE INDEX "ProcessingJob_expired_running_idx" ON "ProcessingJob"("leaseExpiresAt") WHERE "status" = 'RUNNING';
