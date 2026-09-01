import { NextResponse } from "next/server";
import { getPool } from "@/server/db/client-pool";

export async function GET(_request: Request, { params }: { params: Promise<{ repositoryId: string }> }) {
  const { repositoryId } = await params;
  const pool = getPool(process.env.DATABASE_URL!);
  const repo = await pool.query(
    `SELECT "id","owner","name","fullName","canonicalUrl","defaultBranch","selectedAppRoot","availability","activeRunId","previousRunId" FROM "Repository" WHERE "id"=$1`,
    [repositoryId],
  );
  if (!repo.rows[0]) return NextResponse.json({ error: { code: "REPOSITORY_NOT_FOUND", message: "Repository not found." } }, { status: 404 });
  const row = repo.rows[0];
  let activeSnapshot: unknown = null;
  if (row.activeRunId) {
    const run = await pool.query(
      `SELECT "id","rootSha","headSha","headFileCount","maxCommitLimit","maxHeadFileLimit","schemaVersion","classifierVersion","dependencyDetectorVersion","routeDetectorVersion","completedAt","activatedAt",
        (SELECT COUNT(*)::int FROM "RunCommit" WHERE "runId"=$1) AS "commitCount",
        (SELECT MIN("committedAt") FROM "RunCommit" WHERE "runId"=$1) AS "firstAt",
        (SELECT MAX("committedAt") FROM "RunCommit" WHERE "runId"=$1) AS "lastAt",
        (SELECT COUNT(*)::int FROM (SELECT DISTINCT ON (rc."router",rc."route",rc."routeType",rc."sourcePath") rc."changeType"
          FROM "RouteChange" rc JOIN "RunCommit" c ON c."id"=rc."runCommitId" AND c."runId"=rc."runId"
          WHERE rc."runId"=$1 ORDER BY rc."router",rc."route",rc."routeType",rc."sourcePath",c."sequence" DESC,rc."id" DESC) current_routes
          WHERE "changeType"='ADDED') AS "routeCount",
        (SELECT COUNT(*)::int FROM (SELECT DISTINCT ON (dc."manifestPath",dc."packageName",dc."dependencyGroup") dc."changeType"
          FROM "DependencyChange" dc JOIN "RunCommit" c ON c."id"=dc."runCommitId" AND c."runId"=dc."runId"
          WHERE dc."runId"=$1 ORDER BY dc."manifestPath",dc."packageName",dc."dependencyGroup",c."sequence" DESC,dc."id" DESC) current_dependencies
          WHERE "changeType" <> 'REMOVED') AS "dependencyCount",
        (SELECT COUNT(*)::int FROM "ProcessingWarning" WHERE "runId"=$1) AS "warningCount"
        ,(SELECT COALESCE(json_agg(json_build_object('code',w."code",'detector',w."detector",'path',w."path",'message',w."message",'detectorVersion',w."detectorVersion") ORDER BY w."createdAt",w."id"),'[]'::json) FROM "ProcessingWarning" w WHERE w."runId"=$1) AS "warnings"
        FROM "ProcessingRun" WHERE "id"=$1`,
      [row.activeRunId],
    );
    if (run.rows[0]) {
      const r = run.rows[0];
      activeSnapshot = {
        runId: r.id,
        rootSha: r.rootSha,
        headSha: r.headSha,
        firstParentCommitCount: r.commitCount,
        firstCommitAt: r.firstAt,
        lastCommitAt: r.lastAt,
        processedAt: r.activatedAt ?? r.completedAt,
        routeCount: r.routeCount,
        dependencyCount: r.dependencyCount,
        coverage: {
          status: r.warningCount > 0 ? "WARNINGS" : "COMPLETE",
          warnings: r.warnings,
        },
        versions: { schema: r.schemaVersion, classifier: r.classifierVersion, dependencyDetector: r.dependencyDetectorVersion, routeDetector: r.routeDetectorVersion },
      };
    }
  }
  const latestRun = await pool.query(`SELECT "id","status","kind" FROM "ProcessingRun" WHERE "repositoryId"=$1 ORDER BY "requestedAt" DESC LIMIT 1`, [repositoryId]);
  return NextResponse.json({
    data: {
      id: row.id,
      owner: row.owner,
      name: row.name,
      fullName: row.fullName,
      canonicalUrl: row.canonicalUrl,
      defaultBranch: row.defaultBranch,
      selectedAppRoot: row.selectedAppRoot,
      availability: row.availability,
      activeSnapshot,
      latestRun: latestRun.rows[0] ?? null,
    },
  });
}
