import { NextResponse } from "next/server";
import { parseEnvironment } from "@/lib/environment";
import { getPool } from "@/server/db/client-pool";
import { getWorkerHealth } from "@/server/jobs/repository";
import { hasAdminBearerToken } from "@/server/security/admin-auth";

export async function GET(request: Request) {
  try {
    const environment = parseEnvironment(process.env);
    if (!hasAdminBearerToken(request, environment.ADMIN_HEALTH_TOKEN)) {
      return NextResponse.json({ error: { code: "ADMIN_UNAUTHORIZED", message: "Administrative authorization is required." } }, { status: 401, headers: { "WWW-Authenticate": "Bearer" } });
    }

    const health = await getWorkerHealth(getPool(environment.DATABASE_URL), environment.JOB_LEASE_SECONDS * 2, environment.QUEUE_LAG_WARN_SECONDS);
    return NextResponse.json({
      data: {
        status: health.status,
        checkedAt: health.checkedAt,
        heartbeatTimeoutSeconds: health.heartbeatTimeoutSeconds,
        workers: health.workers.map((worker) => ({ ...worker, lastHeartbeatAt: worker.lastHeartbeatAt.toISOString(), lastClaimAt: worker.lastClaimAt?.toISOString() ?? null, lastSuccessAt: worker.lastSuccessAt?.toISOString() ?? null })),
        queue: health.queue,
      },
    });
  } catch {
    return NextResponse.json({ error: { code: "SERVICE_UNAVAILABLE", message: "Worker health is temporarily unavailable." } }, { status: 503 });
  }
}
