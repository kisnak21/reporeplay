# RepoReplay System Architecture

## 1. Goals

The architecture must provide complete, reproducible first-parent processing for supported repositories, keep HTTP requests short, recover from worker interruption, preserve the last successful snapshot, and expose evidence quickly from PostgreSQL.

## 2. Topology

```text
Browser
  |
  v
Next.js web and REST API
  |
  +--------------------> PostgreSQL <--------------------+
  |                         ^                            |
  |                         | claim, heartbeat, stage    |
  |                         |                            |
  +-- preflight metadata --> GitHub REST API <--- Worker+
                                  via GitHub App
```

Deploy two independently restartable processes:

- **web:** pages, validation, preflight orchestration, read APIs, job creation, protected administration;
- **worker:** job claims, GitHub ingestion, detectors, checkpointing, activation, retention cleanup.

The web process never performs history ingestion after returning an import or refresh response.

## 3. Boundaries

### Web/API

- validate and normalize GitHub URLs;
- enforce IP throttles;
- perform bounded preflight operations;
- deduplicate repositories and nonterminal runs;
- persist app-root selection;
- enqueue, retry, cancel, and report jobs;
- read only active-run output;
- authorize administration.

### GitHub Adapter

```ts
interface GitHubRepositorySource {
  getRepository(owner: string, name: string): Promise<RepositoryMetadata>
  getBranchHead(owner: string, name: string, branch: string): Promise<string>
  getCommit(owner: string, name: string, sha: string): Promise<CommitDetail>
  getTree(owner: string, name: string, treeSha: string): Promise<RepositoryTree>
  getFile(owner: string, name: string, path: string, ref: string): Promise<string | null>
  getRateLimit(): Promise<RateLimitState>
}
```

The adapter owns pagination, GitHub App authentication, response validation, truncation detection, rate metadata, and normalized errors. It never follows user-supplied hosts or arbitrary redirects.

### Worker

- atomically claim due jobs;
- renew leases and publish progress;
- resume from checkpoints;
- fetch and persist first-parent commits oldest first;
- run versioned classifiers and detectors;
- validate completeness;
- activate successful runs transactionally;
- release, retry, or fail jobs predictably.

### Query Services

All repository, timeline, commit, route, and dependency queries join through `Repository.activeRunId`. They never select unactivated staged data.

## 4. Import and Preflight

```text
URL validation
  -> canonical GitHub metadata
  -> default branch and head SHA
  -> HEAD tree and file count
  -> first-parent walk up to limit + 1
  -> Next.js app-root discovery
  -> reject, request configuration, or enqueue
```

Preflight is bounded by configured limits. Walking `limit + 1` commits proves whether the chain exceeds the ceiling. A recursively truncated GitHub tree is not accepted as a valid file count; the adapter must obtain complete tree evidence or return `GITHUB_DATA_TRUNCATED`.

Candidate app roots are directories containing a Next.js dependency and at least one supported route root. Discovery records evidence paths. If exactly one candidate exists, it is selected automatically. If several exist, no job is queued until configuration.

Repository identity is `(provider, externalId)`, not URL spelling. A transaction and unique constraints coalesce concurrent imports.

## 5. Job Model

### Statuses

```text
QUEUED
RUNNING
WAITING_RATE_LIMIT
RETRYABLE
SUCCEEDED
FAILED
CANCELLED
```

### Claim Protocol

A worker selects one due job using row locking with skip-locked semantics, then atomically sets:

- `status = RUNNING`;
- `leaseOwner` to the worker instance ID;
- `leaseExpiresAt` to a short future deadline;
- `heartbeatAt` to now;
- `attemptCount += 1`.

Only the lease owner may checkpoint or finish the job. Heartbeats extend the lease. A sweeper returns expired `RUNNING` jobs to `RETRYABLE` unless their attempt budget is exhausted.

### Retry Protocol

- transient GitHub or infrastructure error: `RETRYABLE` with exponential backoff and jitter;
- GitHub primary rate limit: `WAITING_RATE_LIMIT` with `nextAttemptAt` set after reset;
- unsupported or incomplete source evidence: terminal `FAILED`;
- user cancellation: `CANCELLED` at the next safe checkpoint.

Errors store a stable code and sanitized message. Raw upstream payloads and credentials are not exposed.

## 6. Processing Run

A run freezes:

- repository metadata snapshot;
- selected app root;
- default branch;
- root and head SHAs;
- expected first-parent commit count;
- public limits used;
- schema and detector versions.

Steps:

```text
DISCOVER_HISTORY
FETCH_COMMITS
CLASSIFY_COMMITS
DETECT_DEPENDENCIES
DETECT_ROUTES
VALIDATE_RUN
ACTIVATE_RUN
COMPLETE
```

Each step writes a durable checkpoint. Writes are idempotent under run-scoped unique keys.

### First-Parent Ingestion

Starting at the frozen head SHA:

1. fetch each commit;
2. record only the first parent for traversal;
3. reject if the chain exceeds the preflight count or configured limit;
4. reverse the collected chain to assign root-to-head sequence numbers;
5. fetch each commit's first-parent diff;
6. persist complete changed-file evidence and statistics.

For the root commit, compare against the empty tree. A merge commit is compared only with its first parent.

If GitHub omits or truncates required changed files, the run fails. No per-commit file cap is used.

## 7. Classification

The classifier parses recognized Conventional Commit types from the message header:

```text
feat -> FEATURE
fix -> FIX
refactor -> REFACTOR
docs -> DOCS
test -> TEST
style -> STYLE
build -> BUILD
chore -> CHORE
perf -> PERFORMANCE
ci -> CI
revert -> REVERT
```

Unmatched input is `UNCATEGORIZED`. Classification never derives intent from paths or detector output. The parser version is stored on the run.

## 8. Dependency Detection

For every commit where a `package.json` inside the selected app root changes:

1. read the manifest from the commit and first parent;
2. parse four supported dependency groups;
3. compare exact declaration strings per `(manifestPath, group, packageName)`;
4. persist `ADDED`, `REMOVED`, or `UPDATED` events.

A missing manifest is an empty map. Invalid JSON creates a structured warning scoped to the commit and manifest; processing continues only when route and file evidence remain trustworthy. Lockfiles are ignored.

## 9. Route Detection

For each adjacent first-parent commit, the worker obtains complete trees and derives route sets under the selected app root.

Supported sources:

```text
app/**/page.(js|jsx|ts|tsx)
app/**/route.(js|ts)
src/app/**/page.(js|jsx|ts|tsx)
src/app/**/route.(js|ts)
pages/**/*.(js|jsx|ts|tsx)
src/pages/**/*.(js|jsx|ts|tsx)
```

Framework metadata and non-route files such as layouts, loading states, templates, and error boundaries are excluded. Route groups are removed from public paths. Basic dynamic and catch-all segments are preserved in normalized form.

Set difference emits only `ADDED` and `REMOVED`. The root commit compares against an empty route set. Tree data may be discarded after its adjacent transition and checkpoint are safely persisted.

Advanced conventions that cannot be interpreted reliably generate versioned `COVERAGE_WARNING` records. Detector warnings never masquerade as route absence.

## 10. Validation and Activation

Before activation, verify:

- expected and persisted commit counts match;
- sequences are contiguous from root to head;
- every non-root commit has the expected first-parent relationship;
- required changed-file processing completed;
- all detector steps reached terminal success or an explicitly allowed warning state;
- version and coverage metadata exist;
- the run head still matches the frozen target contract.

Activation transaction:

1. lock the repository row;
2. set `previousRunId` to the prior `activeRunId`;
3. set `activeRunId` to the successful run;
4. mark the run and job succeeded;
5. update public repository metadata timestamps.

After activation, delete successful runs older than `activeRunId` and `previousRunId`. Failed run retention is bounded by an operational policy.

## 11. Refresh

Manual refresh repeats preflight against current GitHub state and creates a new run. The repository remains ready when it already has an active run. One unique nonterminal-run constraint prevents overlapping refreshes.

A changed default branch, force push, selected app root, or detector version can require a full rebuild. Reusing immutable commit payloads across runs is an optimization only; correctness cannot depend on reuse.

## 12. Warnings and Provenance

Warnings contain:

- stable code;
- scope: run, commit, manifest, or route detector;
- affected SHA/path when known;
- human-readable limitation;
- detector version.

Repository responses include a coverage summary. Timeline and commit responses include relevant warnings. The UI must distinguish unsupported analysis from a confirmed empty result.

## 13. Rate and Abuse Controls

- canonical repository deduplication;
- one nonterminal run per repository;
- per-IP import and refresh throttles;
- global running-job limit;
- worker concurrency configuration;
- GitHub rate inspection before expensive steps;
- persisted `nextAttemptAt` on rate exhaustion;
- configurable preflight ceilings;
- protected retry, cancellation, and deletion operations.

## 14. Health and Observability

Web health checks database connectivity. Worker health reports process liveness, database connectivity, last successful heartbeat, and queue lag. Logs use repository, run, job, and worker IDs but exclude credentials and raw imported content where unnecessary.

Required operational evidence:

- abandoned lease recovery test;
- retry scheduling test;
- duplicate import concurrency test;
- failed refresh preservation test;
- activation atomicity test;
- documented manual recovery procedure.

## 15. Suggested Structure

```text
src/
  app/
    api/
    repositories/[repositoryId]/
    case-study/
  features/
    import/
    repositories/
    timeline/
    commits/
  server/
    api/
    github/
    jobs/
    processing/
      classifiers/
      dependencies/
      routes/
    queries/
    security/
worker/
  main.ts
  heartbeat.ts
  sweeper.ts
```

## 16. Deferred Architecture

No current service, route, or table is reserved for arbitrary comparisons, architecture graphs, contributor analytics, generated milestones, or AI interpretation. Those capabilities require separate decisions and storage designs.
