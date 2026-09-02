ALTER TABLE "ProcessingRun" ADD COLUMN "fetchedCommitCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProcessingRun" ADD CONSTRAINT "ProcessingRun_fetched_count_check" CHECK ("fetchedCommitCount" >= 0 AND ("expectedCommitCount" IS NULL OR "fetchedCommitCount" <= "expectedCommitCount"));
