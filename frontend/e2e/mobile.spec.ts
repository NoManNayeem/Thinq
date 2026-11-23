import { expect, type Page, test } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_SCREENS, settled, signInWithPassword } from "./helpers";

async function expectTouchTargets(page: Page, where: string) {
  const width = page.viewportSize()?.width ?? 0;
  const controls = page
    .locator("button, input:not([type=hidden]), textarea, [role=combobox], [role=radio], [data-slot=button]")
    .filter({ visible: true });
  for (const control of await controls.all()) {
    const box = await control.boundingBox();
    // Skip visually hidden helpers (e.g. a select's native form input).
    if (!box || (box.width <= 2 && box.height <= 2)) continue;
    const label = await control.evaluate(
      (el) => el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 40) ?? el.tagName,
    );
    expect(box.height, `${where}: "${label}" is ${box.height}px tall`).toBeGreaterThanOrEqual(40);
    expect(box.x + box.width, `${where}: "${label}" overflows the screen`).toBeLessThanOrEqual(width + 1);
  }
  // Primary controls meet the full 48 px target.
  for (const control of await page
    .locator("[data-slot=button], [data-slot=input], [data-slot=select-trigger]")
    .filter({ visible: true })
    .all()) {
    const box = await control.boundingBox();
    if (box) expect(box.height, `${where}: control below 48px`).toBeGreaterThanOrEqual(48);
  }
}

test("controls are at least 48px tall and fit the screen on a phone", async ({ page }) => {
  await page.goto("/sign-in");
  await settled(page);
  await expectTouchTargets(page, "/sign-in");
  await signInWithPassword(page, ADMIN_EMAIL);
  for (const path of ADMIN_SCREENS) {
    await page.goto(path);
    await settled(page);
    await expectTouchTargets(page, path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(0);
  }
});

test("navigation and filters use familiar mobile patterns", async ({ page }) => {
  await signInWithPassword(page, ADMIN_EMAIL);
  await expect(page.getByRole("complementary", { name: "Sidebar" })).toBeHidden();
  await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("dialog").getByRole("link", { name: "Users" }).click();
  await expect(page.getByRole("heading", { name: "Users", level: 1 })).toBeVisible();
  await expect(page.getByRole("dialog")).toBeHidden();

  // Filters are tucked behind one button on small screens (progressive disclosure).
  await expect(page.getByRole("combobox", { name: "Filter by role" })).toBeHidden();
  await page.getByRole("button", { name: "Filters" }).click();
  const sheet = page.getByRole("dialog");
  await expect(sheet.getByRole("combobox", { name: "Filter by role" })).toBeVisible();
  await sheet.getByRole("button", { name: "Show results" }).click();
  await expect(sheet).toBeHidden();
});
