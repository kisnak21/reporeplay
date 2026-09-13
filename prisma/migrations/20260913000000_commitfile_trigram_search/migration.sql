CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "CommitFile_path_previousPath_trgm_idx"
ON "CommitFile" USING GIN ("path" gin_trgm_ops, "previousPath" gin_trgm_ops);
