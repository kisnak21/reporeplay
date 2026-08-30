# RepoReplay

> Trace how a Next.js application evolved.

RepoReplay is a portfolio-grade explorer for public Next.js repositories. It processes complete first-parent history within configured safety limits and presents evidence-based route, dependency, commit, and file transitions.

RepoReplay does not infer intent, generate milestones, or claim to explain a semantic project story. Every result links back to observable GitHub data.

## Primary User and Job

The first release serves a new contributor approaching an unfamiliar Next.js repository.

The core job is:

> Show when routes and declared dependencies appeared, changed, or disappeared, and identify the responsible commits without requiring the user to inspect the full Git log manually.

## MVP Workflow

```text
Public GitHub URL
  -> preflight validation
  -> Next.js app-root discovery
  -> app-root selection when ambiguous
  -> durable background processing
  -> atomic snapshot activation
  -> repository overview and evolution timeline
  -> commit evidence drawer
```

## MVP Scope

The MVP includes:

- public GitHub repositories through a server-side GitHub App
- Next.js App Router and Pages Router projects
- `app`, `src/app`, `pages`, and `src/pages`
- one selected Next.js app root per repository
- complete first-parent history up to configurable limits
- PostgreSQL-backed jobs with leases, heartbeats, retries, and recovery
- commit metadata and changed-file evidence
- `package.json` declaration changes
- route additions and removals
- explicit Conventional Commit classification
- cursor-paginated timeline filtering
- manual refresh with staged, atomic activation
- structured coverage warnings
- stable shareable repository URLs
- production web and worker processes
- a public engineering case study

The MVP excludes:

- partial or sampled history
- private repositories and visitor accounts
- semantic milestones or generated stories
- arbitrary commit comparison
- architecture or dependency graphs
- a separate analytics dashboard
- contributor analytics or email-derived identity
- lockfile analysis
- multiple app roots in one view
- inferred categories from changed paths
- AI interpretation
- repository modification

## Processing Limits

Initial defaults:

```text
MAX_FIRST_PARENT_COMMITS=500
MAX_HEAD_FILES=25000
```

The backend owns these values. Preflight responses expose them to the UI. A repository exceeding either limit is rejected before processing; it is never presented as a complete partial import.

## Deployment Topology

```text
Browser -> Next.js web/API -> PostgreSQL <- worker process -> GitHub REST API
```

The worker claims PostgreSQL jobs using expiring leases. A failed refresh does not replace the last successful snapshot. Successful output is activated in one transaction.

## Suggested Stack

- Next.js and TypeScript
- PostgreSQL and Prisma
- GitHub REST API through a GitHub App
- Zod request and environment validation
- TanStack Query for server state
- Vitest, database integration tests, and Playwright

Technology choices remain provisional until the application repository is initialized and current package compatibility is verified.

## Documentation

| Document | Purpose |
|---|---|
| `PRD.md` | Product contract and acceptance criteria |
| `DECISIONS.md` | Settled product and architecture decisions |
| `ARCHITECTURE.md` | Web, worker, ingestion, activation, and recovery design |
| `DATABASE_SCHEMA.md` | Persistence model and invariants |
| `API_SPEC.md` | REST contracts and errors |
| `UX_FLOW.md` | Screens, states, and accessibility behavior |
| `ROADMAP.md` | Risk-ordered delivery phases |
| `TASKS.md` | Testable engineering work |

## Definition of Done

RepoReplay is complete when a reviewer can:

1. import a supported public Next.js repository within configured limits;
2. resolve an ambiguous app root;
3. observe a worker resume safely after interruption;
4. browse the complete first-parent history through a cursor-paginated timeline;
5. trace route and dependency transitions to commit and file evidence;
6. see detector versions, analyzed head SHA, timestamps, limits, and warnings;
7. refresh without losing the last successful snapshot;
8. use the deployed interface at mobile and desktop sizes with keyboard-only operation; and
9. inspect automated evidence from detector fixtures, database integration tests, worker recovery tests, API contract tests, and one end-to-end import.
