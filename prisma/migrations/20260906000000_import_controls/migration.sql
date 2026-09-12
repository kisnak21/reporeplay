CREATE TABLE "IdempotencyRecord" (
  "scope" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "status" INTEGER NOT NULL,
  "response" JSONB NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  PRIMARY KEY ("scope", "keyHash")
);
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

CREATE TABLE "ImportRateWindow" (
  "subjectHash" TEXT PRIMARY KEY,
  "count" INTEGER NOT NULL CHECK ("count" > 0),
  "resetsAt" TIMESTAMPTZ NOT NULL
);
CREATE INDEX "ImportRateWindow_resetsAt_idx" ON "ImportRateWindow"("resetsAt");
