# Operations runbook

This document describes the worker and health signals implemented in this repository. Production hosting, alert delivery, backups, and recovery drills have not been provisioned or exercised yet.

## Health signals

`GET /api/health` returns `200` when the web process can query PostgreSQL and `503` when it cannot. It does not report worker health.

`GET /api/admin/health/worker` requires `Authorization: Bearer <ADMIN_HEALTH_TOKEN>`. Keep the token in the monitor's secret store and never include it in request logs. Poll this endpoint from a protected monitor and alert on `OFFLINE` or `DEGRADED`.

The protected response includes `heartbeatTimeoutSeconds`, `queueLagWarnSeconds`, worker heartbeat and active-job data, and queue counts. `OFFLINE` means no worker heartbeat is within the timeout. `DEGRADED` means at least one worker is live, but a lease has expired or the oldest due job is older than `QUEUE_LAG_WARN_SECONDS`. `HEALTHY` means a worker is live and neither queue condition is present. Defaults are a 120-second heartbeat timeout (twice the 60-second lease) and a 60-second queue-lag warning.

## Worker logs

The worker writes one JSON object per line to stdout; error-level lines go to stderr. Every record contains `timestamp`, `level`, `service`, and `event`. Job events may also include `workerId`, `jobId`, `runId`, `leaseGeneration`, `attemptCount`, `maxAttempts`, `errorCode`, `errorType`, `resultStatus`, or `nextAttemptAt`.

Events include `worker.ready`, `worker.shutdown_requested`, `worker.shutdown_started`, `worker.shutdown_complete`, `worker.job.claimed`, `worker.job.succeeded`, `worker.job.cancelled`, `worker.job.error`, `worker.job.retry_scheduled`, `worker.job.rate_limited`, `worker.job.failed`, `worker.job.lease_lost`, `worker.sweep_failed`, and `worker.startup_failed`. Error messages and GitHub response bodies are omitted from logs; correlate by `jobId` or `runId` and inspect the authorized run status for persisted diagnostics.

## Recovery procedures

**Worker interruption or expired lease:** Check worker heartbeat and `worker.shutdown_*` logs, then inspect the process manager and worker database connectivity. Do not edit job or lease rows by hand. After `leaseExpiresAt`, the sweeper recovers the job on its next pass; the job becomes retryable unless cancellation was requested or its attempt limit is exhausted. The replacement worker resumes from the persisted run checkpoint. Confirm run status and progress in the processing view, and confirm heartbeat and queue state through the protected health endpoint.

**Queue lag or stuck work:** Check `queue.dueJobs`, `queue.expiredJobs`, `queue.oldestDueSeconds`, and the configured lag threshold. Compare live workers' `activeJobCount`, then search structured logs by job ID for claim, retry, lease-loss, and success events. Restore worker capacity or database connectivity before increasing concurrency; `MAX_GLOBAL_RUNNING_JOBS` remains the system-wide cap. Avoid duplicate imports or manual queue updates.

**GitHub rate limit:** A rate-limited job remains in `WAITING_RATE_LIMIT` with a recorded `nextAttemptAt`. Check `worker.job.rate_limited` and the run state, then let the worker retry after that time. Do not bypass the reset time with a new import.

**Refresh failure or activation rollback:** A failed refresh leaves the previous snapshot active. Activation of a completed run is transactional; if an activation write fails, the prior active snapshot remains selected. Inspect `worker.job.error` and the run's persisted error code, then use the normal retry flow when the run is retryable. Never switch `activeRunId` manually.

**Permanent deletion:** Use the protected repository deletion endpoint. It fences active leases and removes related run data transactionally. Do not delete repository rows directly in SQL.

## Current operating defaults

Defaults in `.env.example` include a 60-second lease, 15-second heartbeat, 5-second recovery sweep, 1-second worker poll, worker concurrency of 2, global running-job cap of 4, queue-lag warning at 60 seconds, and 30-second graceful shutdown. Validate these values against the database and hosting limits before deployment.

Database integration tests cover lease recovery, checkpoint preservation, activation rollback, and protected deletion. They require a configured test PostgreSQL database and have not been run as a production recovery drill. Production monitoring, backup/restore procedures, and deployment-specific commands still need to be supplied by the hosting environment.
