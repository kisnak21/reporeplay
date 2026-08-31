import type { GitHubRepositorySource } from "./source";

export interface AppRootCandidateInput {
  path: string;
  manifestPath: string;
  routeRoots: string[];
  routeFileCount: number;
}

const ROUTE_ROOTS = ["app", "src/app", "pages", "src/pages"];

function normalizeDir(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}

function hasRouteFiles(paths: Set<string>, dir: string): { roots: string[]; count: number } {
  const roots: string[] = [];
  let count = 0;
  for (const root of ROUTE_ROOTS) {
    const prefix = dir ? `${dir}/${root}/` : `${root}/`;
    const matches = [...paths].filter((p) => p.startsWith(prefix) && (p.endsWith("/page.tsx") || p.endsWith("/page.jsx") || p.endsWith("/page.js") || p.endsWith("/page.ts") || p.endsWith("/route.ts") || p.endsWith("/route.js")));
    if (matches.length) {
      roots.push(root);
      count += matches.length;
    }
  }
  return { roots, count };
}

export async function discoverAppRoots(
  source: GitHubRepositorySource,
  owner: string,
  name: string,
  headSha: string,
  treePaths: string[],
): Promise<AppRootCandidateInput[]> {
  const pathsSet = new Set(treePaths);
  const candidates: AppRootCandidateInput[] = [];
  const manifestPaths = treePaths.filter((p) => p.endsWith("package.json"));
  for (const manifestPath of manifestPaths) {
    const content = await source.getFile(owner, name, manifestPath, headSha);
    if (!content) continue;
    let json: unknown;
    try {
      json = JSON.parse(content);
    } catch {
      continue;
    }
    const deps = (json as Record<string, unknown>).dependencies as Record<string, string> | undefined;
    const devDeps = (json as Record<string, unknown>).devDependencies as Record<string, string> | undefined;
    const hasNext = Boolean(deps?.next || devDeps?.next);
    if (!hasNext) continue;
    const dir = normalizeDir(manifestPath);
    const { roots, count } = hasRouteFiles(pathsSet, dir);
    if (roots.length === 0) continue;
    candidates.push({ path: dir || ".", manifestPath, routeRoots: roots, routeFileCount: count });
  }
  return candidates.sort((a, b) => a.path.localeCompare(b.path));
}
