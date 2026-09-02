import { NextResponse } from "next/server";
import { getPool } from "@/server/db/client-pool";
import { retryFailedRun } from "@/server/jobs/repository";

export async function POST(_request: Request, { params }: { params: Promise<{ repositoryId: string; runId: string }> }) {
  try {
    const { repositoryId, runId } = await params;
    const result = await retryFailedRun(getPool(process.env.DATABASE_URL!), repositoryId, runId);
    if (result === "NOT_FOUND") return NextResponse.json({ error: { code: "RUN_NOT_FOUND", message: "Run not found." } }, { status: 404 });
    if (result === "NOT_RETRYABLE") return NextResponse.json({ error: { code: "RUN_NOT_RETRYABLE", message: "Only failed runs can be retried." } }, { status: 409 });
    if (result === "RUN_ALREADY_ACTIVE") return NextResponse.json({ error: { code: "RUN_ALREADY_ACTIVE", message: "Another run is already active for this repository." } }, { status: 409 });
    return NextResponse.json({ data: { repositoryId, runId, status: result } }, { status: 202 });
  } catch {
    return NextResponse.json({ error: { code: "SERVICE_UNAVAILABLE", message: "The run could not be queued for retry." } }, { status: 503 });
  }
}
