# RepoReplay UX Flow

## 1. UX Contract

RepoReplay presents evidence, not an inferred narrative. The interface helps a new contributor move from a repository URL to a specific route or dependency transition and then to the responsible commit and files.

Principles:

- disclose first-parent scope, head SHA, app root, and coverage;
- keep the active snapshot available during refresh;
- make unsupported analysis visible near affected output;
- summarize commits before revealing full changed-file evidence;
- preserve filters and timeline position while inspecting a commit;
- never display fake progress or fabricated claims;
- meet WCAG 2.2 AA across the core flow.

## 2. Information Architecture

```text
/
  import and product explanation
/case-study
  engineering decisions and evidence
/repositories/[id]
  overview and evolution timeline
/repositories/[id]/processing/[runId]
  import, configuration, retry, and refresh state
```

Commit details are a route-addressable drawer on desktop and full-screen view on mobile so links remain shareable.

## 3. Landing and Import

Primary content:

```text
Trace how a Next.js application evolved.

[ Public GitHub repository URL                         ]
[ Inspect repository ]

Supports public Next.js repositories with complete
first-parent history within the displayed limits.
```

The page shows current configured limits from `/api/config/limits` before submission. It links to one real showcase repository and the engineering case study.

Import sequence:

1. validate the field locally for immediate feedback;
2. submit preflight;
3. show factual repository metadata, discovered app roots, commit count, and file count;
4. request confirmation or app-root selection;
5. create or reuse the import;
6. navigate to processing status.

The primary button text describes the action. No navigation item points to an unimplemented page.

## 4. Preflight Outcomes

### Supported, single root

```text
owner/repository
Next.js app root: ./
184 first-parent commits
3,210 files at HEAD

[ Process complete history ]
```

### Ambiguous monorepo

```text
Choose one Next.js application to inspect

( ) apps/storefront
( ) apps/admin

[ Process selected application ]
```

Every option includes manifest and route-root evidence. The UI does not guess.

### Oversized

```text
This repository exceeds the current processing limit.

First-parent commits: 812
Current limit: 500

RepoReplay does not create partial histories.
```

### Unsupported

Explain which requirement failed without implying the repository itself is defective. Link back to supported conventions.

## 5. Processing Status

Use step-based progress:

```text
Processing owner/repository

Complete history target: abc1234 on main
App root: apps/web

[x] Discover first-parent history
[>] Fetch commit evidence, 72 of 184
[ ] Classify commits
[ ] Detect dependency transitions
[ ] Detect route transitions
[ ] Validate and activate
```

States:

- `QUEUED`: explain that a worker has not claimed the run;
- `RUNNING`: show current step and durable counts;
- `WAITING_RATE_LIMIT`: show the retry time and saved progress;
- `RETRYABLE`: show next attempt and latest safe error;
- `NEEDS_CONFIGURATION`: show root candidates;
- `FAILED`: show stable error, retained active-snapshot status, and an eligible `Retry run` action;
- `SUCCEEDED`: navigate to the repository or offer an explicit button;
- `CANCELLED`: explain that no staged output was activated.

Do not invent percentages. Poll with bounded backoff and stop on terminal state.

## 6. Repository Overview

Header:

```text
owner / repository
TypeScript | Next.js | app root: apps/web

Complete first-parent history
184 commits | root 1a2b3c4 | head 9d8e7f6
Processed Aug 31, 2026
```

Summary content:

- current route count;
- current declared-dependency count;
- history date range;
- active detector versions;
- GitHub repository link;
- manual refresh action.

These are compact summary facts, not a standalone analytics dashboard.

### Coverage Summary

A prominent summary states either:

```text
Full supported coverage
```

or:

```text
Coverage limitations detected
2 route conventions could not be interpreted.
[Review limitations]
```

Expanded warnings include affected paths or commits and detector version. Use precise terms such as “not interpreted,” not “no route exists.”

### Refresh State

When refreshing, keep the active timeline available and show:

```text
Refreshing from GitHub
You are viewing the previous successful snapshot at 9d8e7f6.
```

On failure:

```text
Refresh failed. The Aug 31 snapshot remains available.
[Review error] [Retry refresh]
```

## 7. Evolution Timeline

The timeline is the primary product surface. Commits appear newest first with cursor-based loading.

Filter controls:

- keyword;
- category;
- file path;
- date range;
- event type.

Filters are represented in the URL and preserved when opening or closing commit details.

Commit summary:

```text
Aug 31, 2026  abc1234  FEATURE
feat: add account page
4 files  +90  -12

Route added: /account
Dependency updated: next 15.4.0 to 15.5.0

[Show file evidence]
```

Unmatched commit messages display `Uncategorized`, never an inferred label.

Changed files are collapsed by default. Expanding them is a real disclosure control with keyboard and screen-reader state.

### Pagination State

“Load older commits” appends the next cursor page. If a refresh activates while browsing and invalidates the cursor, keep current content visible, explain that a newer snapshot is available, and offer to reload from the top.

### Empty and Error States

```text
No commits match these filters.
[Clear filters]
```

A page-load error preserves existing items and offers retry. A confirmed absence of route/dependency transitions is distinguished from detector warnings.

## 8. Commit Evidence

Desktop uses a side drawer; mobile uses a full-screen route. The URL includes the commit SHA.

Sections:

1. message, SHA, author display name, dates, and GitHub link;
2. first-parent relationship and diff statistics;
3. route additions and removals;
4. dependency additions, removals, and updates;
5. complete changed-file evidence;
6. relevant warnings and provenance.

Drawer requirements:

- focus moves to the drawer heading on open;
- focus is trapped while modal behavior is active;
- Escape and a labeled close button dismiss it;
- focus returns to the triggering timeline item;
- browser Back closes a route-addressable drawer correctly;
- no background control remains operable while modal.

## 9. Case Study

The case study explains:

- the narrowed user problem;
- why first-parent history was selected;
- preflight and completeness guarantees;
- PostgreSQL lease and recovery design;
- staged activation and failed-refresh behavior;
- detector scope and limitations;
- test evidence and production topology;
- one real showcase repository.

Claims link to verifiable artifacts. Do not use invented adoption, performance, compliance, or reliability statistics.

## 10. Responsive Behavior

Support reflow from 320 CSS pixels upward.

- no horizontal page scrolling at 320 CSS pixels or 200% zoom;
- filters collapse into an accessible disclosure or sheet;
- timeline metadata wraps without clipping;
- commit evidence becomes a full-screen page on narrow viewports;
- controls provide at least 44 by 44 CSS-pixel pointer targets where applicable;
- long repository names, paths, SHAs, and package declarations wrap or scroll within their own labeled code region.

## 11. Accessibility Acceptance

- semantic headings and landmarks;
- visible skip link;
- logical keyboard order;
- all controls operable by keyboard;
- visible focus indicators;
- AA text and non-text contrast;
- status updates announced without stealing focus;
- form errors associated with fields and summarized after submission;
- drawer name, role, state, focus management, and Escape behavior verified;
- reduced-motion preference respected;
- color never carries change meaning alone;
- route/dependency symbols include text labels;
- loading, empty, warning, error, and success states are distinguishable to assistive technology.

Automated checks do not replace manual keyboard, zoom/reflow, and accessibility-tree inspection.

## 12. Component Inventory

```text
RepositoryImportForm
PreflightSummary
AppRootSelector
ProcessingStatus
RepositoryHeader
CoverageSummary
RefreshStatus
TimelineFilters
EvolutionTimeline
CommitSummary
ChangedFileDisclosure
CommitEvidenceDrawer
DependencyChangeList
RouteChangeList
WarningList
CaseStudyEvidence
```

Every interactive component requires loading, disabled, error, focus, and completion behavior where relevant.
