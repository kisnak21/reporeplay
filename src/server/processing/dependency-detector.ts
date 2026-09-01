import type { GitHubRepositorySource } from "@/server/github/source";
import { dependencyGroups, type DependencyDetection, type DetectorWarning, type DetectorHistoryInput } from "@/server/processing/detector-types";

export const DEPENDENCY_DETECTOR_VERSION = "1";

interface DependencyDetectorInput extends DetectorHistoryInput {
  source: GitHubRepositorySource;
}

interface ManifestCandidate {
  currentPath: string | null;
  previousPath: string | null;
  manifestPath: string;
}

interface ManifestSnapshot {
  groups: Map<string, Map<string, string>>;
  malformed: boolean;
}

function isPackageManifest(path: string, appRoot: string): boolean {
  const rootPrefix = appRoot === "." ? "" : `${appRoot}/`;
  return path === `${rootPrefix}package.json`;
}

function getManifestCandidates(commit: DependencyDetectorInput["commits"][number], appRoot: string): ManifestCandidate[] {
  const candidates = new Map<string, ManifestCandidate>();

  for (const file of commit.files) {
    const currentPath = isPackageManifest(file.path, appRoot) ? file.path : null;
    const previousPath = file.previousPath && isPackageManifest(file.previousPath, appRoot)
      ? file.previousPath
      : currentPath;
    if (!currentPath && !previousPath) continue;

    const manifestPath = currentPath ?? previousPath;
    if (!manifestPath) continue;
    candidates.set(manifestPath, { currentPath, previousPath, manifestPath });
  }

  return [...candidates.values()];
}

function parseManifestContent(content: string | null, path: string, commitSha: string, side: "current" | "previous"): { snapshot: ManifestSnapshot; warning: DetectorWarning | null } {
  if (content === null) return { snapshot: { groups: new Map(), malformed: false }, warning: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return {
      snapshot: { groups: new Map(), malformed: true },
      warning: {
        commitSha,
        detector: "DEPENDENCY",
        code: "MALFORMED_MANIFEST",
        path,
        message: `The ${side} package.json could not be parsed, so dependency transitions for this manifest were withheld.`,
        detectorVersion: DEPENDENCY_DETECTOR_VERSION,
      },
    };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      snapshot: { groups: new Map(), malformed: true },
      warning: {
        commitSha,
        detector: "DEPENDENCY",
        code: "MALFORMED_MANIFEST",
        path,
        message: `The ${side} package.json does not contain a JSON object, so dependency transitions for this manifest were withheld.`,
        detectorVersion: DEPENDENCY_DETECTOR_VERSION,
      },
    };
  }

  const record = parsed as Record<string, unknown>;
  const groups = new Map<string, Map<string, string>>();
  for (const group of dependencyGroups) {
    const section = record[group.manifestKey];
    if (section === undefined) continue;
    if (!section || typeof section !== "object" || Array.isArray(section)) {
      return {
        snapshot: { groups: new Map(), malformed: true },
        warning: {
          commitSha,
          detector: "DEPENDENCY",
          code: "MALFORMED_MANIFEST",
          path,
          message: `The ${side} package.json has an invalid ${group.manifestKey} section, so dependency transitions for this manifest were withheld.`,
          detectorVersion: DEPENDENCY_DETECTOR_VERSION,
        },
      };
    }

    const values = new Map<string, string>();
    for (const [packageName, value] of Object.entries(section)) {
      if (typeof value === "string") values.set(packageName, value);
    }
    groups.set(group.databaseValue, values);
  }

  return { snapshot: { groups, malformed: false }, warning: null };
}

function compareManifests(commitSha: string, manifestPath: string, previous: ManifestSnapshot, current: ManifestSnapshot): DependencyDetection[] {
  if (previous.malformed || current.malformed) return [];

  const changes: DependencyDetection[] = [];
  for (const group of dependencyGroups) {
    const oldValues = previous.groups.get(group.databaseValue) ?? new Map<string, string>();
    const newValues = current.groups.get(group.databaseValue) ?? new Map<string, string>();
    const packageNames = new Set([...oldValues.keys(), ...newValues.keys()]);

    for (const packageName of packageNames) {
      const previousValue = oldValues.get(packageName) ?? null;
      const currentValue = newValues.get(packageName) ?? null;
      if (previousValue === null && currentValue === null) continue;
      if (previousValue === currentValue) continue;

      const changeType: DependencyDetection["changeType"] = previousValue === null
        ? "ADDED"
        : currentValue === null
          ? "REMOVED"
          : "UPDATED";
      changes.push({ commitSha, manifestPath, packageName, dependencyGroup: group.databaseValue, changeType, previousValue, currentValue });
    }
  }
  return changes;
}

async function detectManifest(input: DependencyDetectorInput, commit: DependencyDetectorInput["commits"][number], candidate: ManifestCandidate): Promise<{ changes: DependencyDetection[]; warnings: DetectorWarning[] }> {
  const currentContent = candidate.currentPath
    ? await input.source.getFile(input.owner, input.name, candidate.currentPath, commit.sha)
    : null;
  const previousContent = commit.firstParentSha && candidate.previousPath
    ? await input.source.getFile(input.owner, input.name, candidate.previousPath, commit.firstParentSha)
    : null;
  const current = parseManifestContent(currentContent, candidate.manifestPath, commit.sha, "current");
  const previous = parseManifestContent(previousContent, candidate.manifestPath, commit.sha, "previous");
  const warnings = [current.warning, previous.warning].filter((warning): warning is DetectorWarning => warning !== null);
  return { changes: compareManifests(commit.sha, candidate.manifestPath, previous.snapshot, current.snapshot), warnings };
}

export async function detectDependencyHistory(input: DependencyDetectorInput): Promise<{ changes: DependencyDetection[]; warnings: DetectorWarning[] }> {
  const changes: DependencyDetection[] = [];
  const warnings: DetectorWarning[] = [];

  for (const commit of input.commits) {
    for (const candidate of getManifestCandidates(commit, input.selectedAppRoot)) {
      const result = await detectManifest(input, commit, candidate);
      changes.push(...result.changes);
      warnings.push(...result.warnings);
    }
  }

  return { changes, warnings };
}
