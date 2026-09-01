import { NextResponse } from "next/server";
import { getPool } from "@/server/db/client-pool";
import { requestCancellation } from "@/server/jobs/repository";

export async function POST(_request: Request, { params }: { params: Promise<{ repositoryId: string; runId: string }> }) {
  const { repositoryId, runId } = await params;
  const pool = getPool(process.env.DATABASE_URL!);
  const job = await pool.query<{ id: string }>(`SELECT j."id" FROM "ProcessingJob" j JOIN "ProcessingRun" r ON r."id"=j."runId" WHERE j."runId"=$1 AND r."repositoryId"=$2`, [runId, repositoryId]);
  if (!job.rows[0]) return NextResponse.json({ error: { code: "RUN_NOT_FOUND", message: "Run not found." } }, { status: 404 });

  const result = await requestCancellation(pool, job.rows[0].id);
  if (result === "NOT_FOUND") return NextResponse.json({ error: { code: "RUN_NOT_CONFIGURABLE", message: "This run cannot be cancelled in its current state." } }, { status: 409 });
  return NextResponse.json({ data: { runId, status: result } }, { status: result === "REQUESTED" ? 202 : 200 });
}
