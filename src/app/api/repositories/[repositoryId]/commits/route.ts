import { NextResponse } from "next/server";
import { getPool } from "@/server/db/client-pool";

function decodeCursor(cursor: string | null): number | null {
  if (!cursor) return null;
  try { return Number(Buffer.from(cursor, "base64url").toString()); } catch { return null; }
}
function encodeCursor(seq: number): string { return Buffer.from(String(seq)).toString("base64url"); }

export async function GET(request: Request, { params }: { params: Promise<{ repositoryId: string }> }) {
  const { repositoryId } = await params;
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 30), 1), 100);
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const query = url.searchParams.get("query")?.trim() ?? "";
  const pool = getPool(process.env.DATABASE_URL!);
  const repo = await pool.query(`SELECT "activeRunId" FROM "Repository" WHERE "id"=$1`, [repositoryId]);
  if (!repo.rows[0]?.activeRunId) return NextResponse.json({ data: { snapshot: null, items: [], pageInfo: { nextCursor: null, hasNextPage: false } } });
  const runId = repo.rows[0].activeRunId;
  const conditions: string[] = ['"runId"=$1'];
  const values: unknown[] = [runId];
  let idx = 2;
  if (cursor !== null) { conditions.push(`"sequence" < $${idx++}`); values.push(cursor); }
  if (query) { conditions.push(`"message" ILIKE $${idx++}`); values.push(`%${query}%`); }
  const where = conditions.join(" AND ");
  const result = await pool.query(
    `SELECT "sha","shortSha","message","authorName","committedAt","additions","deletions","changedFileCount","sequence" FROM "RunCommit" WHERE ${where} ORDER BY "sequence" DESC LIMIT $${idx}`,
    [...values, limit + 1],
  );
  const hasNext = result.rows.length > limit;
  const items = result.rows.slice(0, limit);
  const nextCursor = hasNext ? encodeCursor(items[items.length - 1].sequence) : null;
  const head = await pool.query(`SELECT "headSha" FROM "ProcessingRun" WHERE "id"=$1`, [runId]);
  return NextResponse.json({
    data: {
      snapshot: { runId, headSha: head.rows[0]?.headSha ?? null },
      items: items.map((r) => ({
        sha: r.sha,
        shortSha: r.shortSha,
        message: r.message,
        authorName: r.authorName,
        committedAt: r.committedAt,
        statistics: { changedFiles: r.changedFileCount, additions: r.additions, deletions: r.deletions },
        category: "UNCATEGORIZED",
        eventSummary: { routesAdded: 0, routesRemoved: 0, dependenciesAdded: 0, dependenciesRemoved: 0, dependenciesUpdated: 0 },
        warnings: [],
      })),
      pageInfo: { nextCursor, hasNextPage: hasNext },
    },
  });
}
