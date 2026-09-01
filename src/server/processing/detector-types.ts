import type { FirstParentCommit } from "@/server/processing/first-parent";

export const dependencyGroups = [
  { manifestKey: "dependencies", databaseValue: "DEPENDENCY" },
  { manifestKey: "devDependencies", databaseValue: "DEV_DEPENDENCY" },
  { manifestKey: "peerDependencies", databaseValue: "PEER_DEPENDENCY" },
  { manifestKey: "optionalDependencies", databaseValue: "OPTIONAL_DEPENDENCY" },
] as const;

export type DependencyGroupValue = (typeof dependencyGroups)[number]["databaseValue"];
export type DependencyChangeType = "ADDED" | "REMOVED" | "UPDATED";
export type RouteRouterValue = "APP" | "PAGES";
export type RouteTypeValue = "PAGE" | "API";
export type RouteChangeType = "ADDED" | "REMOVED";
export type DetectorWarningType = "DEPENDENCY" | "ROUTE";

export interface DependencyDetection {
  commitSha: string;
  manifestPath: string;
  packageName: string;
  dependencyGroup: DependencyGroupValue;
  changeType: DependencyChangeType;
  previousValue: string | null;
  currentValue: string | null;
}

export interface RouteDetection {
  commitSha: string;
  router: RouteRouterValue;
  route: string;
  sourcePath: string;
  routeType: RouteTypeValue;
  changeType: RouteChangeType;
}

export interface DetectorWarning {
  commitSha: string | null;
  detector: DetectorWarningType;
  code: string;
  path: string | null;
  message: string;
  detectorVersion: string;
}

export interface DetectorHistoryInput {
  commits: FirstParentCommit[];
  owner: string;
  name: string;
  selectedAppRoot: string;
}
