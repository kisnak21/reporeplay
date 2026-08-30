# RepoReplay Decisions

This record captures settled MVP decisions. Changing one requires updating every affected contract, schema, API, UX flow, roadmap phase, and task.

## ADR-001: Portfolio Product

**Decision:** RepoReplay is a portfolio project demonstrating balanced full-stack judgment, weighted toward backend and data engineering.

**Consequence:** Correctness, recovery, observability, and a written engineering case study outrank feature breadth or monetization.

## ADR-002: Primary User

**Decision:** The primary user is a new contributor approaching an unfamiliar Next.js repository.

**Core outcome:** Trace route and declared-dependency evolution to responsible commits.

**Rejected:** A single MVP for maintainers, recruiters, portfolio authors, and general Git browsing.

## ADR-003: Evidence-Based Positioning

**Decision:** Describe output as an evolution timeline, not an automatically generated story or set of major moments.

**Reason:** Deterministic metadata, paths, trees, and manifests provide evidence but do not establish intent or importance.

## ADR-004: Public GitHub and Next.js Only

**Decision:** Accept public GitHub repositories containing a supported Next.js app. Use GitHub REST through a server-side GitHub App.

**Rejected:** Visitor OAuth, private repositories, unauthenticated production API access, and reduced-functionality support for arbitrary repositories.

## ADR-005: One App Root

**Decision:** Analyze one detected Next.js app root per repository. If multiple roots are found, pause in `NEEDS_CONFIGURATION` and require selection from discovered candidates.

**Supported roots:** `app`, `src/app`, `pages`, and `src/pages`, relative to the selected app root.

## ADR-006: Complete First-Parent History

**Decision:** Process the default branch's complete first-parent chain within configured limits. Merge commits use first-parent diffs.

**Reason:** This yields a coherent mainline history and deterministic adjacent transitions.

**Rejected:** Full graph traversal, newest-N truncation, sampling, and undisclosed partial history.

## ADR-007: Reject Oversized Repositories

**Decision:** Preflight rejects repositories exceeding configurable limits. Initial defaults are 500 first-parent commits and 25,000 files at HEAD.

**Reason:** Partial imports would undermine completeness claims.

## ADR-008: PostgreSQL Durable Jobs

**Decision:** Run ingestion in a separate worker process using PostgreSQL jobs with atomic claims, expiring leases, heartbeats, checkpoints, bounded retries, and scheduled rate-limit recovery.

**Rejected:** Work in server actions or route handlers; Redis/BullMQ for MVP.

## ADR-009: Staged Runs and Atomic Activation

**Decision:** All imported output belongs to a processing run. A successful run is activated in one transaction. The active run plus one previous successful run are retained.

**Reason:** Readers never observe partial output, and refresh failure cannot destroy a usable snapshot.

## ADR-010: Manual Refresh

**Decision:** Repository history refresh is user-triggered. The UI displays active head SHA, processing timestamp, and latest refresh state.

**Consequence:** No scheduler or repository monitoring in MVP.

## ADR-011: Transition Storage

**Decision:** Store commit metadata, first-parent changed-file evidence, and route/dependency transitions. Do not store every full historical tree after processing.

**Reason:** The narrowed product needs event traceability, not arbitrary historical state queries.

## ADR-012: Route Detection

**Decision:** Build route sets from complete Git trees at adjacent commits and store only `ADDED` and `REMOVED` transitions.

**Consequence:** Editing an existing route file is only a file event. Unsupported advanced conventions create structured warnings.

## ADR-013: Dependency Detection

**Decision:** Compare `package.json` declarations inside the selected app root. Record manifest path and dependency group.

**Rejected:** Lockfile resolution analysis, transitive dependencies, and manifests outside the selected app.

## ADR-014: Explicit Classification Only

**Decision:** Parse recognized Conventional Commit prefixes. Unmatched commits are `UNCATEGORIZED`.

**Rejected:** Inferring feature intent from file paths or automatically adding route/dependency categories.

## ADR-015: Independent Version Provenance

**Decision:** Persist schema, classifier, route-detector, and dependency-detector versions on each processing run.

**Reason:** Results must be reproducible and selectively rebuildable.

## ADR-016: Anonymous but Protected Imports

**Decision:** Do not require visitor accounts. Protect import and refresh with IP throttling, global concurrency limits, canonical repository deduplication, and one nonterminal run per repository.

## ADR-017: No Email-Derived Identity

**Decision:** Store author display names supplied by commits, but no raw or hashed author email.

**Reason:** Contributor identity and analytics are outside the core job.

## ADR-018: REST and Cursor Pagination

**Decision:** Expose explicit REST contracts and cursor-paginate the timeline.

**Reason:** Job state, retries, warnings, and stable external inspection are clearer than hidden server actions; cursor pagination is stable under large histories.

## ADR-019: Narrow UI

**Decision:** MVP surfaces are case study, import/status/configuration, repository overview, evolution timeline, and commit drawer.

**Rejected:** Compare, architecture, separate analytics, and contributor pages.

## ADR-020: Coverage Is Visible

**Decision:** Structured warnings appear in the repository coverage summary and next to affected results. Absence of a detected event must not imply unsupported behavior did not occur.

## ADR-021: Production Is Part of Done

**Decision:** Completion requires deployed web and worker processes, health checks, documented job recovery, and one real showcase import.

## ADR-022: Accessibility Is an Acceptance Criterion

**Decision:** Target WCAG 2.2 AA throughout implementation, including keyboard operation, focus, contrast, reduced motion, zoom, and responsive reflow.

## ADR-023: Administrative Deletion

**Decision:** A protected operation can cancel jobs and permanently delete a repository and all associated data.

## ADR-024: Deferred Features Are Removed from MVP Contracts

The following are not placeholders in current APIs or schema:

- arbitrary comparison;
- architecture graphs;
- analytics dashboard;
- contributor analytics;
- semantic milestones;
- AI summaries;
- lockfile analysis;
- private repositories;
- multi-app combined views.
