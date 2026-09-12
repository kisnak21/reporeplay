import { z } from "zod";
import { apiEnvironment } from "@/server/api/environment";
import { getPool } from "@/server/db/client-pool";
import { apiErrorResponse } from "@/server/api/responses";
import { idempotentMutation } from "@/server/api/idempotency";
import { createOrReuseImport } from "@/server/jobs/import-repository";
import { consumeImportQuota, requestSubject } from "@/server/security/import-controls";
import { signingSecret, verifyPreflightToken } from "@/server/security/preflight-token";
import { RepoReplayError } from "@/server/github/errors";

const bodySchema = z.object({ preflightToken: z.string().min(1).max(500_000), appRoot: z.string().min(1).optional() }).strict();

export async function POST(request: Request) {
  try {
    const environment = apiEnvironment();
    const body = bodySchema.parse(await request.json());
    return await idempotentMutation({
      pool: getPool(environment.DATABASE_URL), request, normalizedBody: body,
      retentionSeconds: environment.IDEMPOTENCY_RETENTION_SECONDS,
    }, async (client) => {
      const evidence = verifyPreflightToken(body.preflightToken, { secret: signingSecret(environment) });
      if (evidence.firstParentCommitCount > environment.MAX_FIRST_PARENT_COMMITS || evidence.headFileCount > environment.MAX_HEAD_FILES) {
        throw new RepoReplayError("REPOSITORY_LIMIT_EXCEEDED", "Processing limits changed. Run preflight again.");
      }
      await consumeImportQuota(client, {
        subjectHash: requestSubject(request, environment), maximum: environment.MAX_IMPORTS_PER_IP_WINDOW,
        windowSeconds: environment.IMPORT_IP_WINDOW_SECONDS,
      });
      return createOrReuseImport(client, { evidence, appRoot: body.appRoot, maxPendingRuns: environment.MAX_GLOBAL_PENDING_RUNS });
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
