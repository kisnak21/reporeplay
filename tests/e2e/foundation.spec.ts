import { expect, test } from "@playwright/test";

test("completes the fixture import flow", async ({ page }) => {
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
