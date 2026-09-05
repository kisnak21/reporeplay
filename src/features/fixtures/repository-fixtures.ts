import type { CommitEvidence, PreflightResult, ProcessingRunView, PublicLimits, RepositoryDetail } from "@/server/contracts/api";

export const publicLimits: PublicLimits = {
  maxFirstParentCommits: 500,
  maxHeadFiles: 25_000,
  timelineDefaultLimit: 30,
  timelineMaxLimit: 100,
};

export const preflightFixture: PreflightResult = {
  repository: { externalId: "github-1842", fullName: "acme/ledger", defaultBranch: "main", headSha: "9d8e7f6" },
  firstParentCommitCount: 184,
  headFileCount: 3_210,
  appRootCandidates: [
    { path: "apps/storefront", manifestPath: "apps/storefront/package.json", routeRoots: ["src/app"], routeFileCount: 14 },
    { path: "apps/admin", manifestPath: "apps/admin/package.json", routeRoots: ["pages"], routeFileCount: 9 },
  ],
  limits: { maxFirstParentCommits: 500, maxHeadFiles: 25_000 },
  preflightToken: "fixture-preflight-token",
};

export const processingFixture: ProcessingRunView = {
  id: "run-demo",
  status: "RUNNING",
  step: "FETCH_COMMITS",
  fetchedCommits: 72,
  processedCommits: 72,
  expectedCommits: 184,
  worker: { status: "HEALTHY", lastHeartbeatAt: "2026-08-31T09:45:00Z", heartbeatAgeSeconds: 4 },
  attemptCount: 1,
  nextAttemptAt: null,
  appRootCandidates: [],
};

export const repositoryFixture: RepositoryDetail = {
  id: "demo",
  owner: "acme",
  name: "ledger",
  description: "A public Next.js storefront used to demonstrate evidence-based repository evolution.",
  canonicalUrl: "https://github.com/acme/ledger",
  primaryLanguage: "TypeScript",
  stars: 42,
  defaultBranch: "main",
  selectedAppRoot: "apps/storefront",
  availability: "READY",
  snapshot: {
    runId: "run-demo",
    rootSha: "1a2b3c4",
    headSha: "9d8e7f6",
    firstParentCommitCount: 184,
    firstCommitAt: "2024-01-12T09:00:00Z",
    lastCommitAt: "2026-08-31T09:42:00Z",
    processedAt: "2026-08-31T09:46:00Z",
    routeCount: 14,
    dependencyCount: 37,
    versions: { schema: "1", classifier: "1", dependencyDetector: "1", routeDetector: "1" },
    warnings: [{ code: "UNSUPPORTED_INTERCEPTING_ROUTE", message: "Parallel and intercepting routes are not interpreted as public route transitions.", path: "src/app/@modal/(.)photo/[id]/page.tsx", detectorVersion: "1" }],
  },
};

export const commitsFixture: CommitEvidence[] = [
  {
    sha: "9d8e7f6f03d2", shortSha: "9d8e7f6", firstParentSha: "30cd8fe", message: "feat: add account page", authorName: "Alex Morgan", committedAt: "2026-08-31T09:42:00Z", category: "FEATURE", categorySource: "CONVENTIONAL_COMMIT", externalUrl: "https://github.com/acme/ledger", statistics: { changedFiles: 4, additions: 90, deletions: 12 },
    routeChanges: [{ type: "ADDED", route: "/account", sourcePath: "apps/storefront/src/app/account/page.tsx" }],
    dependencyChanges: [{ type: "UPDATED", packageName: "next", previousValue: "15.4.0", currentValue: "15.5.0", manifestPath: "apps/storefront/package.json" }],
    files: [{ status: "ADDED", path: "apps/storefront/src/app/account/page.tsx", additions: 72, deletions: 0 }, { status: "MODIFIED", path: "apps/storefront/package.json", additions: 1, deletions: 1 }, { status: "MODIFIED", path: "apps/storefront/src/components/nav.tsx", additions: 8, deletions: 6 }, { status: "MODIFIED", path: "pnpm-lock.yaml", additions: 9, deletions: 5 }], warnings: [],
  },
  {
    sha: "5c7a103d91a4", shortSha: "5c7a103", firstParentSha: "9b2d211", message: "remove retired billing route", authorName: "Sam Lee", committedAt: "2026-08-18T14:20:00Z", category: "UNCATEGORIZED", categorySource: "NONE", externalUrl: "https://github.com/acme/ledger", statistics: { changedFiles: 3, additions: 8, deletions: 147 }, routeChanges: [{ type: "REMOVED", route: "/billing/legacy", sourcePath: "apps/storefront/src/app/billing/legacy/page.tsx" }], dependencyChanges: [], files: [{ status: "REMOVED", path: "apps/storefront/src/app/billing/legacy/page.tsx", additions: 0, deletions: 120 }, { status: "MODIFIED", path: "apps/storefront/src/app/billing/page.tsx", additions: 5, deletions: 20 }, { status: "MODIFIED", path: "apps/storefront/src/components/billing-nav.tsx", additions: 3, deletions: 7 }], warnings: [],
  },
  {
    sha: "8f103bc188b0", shortSha: "8f103bc", firstParentSha: "41a002c", message: "build: replace date utility", authorName: "Alex Morgan", committedAt: "2026-08-02T11:05:00Z", category: "BUILD", categorySource: "CONVENTIONAL_COMMIT", externalUrl: "https://github.com/acme/ledger", statistics: { changedFiles: 2, additions: 11, deletions: 9 }, routeChanges: [], dependencyChanges: [{ type: "ADDED", packageName: "date-fns", currentValue: "4.1.0", manifestPath: "apps/storefront/package.json" }, { type: "REMOVED", packageName: "dayjs", previousValue: "1.11.13", manifestPath: "apps/storefront/package.json" }], files: [{ status: "MODIFIED", path: "apps/storefront/package.json", additions: 2, deletions: 2 }, { status: "MODIFIED", path: "pnpm-lock.yaml", additions: 9, deletions: 7 }], warnings: [],
  },
];

export async function getFixtureRepository(): Promise<RepositoryDetail> { return repositoryFixture; }
export async function getFixtureCommits(): Promise<CommitEvidence[]> { return commitsFixture; }
export async function getFixtureCommit(shortSha: string): Promise<CommitEvidence | undefined> { return commitsFixture.find((commit) => commit.shortSha === shortSha); }
