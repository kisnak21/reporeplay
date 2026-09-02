# RepoReplay Engineering Tasks

Every task is complete only when its acceptance test passes. Tests are built with the feature, not deferred to a final testing epic.

## Epic 1: Contracts and Foundation

- [ ] Initialize the Next.js TypeScript web application.
- [ ] Add a separately runnable TypeScript worker entry point.
- [ ] Configure lint, formatting, and typecheck commands.
- [ ] Configure environment validation for web, worker, database, GitHub App, limits, leases, and throttles.
- [ ] Configure PostgreSQL and migration tooling.
- [ ] Configure unit, database integration, API contract, and Playwright test suites.
- [ ] Encode shared statuses, processing steps, categories, event types, and stable errors.
- [ ] Add CI that runs migrations, lint, typecheck, and tests.
- [ ] Add Git fixtures for root, linear, merge, force-push, App Router, Pages Router, router migration, monorepo, malformed manifest, and advanced-route-warning cases.
- [ ] Document fixture expected outputs in test data.

**Acceptance:** Web and worker boot, an empty database migrates, and CI executes all checks.

## Epic 2: Persistence Invariants

- [ ] Implement `Repository` with active and previous run pointers.
- [ ] Implement `ProcessingRun` with frozen source, limits, versions, progress, and errors.
- [ ] Implement `RunAppRootCandidate`.
- [ ] Implement `ProcessingJob` with lease and retry fields.
- [ ] Implement run-scoped commits, files, categories, dependency changes, route changes, and warnings.
- [ ] Add cascade deletion and retention indexes.
- [ ] Enforce one nonterminal run per repository with a partial unique index.
- [ ] Add active-run query helpers that cannot read staged output accidentally.
- [ ] Add schema invariant integration tests.

**Acceptance:** Constraints reject duplicate canonical repositories, duplicate nonterminal runs, duplicate sequence values, and cross-run output mixing.

## Epic 3: Durable Worker

- [ ] Implement due-job claim with row lock and skip-locked semantics.
- [ ] Implement worker identity and lease ownership checks.
- [ ] Implement heartbeat and lease extension.
- [ ] Implement durable step checkpoints.
- [ ] Implement bounded attempts, exponential backoff, and jitter.
- [ ] Implement `WAITING_RATE_LIMIT` scheduling.
- [ ] Implement expired-lease recovery sweeper.
- [ ] Implement cooperative cancellation.
- [ ] Prevent stale lease owners from checkpointing, activating, or recreating deleted data.
- [x] Add queue lag and worker heartbeat health reporting.
- [ ] Test competing workers, termination, expiry, retry, exhaustion, and cancellation.

**Acceptance:** Killing a worker mid-step leads to one resumed result with no duplicate active data.

## Epic 4: GitHub App Adapter

- [ ] Implement GitHub App installation-token acquisition and refresh.
- [ ] Implement canonical `github.com/:owner/:repo` parsing and `.git` removal.
- [ ] Reject alternate hosts, embedded credentials, malformed paths, and unsafe redirects.
- [ ] Fetch and validate repository metadata.
- [ ] Fetch default-branch head commit.
- [ ] Fetch complete trees and detect recursive-tree truncation.
- [ ] Fetch commits and first-parent details.
- [ ] Fetch complete first-parent file diffs and detect pagination/truncation.
- [ ] Fetch file content at an exact SHA.
- [ ] Normalize upstream errors and rate metadata.
- [ ] Add adapter contract tests with recorded or mocked GitHub responses.

**Acceptance:** The adapter either returns complete validated evidence or a stable typed error.

## Epic 5: Preflight and Import

- [ ] Implement public limits endpoint.
- [ ] Count first-parent commits up to configured limit plus one.
- [ ] Count complete HEAD tree files.
- [ ] Detect Next.js app-root candidates from manifest and route-root evidence.
- [ ] Reject missing Next.js dependencies or route roots.
- [ ] Generate and verify short-lived signed preflight tokens.
- [ ] Implement preflight endpoint and errors.
- [ ] Implement canonical repository upsert.
- [ ] Implement create-or-reuse import transaction.
- [ ] Implement configuration-required runs.
- [ ] Implement app-root selection restricted to discovered candidates.
- [ ] Implement idempotency-key storage and replay behavior.
- [ ] Implement per-IP import throttling and global run admission.
- [ ] Test concurrent duplicate imports.

**Acceptance:** Unsupported and oversized repositories never enqueue, and concurrent valid imports yield one nonterminal run.

## Epic 6: First-Parent Ingestion

- [ ] Freeze default branch, root SHA, head SHA, counts, app root, limits, and versions.
- [ ] Traverse head to root using only the first parent.
- [ ] Reverse traversal into contiguous root-to-head sequence.
- [ ] Compare root commit with the empty tree.
- [ ] Compare merge commits with their first parent.
- [ ] Persist author display name without email fields.
- [ ] Persist complete changed-file status, rename source, additions, and deletions.
- [ ] Checkpoint after idempotent commit batches.
- [ ] Reject chain drift, count mismatch, and incomplete file evidence.
- [ ] Test resume at every checkpoint boundary.

**Acceptance:** Fixture histories exactly match expected sequence, parent, and file-diff evidence after clean and interrupted runs.

## Epic 7: Commit Classification

- [ ] Parse Conventional Commit type and optional scope from the first message line.
- [ ] Map supported types to documented categories.
- [ ] Store exactly one category per commit.
- [ ] Store `UNCATEGORIZED` and source `NONE` for unmatched messages.
- [ ] Persist classifier version on the run.
- [ ] Add table-driven parser tests for case, breaking markers, scopes, malformed messages, and merge messages.

**Acceptance:** No category is inferred from paths, dependencies, or routes.

## Epic 8: Dependency Detector

- [ ] Identify changed `package.json` files inside the selected app root.
- [ ] Read current and first-parent manifests by SHA.
- [ ] Treat missing manifests as empty maps.
- [ ] Parse dependencies, devDependencies, peerDependencies, and optionalDependencies.
- [ ] Compare exact declaration values by manifest, group, and package.
- [ ] Emit additions, removals, and updates.
- [ ] Emit removal plus addition when a package changes groups.
- [ ] Store manifest path on every event.
- [ ] Create structured warnings for malformed manifests.
- [ ] Ignore lockfiles explicitly.
- [ ] Add fixture and database idempotency tests.

**Acceptance:** Expected manifest transitions and warnings match fixtures exactly.

## Epic 9: Route Detector

- [ ] Derive route sets from complete adjacent commit trees.
- [ ] Support `app`, `src/app`, `pages`, and `src/pages` relative to the app root.
- [ ] Support page and API route files.
- [ ] Normalize route groups, dynamic segments, catch-all segments, and optional catch-all segments.
- [ ] Exclude layouts, loading, error, template, and other non-route files.
- [ ] Emit only route additions and removals.
- [ ] Preserve route source path and router type.
- [ ] Emit warnings for parallel routes, intercepting routes, rewrites, redirects, middleware semantics, localization, and ambiguous collisions.
- [ ] Discard temporary tree state only after safe checkpoint persistence.
- [ ] Add App Router, Pages Router, migration, root, and warning fixtures.

**Acceptance:** Route-set differences match fixture expectations and never report file edits as route changes.

## Epic 10: Run Validation and Activation

- [ ] Validate expected commit count and contiguous sequence.
- [ ] Validate first-parent relationships and complete file step.
- [ ] Validate required detector completion and provenance.
- [ ] Implement atomic active/previous run activation transaction.
- [ ] Mark run and job success in the activation transaction.
- [ ] Retain active plus one previous successful run.
- [ ] Bound failed-run retention.
- [ ] Test transaction rollback at every activation write.
- [ ] Test that failed validation leaves active pointers unchanged.

**Acceptance:** Readers observe either the old complete snapshot or the new complete snapshot, never a mixture.

## Epic 11: Read REST API

- [ ] Implement repository detail with active snapshot, latest run, limits, versions, and coverage.
- [ ] Implement run-status polling response.
- [ ] Implement active-run timeline queries newest first.
- [ ] Implement signed opaque cursor encoding run ID and sequence.
- [ ] Implement cursor snapshot mismatch response.
- [ ] Implement keyword, category, path, date, and event filters.
- [ ] Implement commit evidence endpoint scoped to the active run.
- [ ] Return relevant run and commit warnings.
- [ ] Add query indexes based on measured plans.
- [ ] Add API contract and authorization tests.

**Acceptance:** Every response conforms to `API_SPEC.md`, and staged data is unreachable through public reads.

## Epic 12: Import and Processing UI

- [ ] Build import form with client and server error association.
- [ ] Load and display backend processing limits.
- [ ] Build preflight summary and explicit confirmation.
- [ ] Build app-root selector with evidence paths.
- [ ] Build processing state UI for every documented status.
- [ ] Add bounded polling and terminal-state stop.
- [ ] Add retry and cancellation actions with feedback.
- [ ] Add unsupported, oversized, truncated-source, rate-limit, and failure states.
- [ ] Announce asynchronous status updates accessibly without moving focus.
- [ ] Test keyboard, screen-reader names, errors, and mobile reflow.

**Acceptance:** A keyboard-only user can submit, configure, monitor, retry, and enter a completed repository.

## Epic 13: Overview and Timeline UI

- [ ] Build stable repository route and header.
- [ ] Display branch, app root, root/head SHA, complete count, dates, and processed time.
- [ ] Display route and dependency summary counts.
- [ ] Build coverage summary and warning details.
- [ ] Build URL-backed timeline filters.
- [ ] Build cursor loading and snapshot-mismatch recovery.
- [ ] Build commit summaries with textual event labels.
- [ ] Build accessible changed-file disclosures.
- [ ] Preserve filters and scroll position during commit inspection.
- [ ] Add loading, empty, partial-page error, and confirmed-no-event states.
- [ ] Test long names, paths, SHAs, and declaration values.

**Acceptance:** A reviewer can find a route or dependency event and identify its commit without leaving the timeline.

## Epic 14: Commit Evidence UI

- [ ] Implement route-addressable desktop drawer.
- [ ] Implement mobile full-screen commit route.
- [ ] Render first-parent metadata and statistics.
- [ ] Render complete file, dependency, route, category, warning, and provenance sections.
- [ ] Link to the canonical GitHub commit.
- [ ] Implement focus entry, trapping, Escape, close labeling, focus return, and browser Back behavior.
- [ ] Prevent background operation while modal.
- [ ] Add component and E2E accessibility tests.

**Acceptance:** The drawer passes keyboard and accessibility-tree inspection and preserves timeline context.

## Epic 15: Refresh and Administration

- [ ] Implement manual refresh preflight.
- [ ] Preserve the active snapshot during every refresh state.
- [ ] Implement ambiguous-root refresh configuration.
- [ ] Implement refresh retry and cancellation endpoints.
- [ ] Implement failed-refresh messaging and retained-snapshot evidence.
- [ ] Implement protected permanent deletion.
- [ ] Invalidate leases before cascading deletion.
- [ ] Test force push, default-branch change, concurrent refresh, failure, retry, activation, rollback, and deletion races.

**Acceptance:** Failed refresh and deletion race tests cannot corrupt or resurrect repository data.

## Epic 16: Production Operations

- [ ] Provision production PostgreSQL.
- [ ] Deploy independent web and worker processes.
- [ ] Configure GitHub App secrets and token handling.
- [ ] Configure worker concurrency, leases, limits, throttles, and retention.
- [x] Add public web health and protected worker health.
- [ ] Add structured error logging and queue-lag monitoring.
- [ ] Measure GitHub request budget for fixture sizes and showcase import.
- [ ] Write worker interruption, stuck-job, rate-limit, rollback, and deletion recovery procedures.
- [ ] Exercise procedures in production-like conditions.

**Acceptance:** Restarting either process does not lose a run, and health data distinguishes web, database, worker, and queue failures.

## Epic 17: End-to-End and Accessibility Verification

- [ ] E2E import a single-root fixture.
- [ ] E2E configure an ambiguous monorepo fixture.
- [ ] E2E observe interruption and recovery.
- [ ] E2E trace route and dependency events to commit evidence.
- [ ] E2E refresh successfully and fail a refresh while retaining old data.
- [ ] Run automated accessibility checks on import, processing, overview, timeline, and commit views.
- [ ] Manually verify keyboard order, focus, drawer semantics, status announcements, reduced motion, 200% zoom, and 320 CSS-pixel reflow.
- [ ] Run responsive checks for long untrusted content.

**Acceptance:** The complete supported flow passes the documented quality gate with recorded evidence.

## Epic 18: Portfolio Case Study

- [ ] Select one real public Next.js showcase repository within limits.
- [ ] Import and refresh it in production.
- [ ] Explain the primary-user choice and removed scope.
- [ ] Document first-parent and completeness semantics.
- [ ] Diagram web, worker, PostgreSQL, and GitHub boundaries.
- [ ] Explain leases, retries, warnings, staged activation, and retention.
- [ ] Link claims to tests, code, deployed behavior, or measurements.
- [ ] Publish known limitations without implying future features exist.

**Acceptance:** An evaluator can inspect product judgment and engineering evidence without running the project locally.

## First Ten Tickets

1. [ ] Initialize web and worker TypeScript entry points.
2. [ ] Configure PostgreSQL migrations and integration-test database.
3. [ ] Add shared status, step, category, event, and error contracts.
4. [ ] Create foundational Git fixtures and expected outputs.
5. [ ] Implement repository, run, and job schema constraints.
6. [ ] Implement atomic job claim and competing-worker test.
7. [ ] Implement heartbeat, lease expiry, and recovery test.
8. [ ] Implement GitHub App client and typed response validation.
9. [ ] Implement complete-tree and first-parent preflight.
10. [ ] Implement canonical import deduplication and concurrency test.
