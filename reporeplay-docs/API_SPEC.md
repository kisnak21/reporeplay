# RepoReplay REST API Specification

## 1. Conventions

Base path: `/api`

Success:

```json
{ "data": {} }
```

Error:

```json
{
  "error": {
    "code": "UNSUPPORTED_REPOSITORY",
    "message": "No supported Next.js application was found.",
    "details": {}
  }
}
```

All request bodies, path parameters, query parameters, GitHub responses, and environment values are validated. Imported text is returned as data, never executable markup.

Mutating endpoints support an `Idempotency-Key` header. Replaying the same key and normalized request returns the original result for the configured retention period.

## 2. Public Limits

```http
GET /api/config/limits
```

```json
{
  "data": {
    "maxFirstParentCommits": 500,
    "maxHeadFiles": 25000,
    "timelineDefaultLimit": 30,
    "timelineMaxLimit": 100
  }
}
```

## 3. Import Preflight

```http
POST /api/repositories/preflight
```

Request:

```json
{ "url": "https://github.com/owner/repository" }
```

Single app root:

```json
{
  "data": {
    "repository": {
      "externalId": "github-id",
      "fullName": "owner/repository",
      "defaultBranch": "main",
      "headSha": "full-sha"
    },
    "firstParentCommitCount": 184,
    "headFileCount": 3210,
    "appRootCandidates": [
      {
        "path": ".",
        "manifestPath": "package.json",
        "routeRoots": ["src/app"]
      }
    ],
    "limits": {
      "maxFirstParentCommits": 500,
      "maxHeadFiles": 25000
    }
  }
}
```

Preflight does not create a processing run. It returns a short-lived signed `preflightToken` in the real response; the token binds canonical repository ID, head SHA, counts, candidates, limits, and expiry so import does not trust client-supplied discovery data.

Errors:

```text
400 INVALID_REPOSITORY_URL
403 REPOSITORY_NOT_PUBLIC
404 REPOSITORY_NOT_FOUND
409 EMPTY_REPOSITORY
422 UNSUPPORTED_REPOSITORY
422 REPOSITORY_LIMIT_EXCEEDED
502 GITHUB_DATA_TRUNCATED
503 GITHUB_UNAVAILABLE
429 IMPORT_RATE_LIMITED
429 GITHUB_RATE_LIMITED
```

`REPOSITORY_LIMIT_EXCEEDED.details` identifies the actual and allowed values.

## 4. Create or Reuse Import

```http
POST /api/repositories
Idempotency-Key: <opaque-value>
```

Request:

```json
{
  "preflightToken": "signed-token",
  "appRoot": "."
}
```

When one app root exists, `appRoot` may be omitted. When several exist, omitting it creates a configuration-required run.

Queued response, `202 Accepted`:

```json
{
  "data": {
    "repositoryId": "uuid",
    "availability": "PROCESSING",
    "run": {
      "id": "uuid",
      "status": "QUEUED"
    }
  }
}
```

Configuration response, `202 Accepted`:

```json
{
  "data": {
    "repositoryId": "uuid",
    "availability": "CONFIGURATION_REQUIRED",
    "run": {
      "id": "uuid",
      "status": "NEEDS_CONFIGURATION",
      "appRootCandidates": []
    }
  }
}
```

If a ready repository already exists and no refresh was requested, return `200 OK` with its active snapshot. If a nonterminal run exists, return it rather than creating another.

## 5. Configure App Root

```http
PUT /api/repositories/:repositoryId/runs/:runId/configuration
Idempotency-Key: <opaque-value>
```

```json
{ "appRoot": "apps/web" }
```

Only a candidate discovered by the run's preflight may be selected. Success returns `202 Accepted` with `status: QUEUED`.

Errors:

```text
404 REPOSITORY_NOT_FOUND
404 RUN_NOT_FOUND
409 RUN_NOT_CONFIGURABLE
422 INVALID_APP_ROOT_SELECTION
```

## 6. Repository Detail

```http
GET /api/repositories/:repositoryId
```

```json
{
  "data": {
    "id": "uuid",
    "owner": "owner",
    "name": "repository",
    "description": "...",
    "canonicalUrl": "https://github.com/owner/repository",
    "primaryLanguage": "TypeScript",
    "stars": 42,
    "defaultBranch": "main",
    "selectedAppRoot": ".",
    "availability": "READY",
    "activeSnapshot": {
      "runId": "uuid",
      "rootSha": "full-sha",
      "headSha": "full-sha",
      "firstParentCommitCount": 184,
      "firstCommitAt": "2024-01-01T00:00:00Z",
      "lastCommitAt": "2026-08-31T00:00:00Z",
      "processedAt": "2026-08-31T01:00:00Z",
      "routeCount": 18,
      "dependencyCount": 37,
      "versions": {
        "schema": "1",
        "classifier": "1",
        "dependencyDetector": "1",
        "routeDetector": "1"
      },
      "coverage": {
        "status": "WARNINGS",
        "warnings": []
      }
    },
    "latestRun": {
      "id": "uuid",
      "kind": "REFRESH",
      "status": "FAILED",
      "error": {
        "code": "GITHUB_UNAVAILABLE",
        "message": "Refresh could not reach GitHub. The previous snapshot remains available."
      }
    }
  }
}
```

`activeSnapshot` is null until first activation. `latestRun` is independent of repository availability.

## 7. Run Status

```http
GET /api/repositories/:repositoryId/runs/:runId
```

```json
{
  "data": {
    "id": "uuid",
    "kind": "IMPORT",
    "status": "RUNNING",
    "step": "FETCH_COMMITS",
    "processedCommits": 72,
    "expectedCommits": 184,
    "attemptCount": 2,
    "nextAttemptAt": null,
    "warnings": [],
    "error": null
  }
}
```

Clients poll this endpoint with bounded backoff. Exact percentages are not promised.

## 8. Timeline

```http
GET /api/repositories/:repositoryId/commits
```

Query parameters:

```text
cursor=<opaque cursor>
limit=30
category=FEATURE
path=src/app
query=authentication
from=2026-01-01T00:00:00Z
to=2026-08-31T23:59:59Z
event=ROUTE|DEPENDENCY
```

```json
{
  "data": {
    "snapshot": {
      "runId": "uuid",
      "headSha": "full-sha"
    },
    "items": [
      {
        "sha": "full-sha",
        "shortSha": "abc1234",
        "message": "feat: add account page",
        "authorName": "Developer",
        "committedAt": "2026-08-31T00:00:00Z",
        "statistics": {
          "changedFiles": 4,
          "additions": 90,
          "deletions": 12
        },
        "category": "FEATURE",
        "eventSummary": {
          "routesAdded": 1,
          "routesRemoved": 0,
          "dependenciesAdded": 0,
          "dependenciesRemoved": 0,
          "dependenciesUpdated": 1
        },
        "warnings": []
      }
    ],
    "pageInfo": {
      "nextCursor": "opaque-or-null",
      "hasNextPage": true
    }
  }
}
```

Cursors bind the active run and sequence. If activation changed since cursor creation:

```text
409 CURSOR_SNAPSHOT_MISMATCH
```

The client restarts pagination while preserving filters.

## 9. Commit Evidence

```http
GET /api/repositories/:repositoryId/commits/:sha
```

```json
{
  "data": {
    "snapshot": {
      "runId": "uuid",
      "headSha": "full-sha"
    },
    "sha": "full-sha",
    "firstParentSha": "full-parent-sha",
    "message": "feat: add account page",
    "authorName": "Developer",
    "authoredAt": "2026-08-31T00:00:00Z",
    "committedAt": "2026-08-31T00:00:00Z",
    "externalUrl": "https://github.com/owner/repository/commit/full-sha",
    "statistics": {
      "changedFiles": 4,
      "additions": 90,
      "deletions": 12
    },
    "category": {
      "value": "FEATURE",
      "source": "CONVENTIONAL_COMMIT"
    },
    "files": [],
    "dependencyChanges": [],
    "routeChanges": [],
    "warnings": []
  }
}
```

The SHA must belong to the active run.

## 10. Manual Refresh

```http
POST /api/repositories/:repositoryId/refresh
Idempotency-Key: <opaque-value>
```

The server performs current preflight. Success returns `202 Accepted` with a staged run. Existing active data remains readable.

Conflicts:

```text
409 RUN_ALREADY_ACTIVE
409 CONFIGURATION_REQUIRED
422 REPOSITORY_LIMIT_EXCEEDED
422 UNSUPPORTED_REPOSITORY
```

If root selection becomes ambiguous, the refresh run enters `NEEDS_CONFIGURATION` without altering the repository's current selection or active snapshot.

## 11. Retry and Cancel

```http
POST /api/repositories/:repositoryId/runs/:runId/retry
POST /api/repositories/:repositoryId/runs/:runId/cancel
```

Retry accepts only `FAILED` runs. It locks the repository, run, and job in one transaction, resets the run and job errors, clears the old lease, preserves the same staged run data, and enqueues the same job with `202 Accepted`. A second concurrent retry cannot create another job. Cancel is cooperative for running work and immediate for queued work.

Successful retry returns `{ data: { repositoryId, runId, status: "QUEUED" } }`. A missing run returns `404 RUN_NOT_FOUND`; a run in another state returns `409 RUN_NOT_RETRYABLE`; another active run returns `409 RUN_ALREADY_ACTIVE`.

## 12. Protected Deletion

```http
DELETE /api/admin/repositories/:repositoryId
```

Requires administrative authorization. The operation requests cancellation, invalidates future lease writes, and permanently deletes all repository data. Return `202 Accepted` if asynchronous cleanup is needed.

## 13. Health

```http
GET /api/health
GET /api/admin/health/worker
```

Public health discloses only service availability. Protected worker health may include queue lag, last heartbeat, and dependency status without secrets.

`GET /api/health` returns `200` with `{ data: { status: "ok", checks: { database: "ok" } } }` when the web process can reach PostgreSQL, and returns `503 SERVICE_UNAVAILABLE` otherwise.

`GET /api/admin/health/worker` requires `Authorization: Bearer <ADMIN_HEALTH_TOKEN>`. If `ADMIN_HEALTH_TOKEN` is unset, or the presented token is missing or invalid, it returns `401 ADMIN_UNAUTHORIZED`. An authorized response contains `HEALTHY`, `DEGRADED`, or `OFFLINE` status, heartbeat timeout, worker rows, active job counts, and queue due/expired/oldest-lag metrics. It returns `503 SERVICE_UNAVAILABLE` when environment validation or the health query cannot complete.

## 14. Error Codes

```text
INVALID_REPOSITORY_URL
REPOSITORY_NOT_FOUND
REPOSITORY_NOT_PUBLIC
EMPTY_REPOSITORY
UNSUPPORTED_REPOSITORY
REPOSITORY_LIMIT_EXCEEDED
GITHUB_DATA_TRUNCATED
GITHUB_RATE_LIMITED
GITHUB_UNAVAILABLE
IMPORT_RATE_LIMITED
CONFIGURATION_REQUIRED
INVALID_APP_ROOT_SELECTION
RUN_NOT_FOUND
RUN_NOT_CONFIGURABLE
RUN_ALREADY_ACTIVE
RUN_NOT_RETRYABLE
CURSOR_INVALID
CURSOR_SNAPSHOT_MISMATCH
PROCESSING_FAILED
ADMIN_UNAUTHORIZED
SERVICE_UNAVAILABLE
```

HTTP status reflects validation, authorization, conflict, rate, upstream, or internal failure. Messages remain actionable and sanitized.

## 15. Excluded Endpoints

MVP exposes no comparison, architecture, analytics, contributor, milestone, AI-summary, or private-repository endpoints.
