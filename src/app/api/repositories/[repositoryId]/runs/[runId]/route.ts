import { NextResponse } from "next/server";
import { getPool } from "@/server/db/client-pool";
import { getWorkerLiveness } from "@/server/jobs/repository";

export async function GET(_request: Request, { params }: { params: Promise<{ repositoryId: string; runId: string }> }) {
  const { repositoryId, runId } = await params;
  const pool = getPool(process.env.DATABASE_URL!);
  const run = await pool.query(`SELECT r."id",r."kind",r."status",r."currentStep",r."fetchedCommitCount",r."processedCommitCount",r."expectedCommitCount",r."errorCode",r."errorMessage",j."attemptCount",j."nextAttemptAt" FROM "ProcessingRun" r LEFT JOIN "ProcessingJob" j ON j."runId"=r."id" WHERE r."id"=$1 AND r."repositoryId"=$2`, [runId, repositoryId]);
  if (!run.rows[0]) return NextResponse.json({ error: { code: "RUN_NOT_FOUND", message: "Run not found." } }, { status: 404 });
  const row = run.rows[0];
  const [warnings, appRootCandidates, worker] = await Promise.all([
    pool.query(`SELECT "code","detector","path","message","detectorVersion" FROM "ProcessingWarning" WHERE "runId"=$1 ORDER BY "createdAt","id"`, [runId]),
    pool.query<{ path: string; manifestPath: string; routeRoots: string[] }>(
      `SELECT "path","evidenceManifestPath" AS "manifestPath","routeRoots"
       FROM "RunAppRootCandidate"
       WHERE "runId"=$1
       ORDER BY "path"`,
      [runId],
    ),
    getWorkerLiveness(pool),
  ]);
  return NextResponse.json({
    data: {
      id: row.id,
      kind: row.kind,
      status: row.status,
      step: row.currentStep,
      fetchedCommits: row.fetchedCommitCount,
      processedCommits: row.processedCommitCount,
      expectedCommits: row.expectedCommitCount,
      worker: { status: worker.status, lastHeartbeatAt: worker.lastHeartbeatAt?.toISOString() ?? null, heartbeatAgeSeconds: worker.heartbeatAgeSeconds },
      attemptCount: row.attemptCount ?? 0,
      nextAttemptAt: row.nextAttemptAt,
      appRootCandidates: appRootCandidates.rows,
      warnings: warnings.rows,
      error: row.errorCode ? { code: row.errorCode, message: row.errorMessage } : null,
    },
  });
}
