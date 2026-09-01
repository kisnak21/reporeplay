import type { CommitCategory, ProcessingStep, RepositoryAvailability, RunStatus } from "./processing";

export interface PublicLimits {
  maxFirstParentCommits: number;
  maxHeadFiles: number;
  timelineDefaultLimit: number;
  timelineMaxLimit: number;
}

export interface AppRootCandidate {
  path: string;
  manifestPath: string;
  routeRoots: string[];
  routeFileCount: number;
}

export interface PreflightResult {
  repository: { externalId: string; fullName: string; defaultBranch: string; headSha: string };
  firstParentCommitCount: number;
  headFileCount: number;
  appRootCandidates: AppRootCandidate[];
  limits: Pick<PublicLimits, "maxFirstParentCommits" | "maxHeadFiles">;
  preflightToken: string;
}

export interface CoverageWarning {
  code: string;
  message: string;
  path?: string;
  detectorVersion: string;
}

export interface ProcessingRunView {
  id: string;
  kind?: "IMPORT" | "REFRESH";
  status: RunStatus;
  step: ProcessingStep;
  processedCommits: number;
  expectedCommits: number | null;
  attemptCount: number;
  nextAttemptAt: string | null;
  warnings?: CoverageWarning[];
  error?: { code: string; message: string | null } | null;
}

export interface RepositoryDetail {
  id: string;
  owner: string;
  name: string;
  description: string;
  canonicalUrl: string;
  primaryLanguage: string;
  stars: number;
  defaultBranch: string;
  selectedAppRoot: string;
  availability: RepositoryAvailability;
  snapshot: {
    runId: string;
    rootSha: string;
    headSha: string;
    firstParentCommitCount: number;
    firstCommitAt: string;
    lastCommitAt: string;
    processedAt: string;
    routeCount: number;
    dependencyCount: number;
    versions: { schema: string; classifier: string; dependencyDetector: string; routeDetector: string };
    warnings: CoverageWarning[];
  };
}

export interface DiffStatistics { changedFiles: number; additions: number; deletions: number }
export interface RouteChange { type: "ADDED" | "REMOVED"; route: string; sourcePath: string }
export interface DependencyChange { type: "ADDED" | "REMOVED" | "UPDATED"; packageName: string; previousValue?: string; currentValue?: string; manifestPath: string }
export interface ChangedFile { status: "ADDED" | "MODIFIED" | "REMOVED" | "RENAMED"; path: string; additions: number; deletions: number }

export interface CommitSummary {
  sha: string;
  shortSha: string;
  message: string;
  authorName: string;
  committedAt: string;
  category: CommitCategory;
  statistics: DiffStatistics;
  routeChanges: RouteChange[];
  dependencyChanges: DependencyChange[];
  files: ChangedFile[];
}

export interface CommitEvidence extends CommitSummary {
  firstParentSha: string;
  externalUrl: string;
  categorySource: "CONVENTIONAL_COMMIT" | "NONE";
  warnings: CoverageWarning[];
}

export interface TimelineEventSummary {
  routesAdded: number;
  routesRemoved: number;
  dependenciesAdded: number;
  dependenciesRemoved: number;
  dependenciesUpdated: number;
}

export interface TimelineItem {
  sha: string;
  shortSha: string;
  message: string;
  authorName: string | null;
  committedAt: string;
  statistics: DiffStatistics;
  category: CommitCategory;
  eventSummary: TimelineEventSummary;
  warnings: CoverageWarning[];
}

export interface CommitDetail {
  snapshot: { runId: string };
  sha: string;
  shortSha: string;
  firstParentSha: string | null;
  message: string;
  authorName: string | null;
  authoredAt: string | null;
  committedAt: string;
  statistics: DiffStatistics;
  category: { value: CommitCategory; source: "CONVENTIONAL_COMMIT" | "NONE" };
  files: Array<{ path: string; previousPath: string | null; status: ChangedFile["status"]; additions: number; deletions: number; changes: number }>;
  dependencyChanges: Array<{ manifestPath: string; packageName: string; dependencyGroup: string; changeType: DependencyChange["type"]; previousValue: string | null; currentValue: string | null }>;
  routeChanges: Array<{ router: string; route: string; sourcePath: string; routeType: string; changeType: RouteChange["type"] }>;
  warnings: CoverageWarning[];
  externalUrl: string;
}
