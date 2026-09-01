import type { DetectorWarning, RouteDetection, RouteRouterValue, RouteTypeValue } from "@/server/processing/detector-types";

export const ROUTE_DETECTOR_VERSION = "1";

interface RouteDescriptor {
  router: RouteRouterValue;
  route: string;
  routeType: RouteTypeValue;
  sourcePath: string;
}

export interface RouteDetectorInput {
  commitSha: string;
  currentPaths: string[];
  previousPaths: string[];
  selectedAppRoot: string;
}

const ROUTE_EXTENSIONS = new Set(["js", "jsx", "ts", "tsx"]);
const APP_HANDLER_EXTENSIONS = new Set(["js", "ts"]);
const PAGES_SPECIAL_FILES = new Set(["_app", "_document", "_error"]);

function pathWithinAppRoot(path: string, selectedAppRoot: string): string | null {
  if (selectedAppRoot === ".") return path;
  const prefix = `${selectedAppRoot}/`;
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

function splitFile(path: string): { directories: string[]; basename: string; extension: string } | null {
  const parts = path.split("/");
  const filename = parts.pop();
  if (!filename) return null;
  const match = filename.match(/^(.*)\.([^.]+)$/);
  if (!match) return null;
  return { directories: parts, basename: match[1], extension: match[2].toLowerCase() };
}

function findRouteRoot(path: string): { router: RouteRouterValue; prefixLength: number } | null {
  const parts = path.split("/");
  const root = parts.shift();
  if (root === "app" || root === "pages") return { router: root === "app" ? "APP" : "PAGES", prefixLength: 1 };
  if (root === "src" && parts[0] === "app") return { router: "APP", prefixLength: 2 };
  if (root === "src" && parts[0] === "pages") return { router: "PAGES", prefixLength: 2 };
  return null;
}

function advancedRouteWarning(path: string, commitSha: string): DetectorWarning | null {
  const segments = path.split("/");
  const advancedSegment = segments.find((segment) => segment.startsWith("@") || /^\(\.{1,3}\)/.test(segment));
  if (advancedSegment?.startsWith("@")) {
    return { commitSha, detector: "ROUTE", code: "UNSUPPORTED_PARALLEL_ROUTE", path, message: "Parallel route segments are not interpreted as public route transitions.", detectorVersion: ROUTE_DETECTOR_VERSION };
  }
  if (advancedSegment) {
    return { commitSha, detector: "ROUTE", code: "UNSUPPORTED_INTERCEPTING_ROUTE", path, message: "Intercepting route segments are not interpreted as public route transitions.", detectorVersion: ROUTE_DETECTOR_VERSION };
  }
  return null;
}

function normalizeSegment(segment: string): string | null {
  if (/^\(.+\)$/.test(segment)) return null;
  return segment;
}

function normalizeRoute(router: RouteRouterValue, directories: string[], basename: string): string {
  const normalizedDirectories = directories.flatMap((segment) => {
    const normalized = normalizeSegment(segment);
    return normalized === null ? [] : [normalized];
  });

  if (router === "APP") return normalizedDirectories.length ? `/${normalizedDirectories.join("/")}` : "/";
  const routeSegments = basename === "index" ? normalizedDirectories : [...normalizedDirectories, basename];
  return routeSegments.length ? `/${routeSegments.join("/")}` : "/";
}

function describeRoute(relativePath: string, sourcePath: string, commitSha: string): { descriptor: RouteDescriptor | null; warning: DetectorWarning | null } {
  const split = splitFile(relativePath);
  if (!split) return { descriptor: null, warning: null };
  const routeRoot = findRouteRoot(relativePath);
  if (!routeRoot) return { descriptor: null, warning: null };

  const isAppPage = routeRoot.router === "APP" && split.basename === "page" && ROUTE_EXTENSIONS.has(split.extension);
  const isAppHandler = routeRoot.router === "APP" && split.basename === "route" && APP_HANDLER_EXTENSIONS.has(split.extension);
  const isPagesFile = routeRoot.router === "PAGES" && ROUTE_EXTENSIONS.has(split.extension) && !PAGES_SPECIAL_FILES.has(split.basename);
  if (!isAppPage && !isAppHandler && !isPagesFile) return { descriptor: null, warning: null };

  const warning = advancedRouteWarning(sourcePath, commitSha);
  if (warning) return { descriptor: null, warning };

  const routeDirectories = split.directories.slice(routeRoot.prefixLength);
  const routeType: RouteTypeValue = isAppHandler || (isPagesFile && routeDirectories[0] === "api") ? "API" : "PAGE";
  const route = normalizeRoute(routeRoot.router, routeDirectories, split.basename);
  return { descriptor: { router: routeRoot.router, route, routeType, sourcePath }, warning: null };
}

function routeKey(route: RouteDescriptor): string {
  return `${route.router}|${route.route}|${route.routeType}`;
}

function collectRoutes(paths: string[], selectedAppRoot: string, commitSha: string): { routes: Map<string, RouteDescriptor>; descriptors: RouteDescriptor[]; warnings: DetectorWarning[] } {
  const routes = new Map<string, RouteDescriptor>();
  const descriptors: RouteDescriptor[] = [];
  const warnings: DetectorWarning[] = [];
  for (const path of paths) {
    const relativePath = pathWithinAppRoot(path, selectedAppRoot);
    if (!relativePath) continue;
    const result = describeRoute(relativePath, path, commitSha);
    if (result.warning) warnings.push(result.warning);
    if (result.descriptor) {
      descriptors.push(result.descriptor);
      routes.set(routeKey(result.descriptor), result.descriptor);
    }
  }
  return { routes, descriptors, warnings };
}

function collisionWarnings(routes: RouteDescriptor[], commitSha: string): DetectorWarning[] {
  const byPublicRoute = new Map<string, RouteDescriptor[]>();
  for (const route of routes) {
    const matches = byPublicRoute.get(route.route) ?? [];
    matches.push(route);
    byPublicRoute.set(route.route, matches);
  }

  return [...byPublicRoute.entries()]
    .filter(([, matches]) => new Set(matches.map((match) => match.sourcePath)).size > 1)
    .map(([route, matches]) => ({
      commitSha,
      detector: "ROUTE" as const,
      code: "AMBIGUOUS_ROUTE_COLLISION",
      path: matches.map((match) => match.sourcePath).join(", "),
      message: `Multiple supported route sources resolve to ${route}; the collision is retained as a coverage warning.`,
      detectorVersion: ROUTE_DETECTOR_VERSION,
    }));
}

export function detectRouteChanges(input: RouteDetectorInput): { changes: Omit<RouteDetection, "commitSha">[]; warnings: DetectorWarning[] } {
  const current = collectRoutes(input.currentPaths, input.selectedAppRoot, input.commitSha);
  const previous = collectRoutes(input.previousPaths, input.selectedAppRoot, input.commitSha);
  const changes: Omit<RouteDetection, "commitSha">[] = [];

  for (const [key, route] of current.routes) {
    if (!previous.routes.has(key)) changes.push({ ...route, changeType: "ADDED" });
  }
  for (const [key, route] of previous.routes) {
    if (!current.routes.has(key)) changes.push({ ...route, changeType: "REMOVED" });
  }

  return { changes, warnings: [...current.warnings, ...collisionWarnings(current.descriptors, input.commitSha), ...previous.warnings] };
}
