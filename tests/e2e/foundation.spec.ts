import { expect, test } from "@playwright/test";

test("renders the Phase 0 foundation accessibly", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("RepoReplay");
  await expect(page.getByRole("heading", { level: 1, name: "Trace mainline change to source." })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: "Foundation in progress" })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Planned MVP capabilities" })).toContainText("Complete first-parent chain");
});

test("supports keyboard skip navigation", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Tab");

  const skipLink = page.getByRole("link", { name: "Skip to content" });
  await expect(skipLink).toBeFocused();
  await skipLink.press("Enter");
  await expect(page.locator("#main-content")).toBeVisible();
});

test("does not overflow the mobile viewport", async ({ page }) => {
  await page.goto("/");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  expect(overflow).toBe(false);
});
