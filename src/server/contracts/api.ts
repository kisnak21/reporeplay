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
  status: RunStatus;
  step: ProcessingStep;
  processedCommits: number;
  expectedCommits: number;
  attemptCount: number;
  nextAttemptAt: string | null;
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
