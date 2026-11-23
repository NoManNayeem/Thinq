import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_SCREENS, settled, signInWithPassword } from "./helpers";

/** Accessibility (including colour contrast) and the one-primary-action rule, on every screen, in both themes. */
for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} theme`, () => {
    test.use({ colorScheme: scheme });

    test("sign-in and status pages", async ({ page }) => {
      for (const path of ["/sign-in", "/status"]) {
        await page.goto(path);
        await settled(page);
        await expectAccessible(page, path);
        await expectAtMostOnePrimary(page, path);
      }
    });

    test("every signed-in screen", async ({ page }) => {
      await signInWithPassword(page, ADMIN_EMAIL);
      for (const path of ADMIN_SCREENS) {
        await page.goto(path);
        await settled(page);
        await expectAccessible(page, path);
        await expectAtMostOnePrimary(page, path);
      }
      // Detail screens and the Add user flow.
      await page.goto("/admin/users");
      await page
        .getByTestId(/^user-row-/)
        .first()
        .click();
      await settled(page);
      await expectAccessible(page, "user detail");
      await expectAtMostOnePrimary(page, "user detail");
      await page.goto("/admin/groups");
      await page
        .getByTestId(/^group-card-/)
        .last()
        .click();
      await settled(page);
      await expectAccessible(page, "group detail");
      await expectAtMostOnePrimary(page, "group detail");
      await page.goto("/admin/users");
      await page.getByRole("button", { name: "Add user" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expectAccessible(page, "add user dialog");
    });
  });
}

async function expectAccessible(page: import("@playwright/test").Page, where: string) {
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
    .analyze();
  const problems = results.violations.map(
    (v) =>
      `${v.id} (${v.impact}): ${v.nodes
        .map((n) => n.target.join(" "))
        .slice(0, 3)
        .join(" | ")}`,
  );
  expect(problems, `accessibility problems on ${where}`).toEqual([]);
}

async function expectAtMostOnePrimary(page: import("@playwright/test").Page, where: string) {
  const primaries = page.locator('[data-slot="button"][data-variant="default"]:visible');
  expect(await primaries.count(), `primary buttons on ${where}`).toBeLessThanOrEqual(1);
}
