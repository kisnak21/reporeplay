# RepoReplay Development Roadmap

## Guiding Rule

Resolve correctness and operational risks before visual breadth.

```text
Contracts and fixtures
  -> schema and job invariants
  -> durable worker
  -> complete GitHub ingestion
  -> versioned detectors
  -> read APIs
  -> accessible timeline
  -> refresh and recovery
  -> production proof
  -> case study
```

No phase adds comparison, architecture graphs, a separate analytics dashboard, contributor analytics, semantic milestones, or AI interpretation.

## Phase 0: Contracts, Fixtures, and Foundation

### Goal

Create an executable foundation and freeze test evidence before implementation choices spread.

### Deliverables

- initialize the web application and separate worker entry point;
- configure TypeScript, linting, formatting, environment validation, PostgreSQL, migrations, and tests;
- encode status enums and stable error codes from the docs;
- create deterministic Git fixtures for root commits, merges, App Router, Pages Router, migration between routers, manifests, monorepos, malformed manifests, and unsupported route conventions;
- define API contract fixtures;
- add CI for lint, typecheck, unit, and integration test commands.

### Exit Criteria

- web and worker boot;
- database migrations apply from empty state;
- fixture expectations are reviewable;
- CI runs all configured static checks and tests.

## Phase 1: Schema and Durable Job Runner

### Goal

Prove that work survives HTTP and worker process termination.

### Deliverables

- implement repository, run, job, commit, event, and warning schema;
- enforce one nonterminal run per repository;
- implement atomic claim with skip-locked behavior;
- implement lease heartbeat, expiry recovery, retry scheduling, cancellation, and attempt exhaustion;
- implement staged run cleanup and protected deletion skeleton;
- add worker liveness and queue-lag health data.

### Exit Criteria

- two workers cannot claim one job;
- an interrupted worker's job is reclaimed after lease expiry;
- retries do not duplicate staged rows;
- cancellation prevents activation;
- integration tests prove the invariants.

## Phase 2: GitHub App and Preflight

### Goal

Reject unsupported or unsafe work before full ingestion.

### Deliverables

- GitHub App authentication and REST adapter;
- canonical URL and repository identity handling;
- metadata, default branch, head SHA, complete HEAD tree, and first-parent count discovery;
- limit enforcement using backend configuration;
- Next.js candidate app-root discovery;
- signed preflight token;
- duplicate-import transaction;
- IP throttling and global concurrency gate;
- preflight and import REST contracts.

### Exit Criteria

- invalid, private, missing, empty, unsupported, truncated, and oversized repositories produce correct errors;
- ambiguous roots pause for configuration;
- concurrent imports coalesce;
- no history job starts before successful preflight.

## Phase 3: Complete First-Parent Ingestion

### Goal

Persist a trustworthy root-to-head mainline with complete file evidence.

### Deliverables

- freeze source branch and head SHA on each run;
- traverse first-parent commits and assign contiguous sequence;
- process root against the empty tree and merges against first parent;
- persist commit metadata without author email;
- persist all changed files and detect GitHub truncation;
- checkpoint and resume commit ingestion;
- validate count, sequence, parent, and head invariants.

### Exit Criteria

- merge and root fixtures match expected diffs;
- interruption resumes without missing or duplicate commits;
- incomplete changed-file evidence fails the staged run;
- no failed run is publicly readable.

## Phase 4: Versioned Classifier and Detectors

### Goal

Produce exact route and dependency transitions with visible limitations.

### Deliverables

- explicit Conventional Commit parser and `UNCATEGORIZED` fallback;
- `package.json` declaration detector with manifest path and four groups;
- complete-tree App Router and Pages Router route-set detector;
- `ADDED` and `REMOVED` route transitions;
- structured warnings for malformed manifests and unsupported routing conventions;
- independent detector version fields;
- fixture-driven unit and database integration tests.

### Exit Criteria

- every fixture produces exact expected events and warnings;
- detector re-execution is idempotent;
- no path-based intent inference exists;
- lockfiles are not interpreted.

## Phase 5: Validation, Activation, and Read APIs

### Goal

Expose only complete successful snapshots.

### Deliverables

- validation gate for commit and detector completeness;
- atomic active/previous run swap;
- bounded successful-run retention;
- repository detail and run status endpoints;
- cursor timeline endpoint with snapshot-bound cursors;
- commit evidence endpoint;
- coverage summary and warning projection;
- API contract tests and query indexes.

### Exit Criteria

- readers cannot observe staged data;
- activation either completes fully or changes nothing;
- obsolete cursors return the documented conflict;
- every event links to an active-run commit and source path.

## Phase 6: Accessible Product UI

### Goal

Deliver the complete import-to-evidence workflow.

### Deliverables

- landing/import form and limits display;
- preflight confirmation and app-root selection;
- processing status with rate-limit, retry, failure, and cancellation states;
- repository overview and coverage summary;
- cursor-paginated timeline and URL-backed filters;
- expandable file evidence;
- route-addressable commit drawer and mobile page;
- loading, empty, warning, stale, and error states;
- responsive and accessibility implementation from the start.

### Exit Criteria

- a reviewer reaches source evidence without assistance;
- keyboard, focus, drawer, reduced-motion, and status-announcement behavior pass manual checks;
- the flow reflows at 320 CSS pixels and 200% zoom;
- automated accessibility checks report no known violations in the supported flow.

## Phase 7: Refresh, Failure Recovery, and Administration

### Goal

Prove that mutable GitHub state does not corrupt a usable snapshot.

### Deliverables

- manual refresh preflight and enqueueing;
- configuration-required refresh flow;
- failed-refresh preservation UI;
- retry and cancellation endpoints;
- active plus previous successful retention;
- protected permanent deletion;
- force-push and default-branch-change integration fixtures;
- documented recovery runbook.

### Exit Criteria

- failed refresh leaves the previous snapshot queryable;
- successful refresh swaps snapshots atomically;
- one nonterminal-run invariant holds under concurrent refresh;
- deletion prevents stale workers from recreating data.

## Phase 8: Production Deployment and Evidence

### Goal

Demonstrate the architecture in a public environment.

### Deliverables

- production PostgreSQL;
- independently deployed web and worker processes;
- GitHub App secret management;
- health checks, structured logs, queue lag, and error reporting;
- one real showcase repository;
- end-to-end production smoke test;
- request-budget and operational-limit documentation.

### Exit Criteria

- web and worker restarts recover safely;
- showcase import and refresh complete in production;
- no credentials or raw errors reach clients;
- health and recovery procedures are documented and exercised.

## Phase 9: Portfolio Case Study and Final Verification

### Goal

Make product and engineering judgment inspectable.

### Deliverables

- case study covering scope cuts, first-parent semantics, leases, staged activation, detectors, warnings, and accessibility;
- diagrams derived from the implemented system;
- test evidence and known limitations;
- final cross-document consistency review;
- full lint, typecheck, unit, integration, contract, E2E, and accessibility runs.

### Exit Criteria

- all definition-of-done items in `README.md` pass;
- claims link to code, tests, deployed behavior, or documented measurements;
- no deferred feature appears in navigation, API, schema, or product copy.
