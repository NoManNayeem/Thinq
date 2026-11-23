import { expect, test } from "@playwright/test";

test("status page reports a healthy stack and streams incrementally", async ({ page }) => {
  await page.goto("/status");
  await expect(page.getByTestId("overall-status")).toHaveAttribute("data-tone", "success");
  await expect(page.getByTestId("overall-status")).toContainText("All systems operational");
  await expect(page.getByTestId("component-database")).toContainText("PostgreSQL 18");
  await expect(page.getByTestId("component-database")).toContainText("pgvector enabled");

  await page.getByTestId("run-stream-test").click();
  // The first event must arrive well before the stream finishes — proof it isn't buffered.
  await expect(page.getByTestId("stream-event")).toHaveCount(1, { timeout: 1_500 });
  await expect(page.getByTestId("stream-event")).not.toHaveCount(5);
  await expect(page.getByTestId("stream-result")).toContainText("Streaming works", { timeout: 10_000 });
  await expect(page.getByTestId("stream-event")).toHaveCount(5);
});

test("status page is public", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/status");
  await expect(page).toHaveURL(/\/status$/);
  await context.close();
});
