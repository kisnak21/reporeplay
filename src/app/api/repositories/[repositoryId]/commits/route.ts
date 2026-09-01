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
  const category = url.searchParams.get("category")?.trim() ?? "";
  const path = url.searchParams.get("path")?.trim() ?? "";
  const event = url.searchParams.get("event")?.trim() ?? "";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const pool = getPool(process.env.DATABASE_URL!);
  const repo = await pool.query(`SELECT "activeRunId" FROM "Repository" WHERE "id"=$1`, [repositoryId]);
  if (!repo.rows[0]?.activeRunId) return NextResponse.json({ data: { snapshot: null, items: [], pageInfo: { nextCursor: null, hasNextPage: false } } });
  const runId = repo.rows[0].activeRunId;
  const conditions: string[] = ['c."runId"=$1'];
  const values: unknown[] = [runId];
  let idx = 2;
  if (cursor !== null) { conditions.push(`c."sequence" < $${idx++}`); values.push(cursor); }
  if (query) { conditions.push(`c."message" ILIKE $${idx++}`); values.push(`%${query}%`); }
  if (category) { conditions.push(`cat."category"=$${idx++}::"CommitCategoryValue"`); values.push(category); }
  if (path) {
    conditions.push(`EXISTS (SELECT 1 FROM "CommitFile" cf WHERE cf."runId"=c."runId" AND cf."runCommitId"=c."id" AND (cf."path" ILIKE $${idx} OR cf."previousPath" ILIKE $${idx}))`);
    values.push(`%${path}%`);
    idx += 1;
  }
  if (from) { conditions.push(`c."committedAt">=$${idx++}`); values.push(from); }
  if (to) { conditions.push(`c."committedAt"<=$${idx++}`); values.push(to); }
  if (event === "ROUTE") conditions.push(`EXISTS (SELECT 1 FROM "RouteChange" rc WHERE rc."runId"=c."runId" AND rc."runCommitId"=c."id")`);
  if (event === "DEPENDENCY") conditions.push(`EXISTS (SELECT 1 FROM "DependencyChange" dc WHERE dc."runId"=c."runId" AND dc."runCommitId"=c."id")`);
  const where = conditions.join(" AND ");
  const result = await pool.query(
    `SELECT c."sha",c."shortSha",c."message",c."authorName",c."committedAt",c."additions",c."deletions",c."changedFileCount",c."sequence",cat."category",
      (SELECT COUNT(*)::int FROM "RouteChange" rc WHERE rc."runId"=c."runId" AND rc."runCommitId"=c."id" AND rc."changeType"='ADDED') AS "routesAdded",
      (SELECT COUNT(*)::int FROM "RouteChange" rc WHERE rc."runId"=c."runId" AND rc."runCommitId"=c."id" AND rc."changeType"='REMOVED') AS "routesRemoved",
      (SELECT COUNT(*)::int FROM "DependencyChange" dc WHERE dc."runId"=c."runId" AND dc."runCommitId"=c."id" AND dc."changeType"='ADDED') AS "dependenciesAdded",
      (SELECT COUNT(*)::int FROM "DependencyChange" dc WHERE dc."runId"=c."runId" AND dc."runCommitId"=c."id" AND dc."changeType"='REMOVED') AS "dependenciesRemoved",
      (SELECT COUNT(*)::int FROM "DependencyChange" dc WHERE dc."runId"=c."runId" AND dc."runCommitId"=c."id" AND dc."changeType"='UPDATED') AS "dependenciesUpdated",
      COALESCE((SELECT json_agg(json_build_object('code',w."code",'path',w."path",'message',w."message") ORDER BY w."createdAt",w."id") FROM "ProcessingWarning" w WHERE w."runId"=c."runId" AND w."runCommitId"=c."id"),'[]'::json) AS "warnings"
      FROM "RunCommit" c LEFT JOIN "CommitCategory" cat ON cat."runId"=c."runId" AND cat."runCommitId"=c."id" WHERE ${where} ORDER BY c."sequence" DESC LIMIT $${idx}`,
    [...values, limit + 1],
  );
  const hasNext = result.rows.length > limit;
  const items = result.rows.slice(0, limit);
  const nextCursor = hasNext ? encodeCursor(items[items.length - 1].sequence) : null;
  const head = await pool.query(`SELECT "headSha" FROM "ProcessingRun" WHERE "id"=$1`, [runId]);
  return NextResponse.json({
    data: {
      snapshot: { runId, headSha: head.rows[0]?.headSha ?? null },
      items: items.map((r: { sha: string; shortSha: string; message: string; authorName: string | null; committedAt: string; additions: number; deletions: number; changedFileCount: number; category: string | null; routesAdded: number; routesRemoved: number; dependenciesAdded: number; dependenciesRemoved: number; dependenciesUpdated: number; warnings: unknown[] }) => ({
        sha: r.sha,
        shortSha: r.shortSha,
        message: r.message,
        authorName: r.authorName,
        committedAt: r.committedAt,
        statistics: { changedFiles: r.changedFileCount, additions: r.additions, deletions: r.deletions },
        category: r.category ?? "UNCATEGORIZED",
        eventSummary: { routesAdded: r.routesAdded, routesRemoved: r.routesRemoved, dependenciesAdded: r.dependenciesAdded, dependenciesRemoved: r.dependenciesRemoved, dependenciesUpdated: r.dependenciesUpdated },
        warnings: r.warnings,
      })),
      pageInfo: { nextCursor, hasNextPage: hasNext },
    },
  });
}
