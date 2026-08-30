# RepoReplay Product Requirements

## 1. Product Contract

RepoReplay is a portfolio-grade explorer for complete first-parent evolution in supported public Next.js repositories. It exposes observable commit, file, route, and declared-dependency evidence. It does not infer why a change mattered.

### Primary User

A new contributor who needs historical context for an unfamiliar Next.js application.

### Job to Be Done

When I approach an unfamiliar Next.js repository, I want to find when routes and declared dependencies appeared, changed, or disappeared and open the responsible commits, so I can understand its mainline evolution without manually reading the entire Git log.

### Portfolio Objective

Demonstrate balanced full-stack product judgment, weighted toward backend and data engineering: durable ingestion, correct history semantics, reproducible detectors, safe activation, and an accessible evidence-first interface.

## 2. Product Principles

1. **Evidence before interpretation.** Every event identifies its source commit and file.
2. **Complete or rejected.** Never label a truncated history complete.
3. **Mainline semantics are explicit.** History follows the default branch's first-parent chain.
4. **Old data remains usable.** Failed refreshes cannot replace a successful snapshot.
5. **Unknown is visible.** Unsupported conventions and reduced coverage produce warnings.
6. **One ecosystem done well.** MVP accepts Next.js only.
7. **Portfolio depth over platform breadth.** Features exist to prove the core workflow and engineering claims.

## 3. Supported Inputs

A repository is supported when it is:

- public and hosted on `github.com`;
- accessible by the configured GitHub App;
- non-empty;
- a Next.js application using App Router, Pages Router, or both;
- within configured first-parent commit and HEAD file-count limits; and
- processable without truncated commit file evidence.

Supported route roots are relative to a selected app root:

```text
app
src/app
pages
src/pages
```

If multiple app roots are detected, import pauses in `NEEDS_CONFIGURATION` until the user selects one. MVP analyzes one app root per repository.

## 4. History Semantics

- The source is the current default branch.
- The analyzed chain starts at the branch root and follows first-parent ancestry to the preflight head SHA.
- Merge commits use their first-parent diff.
- The run records the branch name, head SHA, root SHA, commit count, and completion timestamp.
- A force push or default-branch change is handled by a new refresh run; prior active data remains available until the new run succeeds.
- A run exceeding configured limits is rejected during preflight.

## 5. Functional Requirements

### FR-01: Preflight and Import

The user submits a public GitHub repository URL. The system must:

1. normalize and validate the URL;
2. fetch canonical repository metadata;
3. inspect the default branch and head tree;
4. count first-parent commits without starting full ingestion;
5. detect Next.js app-root candidates;
6. enforce configured limits;
7. deduplicate concurrent imports by provider repository ID; and
8. create a repository and processing run, or return an existing repository.

Acceptance criteria:

- invalid, missing, private, empty, unsupported, and oversized repositories return distinct errors;
- limits are returned in machine-readable error details;
- ambiguous roots return candidate paths and do not enqueue ingestion;
- duplicate requests do not create duplicate active jobs;
- visitor requests are subject to IP throttling and global job concurrency controls.

### FR-02: App-Root Configuration

For an ambiguous repository, the user selects one candidate app root.

Acceptance criteria:

- only a preflight-discovered candidate is accepted;
- selection is persisted on the processing run;
- configuration enqueues the run exactly once;
- changing the app root later requires a new refresh run.

### FR-03: Durable Processing

A separate worker process claims queued PostgreSQL jobs.

Job statuses:

```text
QUEUED
RUNNING
WAITING_RATE_LIMIT
RETRYABLE
SUCCEEDED
FAILED
CANCELLED
```

Required behavior:

- atomic claim with an expiring lease;
- heartbeat while running;
- resumable checkpoints;
- bounded attempts and exponential backoff;
- rate-limit reset scheduling;
- idempotent persistence;
- recovery of abandoned leases;
- stage output under one processing run;
- activate only after all required steps succeed.

### FR-04: Repository Availability

Repository availability is separate from latest job status:

```text
CONFIGURATION_REQUIRED
PROCESSING
READY
```

A repository with an active snapshot remains `READY` during refresh and after refresh failure. The latest run status and error remain visible.

### FR-05: Repository Overview

Display:

- owner and repository name;
- description, primary language, stars, and default branch snapshot;
- selected app root;
- analyzed root and head SHAs;
- complete first-parent commit count and date range;
- current route and declared-dependency counts;
- processing completion time;
- detector and schema versions;
- coverage warnings;
- refresh action and latest refresh state.

Counts are derived only from the active successful run.

### FR-06: Evolution Timeline

Display active-run commits newest first with cursor pagination.

Each entry includes:

- short SHA, full message, author display name, committed timestamp, and GitHub URL;
- changed-file count, additions, and deletions;
- explicit Conventional Commit category or `UNCATEGORIZED`;
- route additions/removals;
- dependency additions/removals/updates; and
- an expandable changed-file summary.

Filters:

- category;
- file path;
- keyword;
- date range; and
- event type: route or dependency.

Author filtering and contributor analytics are excluded from MVP.

### FR-07: Commit Evidence

A desktop drawer and mobile full-screen view show:

- commit metadata and first-parent SHA;
- first-parent diff statistics;
- all changed files with status, previous path, additions, and deletions;
- dependency transitions and manifest path;
- route additions/removals and source path;
- category and category source; and
- link to the canonical GitHub commit.

If GitHub truncates required changed-file evidence, the run fails rather than silently omitting data.

### FR-08: Dependency Evolution

Analyze `package.json` files inside the selected app root.

Groups:

```text
dependencies
devDependencies
peerDependencies
optionalDependencies
```

Events:

```text
ADDED
REMOVED
UPDATED
```

Each event records manifest path, package name, group, old value, and new value. Lockfiles and resolved transitive versions are not analyzed. Moving a package between groups produces a removal and an addition.

### FR-09: Route Evolution

Analyze complete route sets from repository trees for the selected app root, then emit transitions between adjacent first-parent commits.

Events:

```text
ADDED
REMOVED
```

Supported basics include static, dynamic, catch-all, optional catch-all, route-group, page, and API route file conventions. Parallel routes, intercepting routes, rewrites, redirects, middleware behavior, localization, and runtime routing logic may produce structured coverage warnings and are not semantically interpreted.

Editing an existing route file is a file event, not a route-topology event.

### FR-10: Manual Refresh

A user can request a refresh from GitHub.

Acceptance criteria:

- an existing active snapshot remains readable;
- only one nonterminal run exists per repository;
- refreshed metadata and history are staged under the new run;
- success atomically swaps the active run and preserves one previous successful run;
- failure preserves the active run and exposes retry details;
- detector-version changes may trigger a full rebuild.

### FR-11: Stable Sharing

Every ready repository has a stable URL. Shared views show the active snapshot's head SHA and processing timestamp so evidence is reproducible.

### FR-12: Administration

Protected administration supports:

- permanent repository deletion, including jobs and run data;
- cancellation of queued or running jobs;
- retry of eligible failed jobs;
- worker and dependency health inspection.

## 6. Non-Functional Requirements

### Correctness

- No active run contains incomplete required steps.
- Detector output records independent schema, classifier, route-detector, and dependency-detector versions.
- All timeline data is scoped to the active run.
- Imported content is treated as untrusted text and rendered without executable HTML.

### Performance

- Ready pages read PostgreSQL only.
- Timeline pagination is cursor-based with a default of 30 and maximum of 100.
- Import work never runs in the request lifecycle.
- Database indexes support active-run sequence, category, path, and event queries.

### Reliability

- Worker termination is recoverable after lease expiry.
- Processing is idempotent at run, commit, and detector-output boundaries.
- Rate limits schedule a future attempt instead of busy retrying.
- Previous successful data survives refresh failure.

### Security and Abuse Controls

- GitHub credentials remain server-side.
- Only canonical GitHub repository identifiers are accepted.
- Redirects and arbitrary hosts are not followed.
- Anonymous imports use IP throttling, global concurrency limits, and repository deduplication.
- Admin endpoints require authorization.
- Raw server errors and credentials are never returned.

### Accessibility

The deployed UI targets WCAG 2.2 AA. Acceptance includes keyboard operation, visible focus, semantic controls, accessible drawer behavior, reduced motion, 200% zoom, 320 CSS-pixel reflow without horizontal page scrolling, and AA contrast.

## 7. Configurable Limits

Initial defaults:

```text
MAX_FIRST_PARENT_COMMITS=500
MAX_HEAD_FILES=25000
TIMELINE_DEFAULT_LIMIT=30
TIMELINE_MAX_LIMIT=100
MAX_GLOBAL_RUNNING_JOBS=<deployment-specific>
MAX_IMPORTS_PER_IP_WINDOW=<deployment-specific>
```

The API exposes public processing limits. Deployment-specific abuse values need not expose sensitive operational detail.

## 8. Explicit Non-Goals

- arbitrary commit comparison;
- architecture visualization;
- standalone analytics dashboard;
- contributor counts, ranking, or email storage;
- milestone detection or semantic project narratives;
- private repositories;
- multiple apps in one repository view;
- non-Next.js repositories;
- lockfile or transitive dependency analysis;
- AI summaries;
- repository modification;
- GitLab or Bitbucket;
- billing, teams, and collaboration.

Future work requires a new product decision and must not be implied by MVP contracts.

## 9. Success Evidence

The portfolio MVP succeeds when:

- supported fixture repositories produce exact expected route and dependency transitions;
- an interrupted worker resumes without duplicated or missing active data;
- concurrent duplicate imports create one processable run;
- failed refresh leaves the prior snapshot available;
- every displayed event opens its source commit and file evidence;
- one real showcase repository completes end to end in production;
- a reviewer can complete import-to-evidence exploration without assistance; and
- automated accessibility checks and documented manual checks pass the supported flow.
