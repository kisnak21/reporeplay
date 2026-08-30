export const repositoryAvailabilities = ["CONFIGURATION_REQUIRED", "PROCESSING", "READY"] as const;
export const runStatuses = ["NEEDS_CONFIGURATION", "QUEUED", "RUNNING", "WAITING_RATE_LIMIT", "RETRYABLE", "SUCCEEDED", "FAILED", "CANCELLED"] as const;
export const processingSteps = ["DISCOVER_HISTORY", "FETCH_COMMITS", "CLASSIFY_COMMITS", "DETECT_DEPENDENCIES", "DETECT_ROUTES", "VALIDATE_RUN", "ACTIVATE_RUN", "COMPLETE"] as const;
export const commitCategories = ["FEATURE", "FIX", "REFACTOR", "DOCS", "TEST", "STYLE", "BUILD", "CHORE", "PERFORMANCE", "CI", "REVERT", "UNCATEGORIZED"] as const;
export const dependencyChangeTypes = ["ADDED", "REMOVED", "UPDATED"] as const;
export const routeChangeTypes = ["ADDED", "REMOVED"] as const;

export type RepositoryAvailability = (typeof repositoryAvailabilities)[number];
export type RunStatus = (typeof runStatuses)[number];
export type ProcessingStep = (typeof processingSteps)[number];
export type CommitCategory = (typeof commitCategories)[number];
