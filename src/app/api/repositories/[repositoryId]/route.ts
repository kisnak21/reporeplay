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
      `SELECT "id","rootSha","headSha","headFileCount","maxCommitLimit","maxHeadFileLimit","schemaVersion","classifierVersion","dependencyDetectorVersion","routeDetectorVersion","completedAt","activatedAt", (SELECT COUNT(*)::int FROM "RunCommit" WHERE "runId"=$1) as "commitCount", (SELECT MIN("committedAt") FROM "RunCommit" WHERE "runId"=$1) as "firstAt", (SELECT MAX("committedAt") FROM "RunCommit" WHERE "runId"=$1) as "lastAt" FROM "ProcessingRun" WHERE "id"=$1`,
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
        routeCount: 0,
        dependencyCount: 0,
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
