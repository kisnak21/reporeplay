import { describe, expect, it } from "vitest";
import { detectRouteChanges } from "../../src/server/processing/route-detector";

describe("detectRouteChanges", () => {
  it("normalizes App Router groups and preserves dynamic segments", () => {
    const result = detectRouteChanges({
      commitSha: "head",
      selectedAppRoot: "apps/storefront",
      previousPaths: [],
      currentPaths: [
        "apps/storefront/src/app/(marketing)/account/[id]/page.tsx",
        "apps/storefront/src/app/api/users/route.ts",
        "apps/storefront/src/app/(marketing)/layout.tsx",
        "apps/other/app/ignored/page.tsx",
      ],
    });

    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ router: "APP", route: "/account/[id]", routeType: "PAGE", changeType: "ADDED" }),
      expect.objectContaining({ router: "APP", route: "/api/users", routeType: "API", changeType: "ADDED" }),
    ]));
    expect(result.changes).toHaveLength(2);
    expect(result.warnings).toEqual([]);
  });

  it("handles Pages Router index and API routes, plus removals", () => {
    const result = detectRouteChanges({
      commitSha: "head",
      selectedAppRoot: ".",
      previousPaths: ["pages/index.tsx", "src/pages/api/health.ts", "pages/_app.tsx"],
      currentPaths: ["pages/shop/[slug].tsx", "src/pages/api/health.ts"],
    });

    expect(result.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ route: "/shop/[slug]", router: "PAGES", routeType: "PAGE", changeType: "ADDED" }),
      expect.objectContaining({ route: "/", router: "PAGES", routeType: "PAGE", changeType: "REMOVED" }),
    ]));
    expect(result.changes).toHaveLength(2);
  });

  it("warns for unsupported parallel and intercepting segments", () => {
    const result = detectRouteChanges({
      commitSha: "head",
      selectedAppRoot: ".",
      previousPaths: [],
      currentPaths: ["app/@modal/settings/page.tsx", "app/(..)/login/page.tsx"],
    });

    expect(result.changes).toEqual([]);
    expect(result.warnings.map((warning) => warning.code)).toEqual(["UNSUPPORTED_PARALLEL_ROUTE", "UNSUPPORTED_INTERCEPTING_ROUTE"]);
  });

  it("retains an ambiguity warning when multiple sources map to one public route", () => {
    const result = detectRouteChanges({
      commitSha: "head",
      selectedAppRoot: ".",
      previousPaths: [],
      currentPaths: ["app/(one)/page.tsx", "app/(two)/page.tsx"],
    });

    expect(result.changes).toHaveLength(1);
    expect(result.warnings).toEqual([expect.objectContaining({ code: "AMBIGUOUS_ROUTE_COLLISION", path: "app/(one)/page.tsx, app/(two)/page.tsx" })]);
  });
});
