import { expect, test } from "@playwright/test";

const preflightErrorScenarios = [
  { code: "UNSUPPORTED_REPOSITORY", title: "Unsupported Next.js application.", message: "No supported Next.js application found.", recovery: "supported app or pages route root" },
  { code: "REPOSITORY_LIMIT_EXCEEDED", title: "Repository exceeds current limits.", message: "Repository exceeds commit limit.", recovery: "displayed commit and file limits" },
  { code: "GITHUB_DATA_TRUNCATED", title: "GitHub returned incomplete data.", message: "Repository tree is truncated.", recovery: "No partial import was created" },
  { code: "GITHUB_RATE_LIMITED", title: "GitHub rate limit reached.", message: "GitHub rate limit exceeded.", recovery: "recorded reset window" },
] as const;

test("completes the fixture import flow", async ({ page }) => {
  await page.route("**/api/repositories/preflight", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          repository: { externalId: "github-1842", fullName: "acme/ledger", defaultBranch: "main", headSha: "9d8e7f6" },
          firstParentCommitCount: 184,
          headFileCount: 3210,
          appRootCandidates: [
            { path: "apps/storefront", manifestPath: "apps/storefront/package.json", routeRoots: ["src/app"], routeFileCount: 14 },
            { path: "apps/admin", manifestPath: "apps/admin/package.json", routeRoots: ["pages"], routeFileCount: 9 },
          ],
          limits: { maxFirstParentCommits: 500, maxHeadFiles: 25000 },
          preflightToken: "fixture-preflight-token",
        },
      }),
    });
  });
  await page.route("**/api/repositories", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ data: { repositoryId: "demo", runId: "run-demo", status: "QUEUED" } }) });
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "Trace mainline change to source." })).toBeVisible();

  await page.getByRole("button", { name: "Run preflight" }).click();
  await expect(page.getByRole("heading", { name: "Select one application root." })).toBeVisible();
  await page.getByLabel(/apps\/admin/).check();
  await page.getByRole("button", { name: "Queue selected root" }).click();

  await expect(page).toHaveURL(/processing\/run-demo/);
  await expect(page.getByRole("heading", { name: "Processing durable evidence." })).toBeVisible();
  await page.getByRole("button", { name: "Cancel run" }).click();
  await expect(page.getByRole("status")).toContainText("Run cancelled");
  await page.getByRole("button", { name: "Retry run" }).click();
  await page.getByRole("link", { name: "Preview completed run" }).click();

  await expect(page).toHaveURL(/repositories\/demo$/);
  await expect(page.getByRole("heading", { level: 1, name: "acme/ledger" })).toBeVisible();
});

test("validates repository URLs", async ({ page }) => {
  await page.route("**/api/repositories/preflight", async (route) => {
    await route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: { code: "INVALID_REPOSITORY_URL", message: "Enter a public GitHub repository URL in the form github.com/owner/repository." } }) });
  });
  await page.goto("/");
  await page.getByLabel("Public GitHub repository URL").fill("https://example.com/not-github");
  await page.getByRole("button", { name: "Run preflight" }).click();
  await expect(page.locator('[role="alert"]').filter({ hasText: "Invalid repository URL" })).toContainText("Enter a public GitHub repository URL");
});

for (const scenario of preflightErrorScenarios) {
  test(`explains ${scenario.code.toLowerCase()} during preflight`, async ({ page }) => {
    await page.route("**/api/repositories/preflight", async (route) => {
      const status = scenario.code === "GITHUB_RATE_LIMITED" ? 429 : scenario.code === "GITHUB_DATA_TRUNCATED" ? 502 : 422;
      await route.fulfill({ status, contentType: "application/json", body: JSON.stringify({ error: { code: scenario.code, message: scenario.message } }) });
    });
    await page.goto("/");
    await page.getByLabel("Public GitHub repository URL").fill("https://github.com/acme/ledger");
    await page.getByRole("button", { name: "Run preflight" }).click();
    const errorPanel = page.locator('[role="alert"]').filter({ hasText: scenario.title });
    await expect(errorPanel).toContainText(scenario.title);
    await expect(errorPanel).toContainText(scenario.message);
    await expect(errorPanel).toContainText(scenario.recovery);
    await expect(errorPanel).toContainText(scenario.code);
    await expect(page.getByLabel("Public GitHub repository URL")).toHaveAttribute("aria-invalid", "true");
  });
}

test("retries a failed run without creating a new import", async ({ page }) => {
  let retryQueued = false;
  let retryRequests = 0;
  let importRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/repositories")) importRequests += 1;
  });
  await page.route("**/api/repositories/retry-repository/runs/retry-run", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: retryQueued ? { id: "retry-run", kind: "REFRESH", status: "QUEUED", step: "DISCOVER_HISTORY", fetchedCommits: 0, processedCommits: 0, expectedCommits: 8, worker: { status: "HEALTHY", lastHeartbeatAt: "2026-09-02T00:00:00Z", heartbeatAgeSeconds: 2 }, attemptCount: 0, nextAttemptAt: null, warnings: [], error: null } : { id: "retry-run", kind: "REFRESH", status: "FAILED", step: "DETECT_ROUTES", fetchedCommits: 8, processedCommits: 8, expectedCommits: 8, worker: { status: "HEALTHY", lastHeartbeatAt: "2026-09-02T00:00:00Z", heartbeatAgeSeconds: 2 }, attemptCount: 4, nextAttemptAt: null, warnings: [], error: { code: "GITHUB_UNAVAILABLE", message: "GitHub is temporarily unavailable." } } }) });
  });
  await page.route("**/api/repositories/retry-repository/runs/retry-run/retry", async (route) => {
    retryRequests += 1;
    retryQueued = true;
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ data: { repositoryId: "retry-repository", runId: "retry-run", status: "QUEUED" } }) });
  });

  await page.goto("/repositories/retry-repository/processing/retry-run");
  await expect(page.getByRole("button", { name: "Retry run" })).toBeVisible();
  const failureAlert = page.locator('[role="alert"]').filter({ hasText: "Refresh failed" });
  await expect(failureAlert).toContainText("Refresh failed");
  await expect(failureAlert).toContainText("GITHUB_UNAVAILABLE");
  await expect(failureAlert).toContainText("previous successful snapshot remains available");
  await page.getByRole("button", { name: "Retry run" }).click();
  await expect(page.getByRole("button", { name: "Cancel run" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Waiting for a worker to claim this run");
  expect(retryRequests).toBe(1);
  expect(importRequests).toBe(0);
});

test("explains a rate-limited processing run", async ({ page }) => {
  await page.route("**/api/repositories/rate-limit-repository/runs/rate-limit-run", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { id: "rate-limit-run", kind: "IMPORT", status: "WAITING_RATE_LIMIT", step: "FETCH_COMMITS", fetchedCommits: 8, processedCommits: 8, expectedCommits: 12, worker: { status: "HEALTHY", lastHeartbeatAt: "2026-09-02T00:00:00Z", heartbeatAgeSeconds: 2 }, attemptCount: 2, nextAttemptAt: "2026-09-02T01:00:00Z", warnings: [], error: { code: "GITHUB_RATE_LIMITED", message: "GitHub rate limit exceeded." } } }) });
  });

  await page.goto("/repositories/rate-limit-repository/processing/rate-limit-run");
  await expect(page.getByRole("status")).toContainText("GitHub rate limit reached");
  await expect(page.getByRole("status")).toContainText("Saved progress is preserved");
  await expect(page.getByText(/next attempt/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Cancel run" })).toBeVisible();
});

test("keeps commit subjects and bodies readable", async ({ page }) => {
  await page.route("**/api/repositories/readability-repo/commits/abc1234", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        data: {
          snapshot: { runId: "readability-run" },
          sha: "abc1234def5678",
          shortSha: "abc1234",
          firstParentSha: null,
          message: "feat: make retry recovery visible\n\nRetry failures without importing the repository again.",
          authorName: "Test author",
          authoredAt: "2026-09-02T00:00:00Z",
          committedAt: "2026-09-02T00:00:00Z",
          statistics: { changedFiles: 1, additions: 12, deletions: 3 },
          category: { value: "FEATURE", source: "CONVENTIONAL_COMMIT" },
          files: [],
          dependencyChanges: [],
          routeChanges: [],
          warnings: [],
          externalUrl: "https://github.com/acme/ledger/commit/abc1234def5678",
        },
      }),
    });
  });

  await page.goto("/repositories/readability-repo/commits/abc1234");
  await expect(page.getByRole("heading", { level: 1, name: "feat: make retry recovery visible" })).toBeVisible();
  await expect(page.getByText("Retry failures without importing the repository again.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).not.toContainText("Retry failures");
});

test("filters timeline and opens commit evidence", async ({ page }) => {
  await page.goto("/repositories/demo");
  await page.getByLabel("Evidence").selectOption("DEPENDENCY");
  await expect(page.getByRole("link", { name: "build: replace date utility" })).toBeVisible();
  await expect(page.getByRole("link", { name: "remove retired billing route" })).toBeHidden();

  await page.getByLabel("Keyword").fill("missing commit");
  await expect(page.getByText("No commits match these filters.")).toBeVisible();
  await page.getByRole("button", { name: "Clear filters" }).click();
  await page.getByRole("link", { name: "feat: add account page" }).click();

  await expect(page).toHaveURL(/commits\/9d8e7f6/);
  await expect(page.getByRole("heading", { level: 1, name: "feat: add account page" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Route evidence" })).toBeVisible();
  await page.getByRole("link", { name: "Close evidence" }).click();
  await expect(page).toHaveURL(/repositories\/demo$/);
});

test("supports keyboard skip navigation", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");
  const skipLink = page.getByRole("link", { name: "Skip to content" });
  await expect(skipLink).toBeFocused();
  await skipLink.press("Enter");
  await expect(page.locator("#main-content")).toBeVisible();
});

test("does not overflow supported fixture pages", async ({ page }) => {
  for (const path of ["/", "/repositories/demo/processing/run-demo", "/repositories/demo", "/repositories/demo/commits/9d8e7f6", "/case-study"]) {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(overflow, `${path} should not overflow`).toBe(false);
  }
});

test("wraps warning paths at mobile width", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto("/repositories/demo");
  await expect(page.getByText("src/app/@modal/(.)photo/[id]/page.tsx", { exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow, "warning path should wrap at 320px").toBe(false);
});

type TimelineLatestRun = {
  id: string;
  status: "NEEDS_CONFIGURATION" | "QUEUED" | "RUNNING" | "WAITING_RATE_LIMIT" | "RETRYABLE" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  kind: "IMPORT" | "REFRESH" | "REPROCESS";
  error: { code: string; message: string | null } | null;
} | null;

function timelineRepositoryPayload(id: string, latestRun: TimelineLatestRun = null) {
  return {
    data: {
      id,
      owner: "acme",
      name: "ledger",
      fullName: "acme/ledger",
      canonicalUrl: "https://github.com/acme/ledger",
      defaultBranch: "main",
      selectedAppRoot: "apps/web",
      availability: "READY",
      activeSnapshot: {
        runId: `run-${id}`,
        rootSha: "aaa1111",
        headSha: "zzz9999",
        firstParentCommitCount: 2,
        firstCommitAt: "2026-09-01T00:00:00Z",
        lastCommitAt: "2026-09-02T00:00:00Z",
        processedAt: "2026-09-02T00:00:00Z",
        routeCount: 1,
        dependencyCount: 1,
        versions: { schema: "1", classifier: "1", dependencyDetector: "1", routeDetector: "1" },
        coverage: { status: "COMPLETE", warnings: [] },
      },
      latestRun,
    },
  };
}

test("starts a manual refresh from the active repository", async ({ page }) => {
  let refreshRequests = 0;
  await page.route("**/api/repositories/refresh-repo**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname.endsWith("/refresh")) {
      refreshRequests += 1;
      await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ data: { repositoryId: "refresh-repo", run: { id: "refresh-run", status: "QUEUED" } } }) });
      return;
    }
    if (url.pathname.endsWith("/runs/refresh-run")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { id: "refresh-run", kind: "REFRESH", status: "QUEUED", step: "DISCOVER_HISTORY", fetchedCommits: 0, processedCommits: 0, expectedCommits: 2, worker: { status: "HEALTHY", lastHeartbeatAt: "2026-09-02T00:00:00Z", heartbeatAgeSeconds: 2 }, attemptCount: 0, nextAttemptAt: null, warnings: [], error: null } }) });
      return;
    }
    if (url.pathname.endsWith("/commits")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(timelinePagePayload("run-refresh-repo", [timelineItemPayload("feat111", "feat: keep active evidence")], null)) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(timelineRepositoryPayload("refresh-repo")) });
  });

  await page.goto("/repositories/refresh-repo");
  await expect(page.getByRole("link", { name: "feat: keep active evidence" })).toBeVisible();
  await page.getByRole("button", { name: "Refresh from GitHub" }).click();
  await expect(page).toHaveURL(/repositories\/refresh-repo\/processing\/refresh-run/);
  expect(refreshRequests).toBe(1);
});

test("keeps the active timeline visible while a refresh is queued", async ({ page }) => {
  await page.route("**/api/repositories/queued-refresh-repo**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/commits")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(timelinePagePayload("active-snapshot", [timelineItemPayload("feat111", "feat: keep active evidence")], null)) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(timelineRepositoryPayload("queued-refresh-repo", { id: "queued-refresh", kind: "REFRESH", status: "QUEUED", error: null })) });
  });

  await page.goto("/repositories/queued-refresh-repo");
  const refreshStatus = page.getByRole("status").filter({ hasText: "Refresh in progress." });
  await expect(refreshStatus).toContainText("active snapshot zzz9999");
  await expect(page.getByRole("link", { name: "feat: keep active evidence" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh in progress" })).toBeDisabled();
});

test("explains a failed refresh without hiding the active timeline", async ({ page }) => {
  await page.route("**/api/repositories/failed-refresh-repo**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/commits")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(timelinePagePayload("active-snapshot", [timelineItemPayload("feat111", "feat: keep active evidence")], null)) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(timelineRepositoryPayload("failed-refresh-repo", { id: "failed-refresh", kind: "REFRESH", status: "FAILED", error: { code: "GITHUB_UNAVAILABLE", message: "GitHub is temporarily unavailable." } })) });
  });

  await page.goto("/repositories/failed-refresh-repo");
  const refreshError = page.getByRole("alert").filter({ hasText: "Refresh failed." });
  await expect(refreshError).toContainText("GitHub is temporarily unavailable.");
  await expect(refreshError).toContainText("Snapshot zzz9999 remains active");
  await expect(page.getByRole("link", { name: "Review refresh error" })).toHaveAttribute("href", "/repositories/failed-refresh-repo/processing/failed-refresh");
  await expect(page.getByRole("link", { name: "feat: keep active evidence" })).toBeVisible();
});

function timelineItemPayload(shortSha: string, message: string) {
  return {
    sha: `${shortSha}full-sha`,
    shortSha,
    message,
    authorName: "Test author",
    committedAt: "2026-09-02T00:00:00Z",
    statistics: { changedFiles: 2, additions: 10, deletions: 1 },
    category: "FEATURE",
    eventSummary: { routesAdded: 1, routesRemoved: 0, dependenciesAdded: 0, dependenciesRemoved: 0, dependenciesUpdated: 0 },
    warnings: [],
  };
}

function timelinePagePayload(runId: string, items: ReturnType<typeof timelineItemPayload>[], nextCursor: string | null) {
  return {
    data: {
      snapshot: { runId, headSha: "zzz9999" },
      items,
      pageInfo: { nextCursor, hasNextPage: nextCursor !== null },
    },
  };
}

test("keeps timeline filters in the URL and sends them to the server", async ({ page }) => {
  const timelineRequests: string[] = [];
  await page.route("**/api/repositories/filter-repo**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/commits")) {
      timelineRequests.push(url.toString());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(timelinePagePayload("run-filter-repo", [timelineItemPayload("feat111", "feat: add account page")], null)) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(timelineRepositoryPayload("filter-repo")) });
  });

  await page.goto("/repositories/filter-repo");
  await expect(page.getByRole("link", { name: "feat: add account page" })).toBeVisible();

  await page.getByLabel("Evidence").selectOption("DEPENDENCY");
  await expect(page).toHaveURL(/event=DEPENDENCY/);
  await expect.poll(() => timelineRequests.some((requestUrl) => requestUrl.includes("event=DEPENDENCY")), { timeout: 5000 }).toBe(true);

  await page.getByLabel("Keyword").fill("account");
  await expect(page).toHaveURL(/query=account/);
});

test("appends older commits with cursor pagination", async ({ page }) => {
  await page.route("**/api/repositories/paging-repo**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/commits")) {
      if (url.searchParams.get("cursor")) {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(timelinePagePayload("run-paging-repo", [timelineItemPayload("fix2222", "fix: repair checkout\n\nLonger explanation stays out of the summary link.")], null)) });
      } else {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(timelinePagePayload("run-paging-repo", [timelineItemPayload("feat111", "feat: add account page")], "cursor-page-2")) });
      }
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(timelineRepositoryPayload("paging-repo")) });
  });

  await page.goto("/repositories/paging-repo");
  await expect(page.getByRole("link", { name: "feat: add account page" })).toBeVisible();
  await expect(page.getByRole("link", { name: "fix: repair checkout" })).toBeHidden();

  await page.getByRole("button", { name: "Load older commits" }).click();
  await expect(page.getByRole("link", { name: "fix: repair checkout" })).toBeVisible();
  await expect(page.getByRole("link", { name: "feat: add account page" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "fix: repair checkout" })).not.toContainText("Longer explanation");
});

test("keeps timeline visible when the cursor snapshot changes", async ({ page }) => {
  await page.route("**/api/repositories/stale-repo**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/commits")) {
      if (url.searchParams.get("cursor")) {
        await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ error: { code: "CURSOR_SNAPSHOT_MISMATCH", message: "The active snapshot changed since this timeline was opened. Reload from the top to continue." } }) });
      } else {
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(timelinePagePayload("run-stale-repo", [timelineItemPayload("feat111", "feat: add account page")], "cursor-stale")) });
      }
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(timelineRepositoryPayload("stale-repo")) });
  });

  await page.goto("/repositories/stale-repo");
  await expect(page.getByRole("link", { name: "feat: add account page" })).toBeVisible();

  await page.getByRole("button", { name: "Load older commits" }).click();
  const alert = page.getByRole("alert").filter({ hasText: "Newer snapshot available." });
  await expect(alert).toContainText("Newer snapshot available.");
  await expect(page.getByRole("link", { name: "feat: add account page" })).toBeVisible();

  await page.getByRole("button", { name: "Reload from top" }).click();
  await expect(alert).toBeHidden();
  await expect(page.getByRole("link", { name: "feat: add account page" })).toBeVisible();
});

function commitDetailPayload() {
  return {
    data: {
      snapshot: { runId: "run-drawer-repo" },
      sha: "abc1234def5678",
      shortSha: "abc1234",
      firstParentSha: "1111111",
      message: "feat: make retry recovery visible\n\nRetry failures without importing the repository again.",
      authorName: "Test author",
      authoredAt: "2026-09-02T00:00:00Z",
      committedAt: "2026-09-02T00:00:00Z",
      statistics: { changedFiles: 1, additions: 12, deletions: 3 },
      category: { value: "FEATURE", source: "CONVENTIONAL_COMMIT" },
      files: [],
      dependencyChanges: [],
      routeChanges: [],
      warnings: [],
      externalUrl: "https://github.com/acme/ledger/commit/abc1234def5678",
    },
  };
}

test("opens live commit evidence in an accessible drawer", async ({ page }) => {
  await page.route("**/api/repositories/drawer-repo**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/commits/abc1234")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(commitDetailPayload()) });
      return;
    }
    if (url.pathname.endsWith("/commits")) {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(timelinePagePayload("run-drawer-repo", [timelineItemPayload("feat111", "feat: add account page")], null)) });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(timelineRepositoryPayload("drawer-repo")) });
  });

  await page.goto("/repositories/drawer-repo/commits/abc1234");
  await expect(page.getByRole("dialog", { name: "feat: make retry recovery visible" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await expect(page.getByText("Provenance")).toBeVisible();
  await expect(page.getByText("Retry failures without importing the repository again.", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Close evidence" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(page.getByRole("link", { name: "Open on GitHub" })).toBeFocused();

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow, "drawer should not overflow").toBe(false);

  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/repositories\/drawer-repo$/);
  await expect(page.getByRole("link", { name: "feat: add account page" })).toBeVisible();
});

test("supports Escape on the showcase commit drawer", async ({ page }) => {
  await page.goto("/repositories/demo/commits/9d8e7f6");
  await expect(page.getByRole("dialog", { name: "feat: add account page" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/repositories\/demo$/);
});
