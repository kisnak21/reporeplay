CREATE TYPE "RepositoryAvailability" AS ENUM ('CONFIGURATION_REQUIRED', 'PROCESSING', 'READY');
CREATE TYPE "ProcessingRunStatus" AS ENUM ('NEEDS_CONFIGURATION', 'QUEUED', 'RUNNING', 'WAITING_RATE_LIMIT', 'RETRYABLE', 'SUCCEEDED', 'FAILED', 'CANCELLED');
CREATE TYPE "ProcessingRunKind" AS ENUM ('IMPORT', 'REFRESH', 'REPROCESS');
CREATE TYPE "ProcessingStep" AS ENUM ('DISCOVER_HISTORY', 'FETCH_COMMITS', 'CLASSIFY_COMMITS', 'DETECT_DEPENDENCIES', 'DETECT_ROUTES', 'VALIDATE_RUN', 'ACTIVATE_RUN', 'COMPLETE');

CREATE TABLE "Repository" (
  "id" UUID NOT NULL,
  "provider" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "owner" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "canonicalUrl" TEXT NOT NULL,
  "defaultBranch" TEXT NOT NULL,
  "selectedAppRoot" TEXT,
  "availability" "RepositoryAvailability" NOT NULL DEFAULT 'PROCESSING',
  "activeRunId" UUID,
  "previousRunId" UUID,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  "deletedAt" TIMESTAMPTZ,
  CONSTRAINT "Repository_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProcessingRun" (
  "id" UUID NOT NULL,
  "repositoryId" UUID NOT NULL,
  "kind" "ProcessingRunKind" NOT NULL,
  "status" "ProcessingRunStatus" NOT NULL,
  "selectedAppRoot" TEXT,
  "defaultBranch" TEXT NOT NULL,
  "rootSha" TEXT,
  "headSha" TEXT NOT NULL,
  "expectedCommitCount" INTEGER,
  "headFileCount" INTEGER NOT NULL,
  "maxCommitLimit" INTEGER NOT NULL,
  "maxHeadFileLimit" INTEGER NOT NULL,
  "schemaVersion" TEXT NOT NULL,
  "classifierVersion" TEXT NOT NULL,
  "dependencyDetectorVersion" TEXT NOT NULL,
  "routeDetectorVersion" TEXT NOT NULL,
  "currentStep" "ProcessingStep" NOT NULL,
  "processedCommitCount" INTEGER NOT NULL DEFAULT 0,
  "requestedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMPTZ,
  "completedAt" TIMESTAMPTZ,
  "activatedAt" TIMESTAMPTZ,
  "errorCode" TEXT,
  "errorMessage" TEXT,
  CONSTRAINT "ProcessingRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProcessingJob" (
  "id" UUID NOT NULL,
  "runId" UUID NOT NULL,
  "status" "ProcessingRunStatus" NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 4,
  "nextAttemptAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseOwner" TEXT,
  "leaseExpiresAt" TIMESTAMPTZ,
  "heartbeatAt" TIMESTAMPTZ,
  "cancelRequestedAt" TIMESTAMPTZ,
  "lastErrorCode" TEXT,
  "lastErrorMessage" TEXT,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "ProcessingJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Repository_provider_externalId_key" ON "Repository"("provider", "externalId");
CREATE UNIQUE INDEX "Repository_provider_owner_name_key" ON "Repository"("provider", "owner", "name");
CREATE UNIQUE INDEX "Repository_activeRunId_key" ON "Repository"("activeRunId");
CREATE UNIQUE INDEX "Repository_previousRunId_key" ON "Repository"("previousRunId");
CREATE INDEX "Repository_availability_idx" ON "Repository"("availability");
CREATE INDEX "ProcessingRun_repositoryId_requestedAt_idx" ON "ProcessingRun"("repositoryId", "requestedAt" DESC);
CREATE INDEX "ProcessingRun_repositoryId_status_idx" ON "ProcessingRun"("repositoryId", "status");
CREATE UNIQUE INDEX "ProcessingRun_one_nonterminal_per_repository" ON "ProcessingRun"("repositoryId") WHERE "status" IN ('NEEDS_CONFIGURATION', 'QUEUED', 'RUNNING', 'WAITING_RATE_LIMIT', 'RETRYABLE');
CREATE UNIQUE INDEX "ProcessingJob_runId_key" ON "ProcessingJob"("runId");
CREATE INDEX "ProcessingJob_status_nextAttemptAt_priority_idx" ON "ProcessingJob"("status", "nextAttemptAt", "priority");
CREATE INDEX "ProcessingJob_leaseExpiresAt_idx" ON "ProcessingJob"("leaseExpiresAt");

ALTER TABLE "ProcessingRun" ADD CONSTRAINT "ProcessingRun_repositoryId_fkey" FOREIGN KEY ("repositoryId") REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProcessingJob" ADD CONSTRAINT "ProcessingJob_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ProcessingRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_activeRunId_fkey" FOREIGN KEY ("activeRunId") REFERENCES "ProcessingRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Repository" ADD CONSTRAINT "Repository_previousRunId_fkey" FOREIGN KEY ("previousRunId") REFERENCES "ProcessingRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
