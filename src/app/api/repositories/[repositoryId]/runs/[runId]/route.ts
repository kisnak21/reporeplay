import { NextResponse } from "next/server";
import { getPool } from "@/server/db/client-pool";

export async function GET(_request: Request, { params }: { params: Promise<{ repositoryId: string; runId: string }> }) {
  const { repositoryId, runId } = await params;
  const pool = getPool(process.env.DATABASE_URL!);
  const run = await pool.query(`SELECT "id","status","currentStep","checkpointSequence","processedCommitCount","errorCode","errorMessage" FROM "ProcessingRun" WHERE "id"=$1 AND "repositoryId"=$2`, [runId, repositoryId]);
  if (!run.rows[0]) return NextResponse.json({ error: { code: "RUN_NOT_FOUND", message: "Run not found." } }, { status: 404 });
  return NextResponse.json({ data: run.rows[0] });
}
