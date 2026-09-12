import { NextResponse } from "next/server";
import { z } from "zod";
import { RepoReplayError } from "@/server/github/errors";
import type { ErrorCode } from "@/server/contracts/errors";

const errorStatuses: Partial<Record<ErrorCode, number>> = {
  INVALID_REQUEST: 400, INVALID_REPOSITORY_URL: 400, PREFLIGHT_TOKEN_INVALID: 400,
  PREFLIGHT_TOKEN_EXPIRED: 409, IDEMPOTENCY_KEY_INVALID: 400, IDEMPOTENCY_KEY_CONFLICT: 409,
  REPOSITORY_NOT_FOUND: 404, RUN_NOT_FOUND: 404, REPOSITORY_NOT_PUBLIC: 403,
  EMPTY_REPOSITORY: 409, UNSUPPORTED_REPOSITORY: 422, REPOSITORY_LIMIT_EXCEEDED: 422,
  INVALID_APP_ROOT_SELECTION: 422, RUN_ALREADY_ACTIVE: 409, RUN_NOT_CONFIGURABLE: 409,
  RUN_NOT_RETRYABLE: 409, CONFIGURATION_REQUIRED: 409, IMPORT_RATE_LIMITED: 429,
  GLOBAL_RUN_LIMITED: 429, GITHUB_RATE_LIMITED: 429, GITHUB_DATA_TRUNCATED: 502,
  GITHUB_UNAVAILABLE: 503, SERVICE_UNAVAILABLE: 503,
};

export function apiErrorResponse(error: unknown): NextResponse {
  if (error instanceof RepoReplayError) {
    const retryAfter = error.details.retryAfterSeconds;
    return NextResponse.json({ error: { code: error.code, message: error.message, details: error.details } }, {
      status: errorStatuses[error.code] ?? 500,
      headers: typeof retryAfter === "number" ? { "Retry-After": String(retryAfter) } : undefined,
    });
  }
  if (error instanceof z.ZodError || error instanceof SyntaxError) {
    return NextResponse.json({ error: { code: "INVALID_REQUEST", message: "The request contains invalid values." } }, { status: 400 });
  }
  return NextResponse.json({ error: { code: "SERVICE_UNAVAILABLE", message: "The request could not be completed. Try again." } }, { status: 503 });
}
