import { z } from "zod";
import { apiEnvironment } from "@/server/api/environment";
import { getPool } from "@/server/db/client-pool";
import { retryFailedRun } from "@/server/jobs/repository";
import { idempotentMutation } from "@/server/api/idempotency";
import { apiErrorResponse } from "@/server/api/responses";
import { RepoReplayError } from "@/server/github/errors";
import { consumeImportQuota, requestSubject } from "@/server/security/import-controls";

const paramsSchema = z.object({ repositoryId: z.uuid(), runId: z.uuid() });

export async function POST(request: Request, { params }: { params: Promise<{ repositoryId: string; runId: string }> }) {
  try {
    const { repositoryId, runId } = paramsSchema.parse(await params);
    const environment = apiEnvironment();
    return await idempotentMutation({
      pool: getPool(environment.DATABASE_URL), request, normalizedBody: {},
      retentionSeconds: environment.IDEMPOTENCY_RETENTION_SECONDS,
    }, async (client) => {
      await consumeImportQuota(client, {
        subjectHash: requestSubject(request, environment), maximum: environment.MAX_IMPORTS_PER_IP_WINDOW,
        windowSeconds: environment.IMPORT_IP_WINDOW_SECONDS,
      });
      const result = await retryFailedRun(client, repositoryId, { runId, maxPendingRuns: environment.MAX_GLOBAL_PENDING_RUNS });
      if (result === "NOT_FOUND") throw new RepoReplayError("RUN_NOT_FOUND", "Run not found.");
      if (result === "NOT_RETRYABLE") throw new RepoReplayError("RUN_NOT_RETRYABLE", "Only failed runs can be retried.");
      if (result === "RUN_ALREADY_ACTIVE") throw new RepoReplayError("RUN_ALREADY_ACTIVE", "Another run is already active for this repository.");
      return { status: 202, body: { data: { repositoryId, runId, status: result } } };
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
