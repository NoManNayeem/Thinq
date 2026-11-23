import { expect, test } from "@playwright/test";

test("signed-out visitors get the landing page at /, and it leads to sign-in", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/); // same URL, rewritten to the landing page
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Answers your team can trust");

  // The animated scene plays through to the cited answer.
  const scene = page.getByTestId("trust-scene");
  await expect(scene).toHaveAttribute("data-step", "5", { timeout: 12_000 });
  await expect(scene).toContainText("Travel Policy v2 · Approved");

  // Section links scroll to their sections (desktop header).
  await page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Trust" }).click();
  await expect(
    page.getByRole("heading", { name: "Four promises Thinq keeps on every request." }),
  ).toBeInViewport();

  await page.getByRole("link", { name: "Sign in to Thinq" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("heading", { name: "Sign in to Thinq" })).toBeVisible();
  await page.getByRole("link", { name: "Back to home" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test.describe("with reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("the scene shows its final state straight away", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("trust-scene")).toHaveAttribute("data-step", "5");
  });
});

test("illustrations are lazy and decorative", async ({ page }) => {
  await page.goto("/");
  const images = page.locator('img[src^="/illustrations/"]');
  expect(await images.count()).toBeGreaterThan(0);
  for (const img of await images.all()) {
    await expect(img).toHaveAttribute("alt", "");
    await expect(img).toHaveAttribute("loading", "lazy");
  }
});

for (const scheme of ["light", "dark"] as const) {
  test(`exactly one version of each illustration shows in ${scheme} mode`, async ({ browser }) => {
    const context = await browser.newContext({ colorScheme: scheme, viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto("/");
    const visible = await page
      .locator('img[src^="/illustrations/"]')
      .filter({ visible: true })
      .evaluateAll((imgs) => imgs.map((i) => (i as HTMLImageElement).getAttribute("src")));
    expect(visible.length).toBeGreaterThan(0);
    for (const src of visible) expect(src).toContain(scheme === "dark" ? "-dark.svg" : "-light.svg");
    const names = visible.map((s) => s?.replace(/-(light|dark)\.svg$/, ""));
    expect(new Set(names).size).toBe(names.length);
    await context.close();
  });
}
