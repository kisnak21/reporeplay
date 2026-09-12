import { z } from "zod";
import { apiEnvironment } from "@/server/api/environment";
import { getPool } from "@/server/db/client-pool";
import { configureRunAppRoot } from "@/server/jobs/manual-refresh";
import { idempotentMutation } from "@/server/api/idempotency";
import { apiErrorResponse } from "@/server/api/responses";
import { RepoReplayError } from "@/server/github/errors";

const bodySchema = z.object({ appRoot: z.string().min(1).max(4_096) }).strict();
const paramsSchema = z.object({ repositoryId: z.uuid(), runId: z.uuid() });

export async function PUT(request: Request, { params }: { params: Promise<{ repositoryId: string; runId: string }> }) {
  try {
    const { repositoryId, runId } = paramsSchema.parse(await params);
    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) throw new RepoReplayError("INVALID_APP_ROOT_SELECTION", "Select an application root before continuing.");
    const { appRoot } = parsed.data;
    const environment = apiEnvironment();
    return await idempotentMutation({
      pool: getPool(environment.DATABASE_URL), request, normalizedBody: parsed.data,
      retentionSeconds: environment.IDEMPOTENCY_RETENTION_SECONDS,
    }, async (client) => {
      const result = await configureRunAppRoot(client, repositoryId, runId, appRoot);
      if (result.outcome === "NOT_FOUND") throw new RepoReplayError("REPOSITORY_NOT_FOUND", "Repository not found.");
      if (result.outcome === "RUN_NOT_FOUND") throw new RepoReplayError("RUN_NOT_FOUND", "Run not found.");
      if (result.outcome === "RUN_NOT_CONFIGURABLE") throw new RepoReplayError("RUN_NOT_CONFIGURABLE", "This run no longer accepts application-root configuration.");
      if (result.outcome === "INVALID_APP_ROOT_SELECTION") throw new RepoReplayError("INVALID_APP_ROOT_SELECTION", "Select an application root discovered by this run's preflight.");
      return { status: 202, body: { data: { repositoryId, runId, status: "QUEUED", selectedAppRoot: appRoot } } };
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
