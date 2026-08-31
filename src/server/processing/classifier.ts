import type { Pool } from "pg";
import { assertLease, type CheckpointInput } from "@/server/jobs/staged-repository";

export type CommitCategoryValue = "FEATURE" | "FIX" | "REFACTOR" | "DOCS" | "TEST" | "STYLE" | "BUILD" | "CHORE" | "PERFORMANCE" | "CI" | "REVERT" | "UNCATEGORIZED";
export type CategorySource = "CONVENTIONAL_COMMIT" | "NONE";

const typeMap: Record<string, CommitCategoryValue> = {
  feat: "FEATURE",
  fix: "FIX",
  refactor: "REFACTOR",
  docs: "DOCS",
  test: "TEST",
  style: "STYLE",
  build: "BUILD",
  chore: "CHORE",
  perf: "PERFORMANCE",
  ci: "CI",
  revert: "REVERT",
};

export interface Classification {
  category: CommitCategoryValue;
  source: CategorySource;
  matchedType: string | null;
}

export function classifyCommitMessage(message: string): Classification {
  const firstLine = message.split("\n")[0].trim();
  const match = firstLine.match(/^([a-zA-Z]+)(?:\([^)]*\))?(!)?:/);
  if (!match) return { category: "UNCATEGORIZED", source: "NONE", matchedType: null };
  const raw = match[1].toLowerCase();
  const mapped = typeMap[raw];
  if (!mapped) return { category: "UNCATEGORIZED", source: "NONE", matchedType: raw };
  return { category: mapped, source: "CONVENTIONAL_COMMIT", matchedType: raw };
}

export async function persistCategoriesForRun(pool: Pool, job: CheckpointInput): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const leaseOk = await assertLease(client, job);
    if (!leaseOk) throw new Error("Lease lost during classification");
    const commits = await client.query<{ id: string; message: string; runId: string }>(`SELECT "id","message","runId" FROM "RunCommit" WHERE "runId"=$1`, [job.runId]);
    for (const row of commits.rows) {
      const cls = classifyCommitMessage(row.message);
      await client.query(
        `INSERT INTO "CommitCategory"("id","runId","runCommitId","category","source","matchedType") VALUES(gen_random_uuid(),$1,$2,$3::"CommitCategoryValue",$4::"CommitCategorySource",$5) ON CONFLICT("runCommitId") DO UPDATE SET "category"=EXCLUDED."category","source"=EXCLUDED."source","matchedType"=EXCLUDED."matchedType"`,
        [row.runId, row.id, cls.category, cls.source, cls.matchedType],
      );
    }
    await client.query(`UPDATE "ProcessingRun" SET "currentStep"='CLASSIFY_COMMITS',"checkpointSequence"=(SELECT COALESCE(MAX("sequence"),-1) FROM "RunCommit" WHERE "runId"=$1) WHERE "id"=$1`, [job.runId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
