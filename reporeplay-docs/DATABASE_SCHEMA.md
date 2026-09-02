# RepoReplay Database Schema

## 1. Invariants

1. Every imported output belongs to one `ProcessingRun`.
2. Public reads use only `Repository.activeRunId`.
3. A repository has at most one nonterminal processing run.
4. A successful activation is atomic.
5. The active and previous successful runs are retained; older successful runs are deleted.
6. History is a root-to-head first-parent sequence, not a general Git graph.
7. No author email or email-derived identifier is stored.
8. Detector output is reproducible from version fields and source evidence.

## 2. Relationships

```text
Repository
  |-- activeRunId ------+
  |-- previousRunId ----|-------------------+
  |                     |                   |
  +--< ProcessingRun >--+                   |
          |                                  |
          +--1 ProcessingJob                 |
          +--< RunAppRootCandidate           |
          +--< RunCommit                     |
          |      +--< CommitFile             |
          |      +--< CommitCategory         |
          |      +--< DependencyChange       |
          |      +--< RouteChange            |
          +--< ProcessingWarning             |
```

## 3. Repository

| Field | Type | Notes |
|---|---|---|
| id | UUID | primary key |
| provider | enum | `GITHUB` |
| externalId | string | immutable GitHub repository ID |
| owner | string | current metadata |
| name | string | current metadata |
| fullName | string | current canonical owner/name |
| canonicalUrl | string | trusted GitHub URL |
| description | text? | untrusted display text |
| primaryLanguage | string? | metadata snapshot |
| stars | integer | metadata snapshot |
| defaultBranch | string | latest known default branch |
| selectedAppRoot | string? | current selection |
| availability | enum | `CONFIGURATION_REQUIRED`, `PROCESSING`, `READY` |
| activeRunId | UUID? | active successful run |
| previousRunId | UUID? | rollback run |
| createdAt | datetime | |
| updatedAt | datetime | |
| deletedAt | datetime? | optional deletion coordination |

Constraints and indexes:

```text
UNIQUE(provider, externalId)
UNIQUE(provider, owner, name)
INDEX(availability)
```

`READY` requires a non-null `activeRunId`. A repository may remain `READY` while a refresh run is nonterminal or failed.

## 4. ProcessingRun

A run freezes source scope and detector provenance.

| Field | Type | Notes |
|---|---|---|
| id | UUID | primary key |
| repositoryId | UUID | cascade delete |
| kind | enum | `IMPORT`, `REFRESH`, `REPROCESS` |
| status | enum | `NEEDS_CONFIGURATION`, `QUEUED`, `RUNNING`, `WAITING_RATE_LIMIT`, `RETRYABLE`, `SUCCEEDED`, `FAILED`, `CANCELLED` |
| selectedAppRoot | string? | immutable after queueing |
| defaultBranch | string | frozen source branch |
| rootSha | string? | first-parent root |
| headSha | string | frozen target head |
| expectedCommitCount | integer? | proven during preflight |
| headFileCount | integer | complete HEAD tree count |
| maxCommitLimit | integer | limit applied |
| maxHeadFileLimit | integer | limit applied |
| schemaVersion | string | storage contract |
| classifierVersion | string | independent provenance |
| dependencyDetectorVersion | string | independent provenance |
| routeDetectorVersion | string | independent provenance |
| currentStep | enum | processing checkpoint step |
| processedCommitCount | integer | derived contiguous progress count |
| fetchedCommitCount | integer | latest durable count of commits fetched from GitHub |
| checkpointSequence | integer | highest contiguous sequence completed for `currentStep`; `-1` means none |
| checkpointUpdatedAt | datetime? | last durable checkpoint write |
| requestedAt | datetime | |
| startedAt | datetime? | |
| completedAt | datetime? | |
| activatedAt | datetime? | |
| errorCode | string? | stable code |
| errorMessage | text? | sanitized |

Constraints and indexes:

```text
UNIQUE(repositoryId, id)
INDEX(repositoryId, requestedAt DESC)
INDEX(repositoryId, status)
```

Use a partial unique index to allow at most one status in `NEEDS_CONFIGURATION`, `QUEUED`, `RUNNING`, `WAITING_RATE_LIMIT`, or `RETRYABLE` per repository.

## 5. RunAppRootCandidate

| Field | Type | Notes |
|---|---|---|
| id | UUID | |
| runId | UUID | cascade delete |
| path | string | candidate app root |
| evidenceManifestPath | string | matching `package.json` |
| routeRoots | string[] | discovered supported roots |

Constraint:

```text
UNIQUE(runId, path)
```

## 6. ProcessingJob

One job executes one run.

| Field | Type | Notes |
|---|---|---|
| id | UUID | |
| runId | UUID | unique, cascade delete |
| status | enum | same executable statuses as run, excluding `NEEDS_CONFIGURATION` |
| priority | integer | default 0 |
| attemptCount | integer | incremented on claim |
| leaseGeneration | integer | monotonic fencing token incremented on claim |
| maxAttempts | integer | |
| nextAttemptAt | datetime | due time |
| leaseOwner | string? | worker instance ID |
| leaseExpiresAt | datetime? | claim deadline |
| heartbeatAt | datetime? | liveness |
| cancelRequestedAt | datetime? | cooperative cancellation |
| lastErrorCode | string? | |
| lastErrorMessage | text? | sanitized |
| createdAt | datetime | |
| updatedAt | datetime | |

Indexes:

```text
UNIQUE(runId)
INDEX(status, nextAttemptAt, priority)
INDEX(leaseExpiresAt)
```

The claim query uses row locking with skip-locked behavior. Job and run status updates occur in the same transaction where required.

## 7. RunCommit

Commits are scoped to a run so staged and active histories cannot mix.

| Field | Type | Notes |
|---|---|---|
| id | UUID | |
| runId | UUID | cascade delete |
| sha | string | full SHA |
| shortSha | string | display only |
| firstParentSha | string? | null for root |
| treeSha | string | source tree identity |
| sequence | integer | root = 0, head = count - 1 |
| message | text | untrusted display text |
| authorName | string? | no email stored |
| authoredAt | datetime? | source metadata |
| committedAt | datetime | timeline ordering metadata |
| additions | integer | first-parent diff |
| deletions | integer | first-parent diff |
| changedFileCount | integer | complete first-parent diff |
| externalUrl | string | canonical GitHub URL |

Constraints and indexes:

```text
UNIQUE(runId, sha)
UNIQUE(runId, sequence)
INDEX(runId, sequence DESC)
INDEX(runId, committedAt DESC, sequence DESC)
```

Timeline cursors encode active run ID and sequence. A cursor from an obsolete run returns `CURSOR_SNAPSHOT_MISMATCH`.

## 8. CommitFile

| Field | Type | Notes |
|---|---|---|
| id | UUID | |
| runId | UUID | denormalized active-run query scope |
| runCommitId | UUID | cascade delete |
| path | string | path after change, or removed path |
| previousPath | string? | rename source |
| status | enum | `ADDED`, `MODIFIED`, `REMOVED`, `RENAMED` |
| additions | integer | |
| deletions | integer | |
| changes | integer | |

Indexes:

```text
UNIQUE(runCommitId, path, status)
FOREIGN KEY(runId, runCommitId) REFERENCES RunCommit(runId, id)
INDEX(runCommitId)
INDEX(runId, path)
```

`runId` is maintained transactionally and participates in a composite foreign key, preventing a file from referencing a commit in another run.

## 9. CommitCategory

Each commit has exactly one explicit category.

| Field | Type | Notes |
|---|---|---|
| id | UUID | |
| runCommitId | UUID | unique |
| category | enum | `FEATURE`, `FIX`, `REFACTOR`, `DOCS`, `TEST`, `STYLE`, `BUILD`, `CHORE`, `PERFORMANCE`, `CI`, `REVERT`, `UNCATEGORIZED` |
| source | enum | `CONVENTIONAL_COMMIT`, `NONE` |
| matchedType | string? | parsed prefix |

Indexes:

```text
UNIQUE(runCommitId)
INDEX(category)
```

## 10. DependencyChange

| Field | Type | Notes |
|---|---|---|
| id | UUID | |
| runCommitId | UUID | cascade delete |
| manifestPath | string | relative repository path |
| packageName | string | exact declaration key |
| dependencyGroup | enum | `DEPENDENCY`, `DEV_DEPENDENCY`, `PEER_DEPENDENCY`, `OPTIONAL_DEPENDENCY` |
| changeType | enum | `ADDED`, `REMOVED`, `UPDATED` |
| previousValue | string? | exact declaration |
| currentValue | string? | exact declaration |

Constraints and indexes:

```text
UNIQUE(runCommitId, manifestPath, packageName, dependencyGroup, changeType)
INDEX(runCommitId)
INDEX(packageName)
```

## 11. RouteChange

| Field | Type | Notes |
|---|---|---|
| id | UUID | |
| runCommitId | UUID | cascade delete |
| router | enum | `APP`, `PAGES` |
| route | string | normalized public pattern |
| sourcePath | string | evidence path |
| routeType | enum | `PAGE`, `API` |
| changeType | enum | `ADDED`, `REMOVED` |

Constraints and indexes:

```text
UNIQUE(runCommitId, router, route, sourcePath, changeType)
INDEX(runCommitId)
INDEX(route)
```

## 12. ProcessingWarning

| Field | Type | Notes |
|---|---|---|
| id | UUID | |
| runId | UUID | cascade delete |
| runCommitId | UUID? | optional commit scope |
| code | string | stable warning code |
| detector | enum? | `DEPENDENCY`, `ROUTE`, `SOURCE` |
| path | string? | affected manifest or route source |
| message | text | safe user-facing limitation |
| detectorVersion | string? | provenance |
| createdAt | datetime | |

Constraints:

```text
FOREIGN KEY(runId, runCommitId) REFERENCES RunCommit(runId, id)
UNIQUE NULLS NOT DISTINCT(runId, runCommitId, code, detector, path, detectorVersion)
```

Indexes:

```text
INDEX(runId, code)
INDEX(runCommitId)
```

Warnings are part of product output and remain with retained successful runs.

## 13. Activation Transaction

The worker must:

```text
BEGIN
  lock Repository
  verify ProcessingRun is validated and owns its job lease
  Repository.previousRunId = Repository.activeRunId
  Repository.activeRunId = ProcessingRun.id
  Repository.availability = READY
  ProcessingRun.status = SUCCEEDED
  ProcessingRun.activatedAt = now
  ProcessingJob.status = SUCCEEDED
COMMIT
```

No public query may infer active status from a run timestamp alone.

## 14. Retention and Deletion

After activation:

- retain the active successful run;
- retain one previous successful run;
- delete older successful run graphs asynchronously;
- retain failed runs only for a configured diagnostic period;
- permanent repository deletion cancels or invalidates leases, then cascades all repository data.

Git SHAs are immutable, but run membership and default-branch history are not. Do not preserve orphaned run data indefinitely merely because commit objects are immutable.

## 15. Excluded Models

MVP has no tables for contributors, email hashes, comparisons, analytics snapshots, architecture graphs, milestones, generated summaries, lockfile resolutions, or user accounts.
