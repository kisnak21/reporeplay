import { z } from "zod";
import { apiEnvironment } from "@/server/api/environment";
import { getPool } from "@/server/db/client-pool";
import { createGitHubSourceFromEnvironment } from "@/server/github/client";
import { RepoReplayError } from "@/server/github/errors";
import { runPreflight } from "@/server/github/preflight";
import { enqueueRefreshRun } from "@/server/jobs/manual-refresh";
import { idempotentMutation } from "@/server/api/idempotency";
import { apiErrorResponse } from "@/server/api/responses";
import { consumeImportQuota, requestSubject } from "@/server/security/import-controls";

export async function POST(request: Request, { params }: { params: Promise<{ repositoryId: string }> }) {
  try {
    const repositoryId = z.uuid().parse((await params).repositoryId);
    const environment = apiEnvironment();
    return await idempotentMutation({
      pool: getPool(environment.DATABASE_URL), request, normalizedBody: {},
      retentionSeconds: environment.IDEMPOTENCY_RETENTION_SECONDS,
    }, async (client) => {
      const result = await client.query<{ owner: string; name: string; externalId: string; activeRunId: string | null; hasActiveRun: boolean }>(
        `SELECT repository."owner",repository."name",repository."externalId",repository."activeRunId",
           EXISTS(SELECT 1 FROM "ProcessingRun" run WHERE run."repositoryId"=repository."id"
             AND run."status" IN ('NEEDS_CONFIGURATION','QUEUED','RUNNING','WAITING_RATE_LIMIT','RETRYABLE')) AS "hasActiveRun"
         FROM "Repository" repository WHERE repository."id"=$1 AND repository."deletedAt" IS NULL`, [repositoryId],
      );
      const repository = result.rows[0];
      if (!repository) throw new RepoReplayError("REPOSITORY_NOT_FOUND", "Repository not found.");
      if (!repository.activeRunId) throw new RepoReplayError("RUN_NOT_CONFIGURABLE", "A completed snapshot is required before refresh.");
      if (repository.hasActiveRun) throw new RepoReplayError("RUN_ALREADY_ACTIVE", "Another run is already active for this repository.");
      await consumeImportQuota(client, {
        subjectHash: requestSubject(request, environment), maximum: environment.MAX_IMPORTS_PER_IP_WINDOW,
        windowSeconds: environment.IMPORT_IP_WINDOW_SECONDS,
      });
      const preflight = await runPreflight({
        source: createGitHubSourceFromEnvironment(environment), owner: repository.owner, name: repository.name,
        maxCommits: environment.MAX_FIRST_PARENT_COMMITS, maxFiles: environment.MAX_HEAD_FILES,
      });
      if (preflight.repository.externalId !== repository.externalId) {
        throw new RepoReplayError("REPOSITORY_NOT_FOUND", "The GitHub repository identity changed. Import its current canonical URL.");
      }
      const queued = await enqueueRefreshRun(client, {
        repositoryId, candidates: preflight.candidates, defaultBranch: preflight.repository.defaultBranch,
        headSha: preflight.headSha, expectedCommitCount: preflight.firstParentCommitCount,
        headFileCount: preflight.headFileCount, maxCommitLimit: environment.MAX_FIRST_PARENT_COMMITS,
        maxHeadFileLimit: environment.MAX_HEAD_FILES, maxPendingRuns: environment.MAX_GLOBAL_PENDING_RUNS,
      });
      if (queued.outcome === "NOT_FOUND") throw new RepoReplayError("REPOSITORY_NOT_FOUND", "Repository not found.");
      if (queued.outcome === "NO_ACTIVE_SNAPSHOT") throw new RepoReplayError("RUN_NOT_CONFIGURABLE", "A completed snapshot is required before refresh.");
      if (queued.outcome === "RUN_ALREADY_ACTIVE") throw new RepoReplayError("RUN_ALREADY_ACTIVE", "Another run is already active for this repository.");
      return { status: 202, body: { data: { repositoryId, run: {
        id: queued.runId, status: queued.outcome,
        ...(queued.outcome === "NEEDS_CONFIGURATION" ? { appRootCandidates: queued.appRootCandidates } : {}),
      } } } };
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
