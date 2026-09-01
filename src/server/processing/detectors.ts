import type { GitHubRepositorySource } from "@/server/github/source";
import { detectDependencyHistory } from "@/server/processing/dependency-detector";
import { detectRouteChanges } from "@/server/processing/route-detector";
import type { DetectorHistoryInput, DetectorWarning, RouteDetection } from "@/server/processing/detector-types";

interface DetectorHistorySourceInput extends DetectorHistoryInput {
  source: GitHubRepositorySource;
}

export async function detectDependenciesForHistory(input: DetectorHistorySourceInput) {
  return detectDependencyHistory(input);
}

export async function detectRoutesForHistory(input: DetectorHistorySourceInput): Promise<{ changes: RouteDetection[]; warnings: DetectorWarning[] }> {
  const changes: RouteDetection[] = [];
  const warnings: DetectorWarning[] = [];
  let previousPaths: string[] = [];

  for (const commit of input.commits) {
    const tree = await input.source.getTree(input.owner, input.name, commit.treeSha);
    const result = detectRouteChanges({
      commitSha: commit.sha,
      currentPaths: tree.paths,
      previousPaths,
      selectedAppRoot: input.selectedAppRoot,
    });
    changes.push(...result.changes.map((change) => ({ ...change, commitSha: commit.sha })));
    warnings.push(...result.warnings);
    previousPaths = tree.paths;
  }

  return { changes, warnings };
}
