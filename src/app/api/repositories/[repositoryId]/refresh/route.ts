import { NextResponse } from "next/server";
import { parseEnvironment } from "@/lib/environment";
import { getPool } from "@/server/db/client-pool";
import { createGitHubSourceFromEnvironment } from "@/server/github/client";
import { RepoReplayError } from "@/server/github/errors";
import { runPreflight } from "@/server/github/preflight";
import { enqueueRefreshRun } from "@/server/jobs/manual-refresh";

interface RefreshRepositoryRow {
  owner: string;
  name: string;
  activeRunId: string | null;
  hasActiveRun: boolean;
}

function statusForCode(code: string): number {
  switch (code) {
    case "REPOSITORY_NOT_FOUND":
      return 404;
    case "REPOSITORY_NOT_PUBLIC":
      return 403;
    case "EMPTY_REPOSITORY":
    case "CONFIGURATION_REQUIRED":
    case "RUN_ALREADY_ACTIVE":
    case "RUN_NOT_CONFIGURABLE":
      return 409;
    case "UNSUPPORTED_REPOSITORY":
    case "REPOSITORY_LIMIT_EXCEEDED":
      return 422;
    case "GITHUB_RATE_LIMITED":
      return 429;
    case "GITHUB_DATA_TRUNCATED":
      return 502;
    default:
      return 500;
  }
}

function errorResponse(code: string, message: string, status = statusForCode(code), details?: Record<string, unknown>) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ repositoryId: string }> },
) {
  try {
    const { repositoryId } = await params;
    const environment = parseEnvironment(process.env);
    const pool = getPool(environment.DATABASE_URL);
    const repositoryResult = await pool.query<RefreshRepositoryRow>(
      `SELECT repository."owner",repository."name",repository."activeRunId",
         EXISTS(
           SELECT 1 FROM "ProcessingRun" run
           WHERE run."repositoryId"=repository."id"
             AND run."status" IN ('NEEDS_CONFIGURATION','QUEUED','RUNNING','WAITING_RATE_LIMIT','RETRYABLE')
         ) AS "hasActiveRun"
       FROM "Repository" repository
       WHERE repository."id"=$1 AND repository."deletedAt" IS NULL`,
      [repositoryId],
    );
    const repository = repositoryResult.rows[0];

    if (!repository) return errorResponse("REPOSITORY_NOT_FOUND", "Repository not found.");
    if (!repository.activeRunId) {
      return errorResponse("RUN_NOT_CONFIGURABLE", "A completed snapshot is required before this repository can be refreshed.");
    }
    if (repository.hasActiveRun) {
      return errorResponse("RUN_ALREADY_ACTIVE", "Another run is already active for this repository.");
    }

    const source = createGitHubSourceFromEnvironment(environment);
    const preflight = await runPreflight({
      source,
      owner: repository.owner,
      name: repository.name,
      maxCommits: environment.MAX_FIRST_PARENT_COMMITS,
      maxFiles: environment.MAX_HEAD_FILES,
    });
    const result = await enqueueRefreshRun(pool, {
      repositoryId,
      candidates: preflight.candidates,
      defaultBranch: preflight.repository.defaultBranch,
      headSha: preflight.headSha,
      expectedCommitCount: preflight.firstParentCommitCount,
      headFileCount: preflight.headFileCount,
      maxCommitLimit: environment.MAX_FIRST_PARENT_COMMITS,
      maxHeadFileLimit: environment.MAX_HEAD_FILES,
    });

    switch (result.outcome) {
      case "QUEUED":
        return NextResponse.json(
          { data: { repositoryId, run: { id: result.runId, status: result.outcome } } },
          { status: 202 },
        );
      case "NEEDS_CONFIGURATION":
        return NextResponse.json(
          {
            data: {
              repositoryId,
              run: {
                id: result.runId,
                status: result.outcome,
                appRootCandidates: result.appRootCandidates,
              },
            },
          },
          { status: 202 },
        );
      case "NOT_FOUND":
        return errorResponse("REPOSITORY_NOT_FOUND", "Repository not found.");
      case "NO_ACTIVE_SNAPSHOT":
        return errorResponse("RUN_NOT_CONFIGURABLE", "A completed snapshot is required before this repository can be refreshed.");
      case "RUN_ALREADY_ACTIVE":
        return errorResponse("RUN_ALREADY_ACTIVE", "Another run is already active for this repository.");
    }
  } catch (error) {
    if (error instanceof RepoReplayError) {
      return errorResponse(error.code, error.message, statusForCode(error.code), error.details);
    }
    return errorResponse("SERVICE_UNAVAILABLE", "The repository could not be queued for refresh.", 503);
  }
}
