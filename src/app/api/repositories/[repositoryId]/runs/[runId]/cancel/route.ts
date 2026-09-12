import { z } from "zod";
import { apiEnvironment } from "@/server/api/environment";
import { getPool } from "@/server/db/client-pool";
import { requestCancellation } from "@/server/jobs/repository";
import { idempotentMutation } from "@/server/api/idempotency";
import { apiErrorResponse } from "@/server/api/responses";
import { RepoReplayError } from "@/server/github/errors";

const paramsSchema = z.object({ repositoryId: z.uuid(), runId: z.uuid() });

export async function POST(request: Request, { params }: { params: Promise<{ repositoryId: string; runId: string }> }) {
  try {
    const { repositoryId, runId } = paramsSchema.parse(await params);
    const environment = apiEnvironment();
    return await idempotentMutation({
      pool: getPool(environment.DATABASE_URL), request, normalizedBody: {},
      retentionSeconds: environment.IDEMPOTENCY_RETENTION_SECONDS,
    }, async (client) => {
      const job = await client.query<{ id: string }>(
        `SELECT j."id" FROM "ProcessingJob" j JOIN "ProcessingRun" r ON r."id"=j."runId" WHERE j."runId"=$1 AND r."repositoryId"=$2`, [runId, repositoryId],
      );
      if (!job.rows[0]) {
        const cancelled = await client.query(
          `UPDATE "ProcessingRun" SET "status"='CANCELLED',"completedAt"=CURRENT_TIMESTAMP
           WHERE "id"=$1 AND "repositoryId"=$2 AND "status"='NEEDS_CONFIGURATION' RETURNING "id"`, [runId, repositoryId],
        );
        if (!cancelled.rowCount) throw new RepoReplayError("RUN_NOT_FOUND", "No cancellable run was found.");
        return { status: 200, body: { data: { runId, status: "CANCELLED" } } };
      }
      const result = await requestCancellation(client, job.rows[0].id);
      if (result === "NOT_FOUND") throw new RepoReplayError("RUN_NOT_CONFIGURABLE", "This run cannot be cancelled in its current state.");
      return { status: result === "REQUESTED" ? 202 : 200, body: { data: { runId, status: result } } };
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
