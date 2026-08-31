import { NextResponse } from "next/server";
import { getPool } from "@/server/db/client-pool";

export async function GET(_request: Request, { params }: { params: Promise<{ repositoryId: string; sha: string }> }) {
  const { repositoryId, sha } = await params;
  const pool = getPool(process.env.DATABASE_URL!);
  const repo = await pool.query(`SELECT "activeRunId" FROM "Repository" WHERE "id"=$1`, [repositoryId]);
  const runId = repo.rows[0]?.activeRunId;
  if (!runId) return NextResponse.json({ error: { code: "REPOSITORY_NOT_FOUND", message: "Active snapshot not found." } }, { status: 404 });
  const commit = await pool.query(
    `SELECT c."sha",c."shortSha",c."message",c."authorName",c."authoredAt",c."committedAt",c."firstParentSha",c."additions",c."deletions",c."changedFileCount",c."externalUrl",cat."category",cat."source" FROM "RunCommit" c LEFT JOIN "CommitCategory" cat ON cat."runCommitId"=c."id" WHERE c."runId"=$1 AND (c."sha"=$2 OR c."shortSha"=$2)`,
    [runId, sha],
  );
  if (!commit.rows[0]) return NextResponse.json({ error: { code: "REPOSITORY_NOT_FOUND", message: "Commit not found." } }, { status: 404 });
  const c = commit.rows[0] as typeof commit.rows[0] & { category: string | null; source: string | null };
  const files = await pool.query(`SELECT "path","previousPath","status","additions","deletions","changes" FROM "CommitFile" WHERE "runId"=$1 AND "runCommitId"=(SELECT "id" FROM "RunCommit" WHERE "runId"=$1 AND "sha"=$2) ORDER BY "path"`, [runId, c.sha]);
  return NextResponse.json({
    data: {
      snapshot: { runId },
      sha: c.sha,
      shortSha: c.shortSha,
      firstParentSha: c.firstParentSha,
      message: c.message,
      authorName: c.authorName,
      authoredAt: c.authoredAt,
      committedAt: c.committedAt,
      statistics: { changedFiles: c.changedFileCount, additions: c.additions, deletions: c.deletions },
      category: { value: c.category ?? "UNCATEGORIZED", source: c.source ?? "NONE" },
      files: files.rows,
      dependencyChanges: [],
      routeChanges: [],
      warnings: [],
      externalUrl: c.externalUrl,
    },
  });
}
