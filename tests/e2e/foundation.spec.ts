import { expect, test } from "@playwright/test";

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
  await expect(page.getByText("Enter a public GitHub repository URL")).toBeVisible();
});

test("retries a failed run without creating a new import", async ({ page }) => {
  let retryQueued = false;
  let retryRequests = 0;
  let importRequests = 0;
  page.on("request", (request) => {
    if (request.method() === "POST" && request.url().endsWith("/api/repositories")) importRequests += 1;
  });
  await page.route("**/api/repositories/retry-repository/runs/retry-run", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: retryQueued ? { id: "retry-run", status: "QUEUED", step: "DISCOVER_HISTORY", fetchedCommits: 0, processedCommits: 0, expectedCommits: 8, worker: { status: "HEALTHY", lastHeartbeatAt: "2026-09-02T00:00:00Z", heartbeatAgeSeconds: 2 }, attemptCount: 0, nextAttemptAt: null, warnings: [], error: null } : { id: "retry-run", status: "FAILED", step: "DETECT_ROUTES", fetchedCommits: 8, processedCommits: 8, expectedCommits: 8, worker: { status: "HEALTHY", lastHeartbeatAt: "2026-09-02T00:00:00Z", heartbeatAgeSeconds: 2 }, attemptCount: 4, nextAttemptAt: null, warnings: [], error: { code: "GITHUB_UNAVAILABLE", message: "GitHub is temporarily unavailable." } } }) });
  });
  await page.route("**/api/repositories/retry-repository/runs/retry-run/retry", async (route) => {
    retryRequests += 1;
    retryQueued = true;
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ data: { repositoryId: "retry-repository", runId: "retry-run", status: "QUEUED" } }) });
  });

  await page.goto("/repositories/retry-repository/processing/retry-run");
  await expect(page.getByRole("button", { name: "Retry run" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("previous snapshot remains unchanged");
  await page.getByRole("button", { name: "Retry run" }).click();
  await expect(page.getByRole("button", { name: "Cancel run" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Waiting for a worker to claim this run");
  expect(retryRequests).toBe(1);
  expect(importRequests).toBe(0);
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
