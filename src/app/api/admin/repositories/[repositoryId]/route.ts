import { z } from "zod";
import { apiEnvironment } from "@/server/api/environment";
import { idempotentMutation } from "@/server/api/idempotency";
import { apiErrorResponse } from "@/server/api/responses";
import { getPool } from "@/server/db/client-pool";
import { RepoReplayError } from "@/server/github/errors";
import { permanentlyDeleteRepository } from "@/server/jobs/permanent-deletion";
import { hasAdminBearerToken } from "@/server/security/admin-auth";

export async function DELETE(request: Request, { params }: { params: Promise<{ repositoryId: string }> }) {
  try {
    const environment = apiEnvironment();
    if (!hasAdminBearerToken(request, environment.ADMIN_HEALTH_TOKEN)) {
      throw new RepoReplayError("ADMIN_UNAUTHORIZED", "Administrative authorization is required.");
    }

    const repositoryId = z.uuid().parse((await params).repositoryId);
    return await idempotentMutation({
      pool: getPool(environment.DATABASE_URL),
      request,
      normalizedBody: {},
      retentionSeconds: environment.IDEMPOTENCY_RETENTION_SECONDS,
    }, async (client) => {
      const deleted = await permanentlyDeleteRepository(client, repositoryId);
      if (!deleted) throw new RepoReplayError("REPOSITORY_NOT_FOUND", "Repository not found.");
      return { status: 200, body: { data: { repositoryId, deleted: true } } };
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
