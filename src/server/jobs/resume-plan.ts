import { RepoReplayError } from "@/server/github/errors";

const runStages = [
  "DISCOVER_HISTORY",
  "FETCH_COMMITS",
  "CLASSIFY_COMMITS",
  "DETECT_DEPENDENCIES",
  "DETECT_ROUTES",
  "VALIDATE_RUN",
  "ACTIVATE_RUN",
] as const;

export interface RunResumePlan {
  fetchCommits: boolean;
  classifyCommits: boolean;
  detectDependencies: boolean;
  detectRoutes: boolean;
  validateRun: boolean;
  activateRun: boolean;
}

export function getRunResumePlan(currentStep: string): RunResumePlan {
  const currentStage = runStages.indexOf(currentStep as (typeof runStages)[number]);
  if (currentStage < 0) {
    throw new RepoReplayError("PROCESSING_FAILED", "Run has an unsupported processing checkpoint.", { currentStep });
  }

  const isBeforeOrAt = (stage: (typeof runStages)[number]) => currentStage <= runStages.indexOf(stage);
  return {
    fetchCommits: isBeforeOrAt("FETCH_COMMITS"),
    classifyCommits: isBeforeOrAt("CLASSIFY_COMMITS"),
    detectDependencies: isBeforeOrAt("DETECT_DEPENDENCIES"),
    detectRoutes: isBeforeOrAt("DETECT_ROUTES"),
    validateRun: isBeforeOrAt("VALIDATE_RUN"),
    activateRun: currentStep === "ACTIVATE_RUN",
  };
}
