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
