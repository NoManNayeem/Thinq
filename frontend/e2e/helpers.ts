import { type APIRequestContext, type BrowserContext, expect, type Page } from "@playwright/test";

/**
 * Identities from the seed data the stack was started with. Defaults match
 * seed/sample (the repository's sample organization); override them to run
 * against another dataset.
 */
export const SEED_PASSWORD = process.env.E2E_SEED_PASSWORD ?? "thinq-demo-2026";
export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? "alex@example.com";
export const MEMBER = {
  name: process.env.E2E_MEMBER_NAME ?? "Dana Lee",
  group: process.env.E2E_MEMBER_GROUP ?? "Operations",
  /** A group the member is not in. */
  otherGroup: process.env.E2E_OTHER_GROUP ?? "Finance",
};

export async function signInWithPassword(page: Page, email: string, password = SEED_PASSWORD) {
  await page.goto("/sign-in");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator("[data-testid=user-menu]:visible")).toBeVisible();
}

export async function signInAsDemoUser(page: Page, name: string) {
  await page.goto("/sign-in");
  await page
    .getByRole("list", { name: "Demo users" })
    .getByRole("button", { name: new RegExp(name) })
    .click();
  await expect(page.locator("[data-testid=user-menu]:visible")).toBeVisible();
}

/** An API client authenticated as the seeded Admin, for arranging test data. */
export async function adminApi(context: BrowserContext): Promise<APIRequestContext> {
  const request = context.request;
  const res = await request.post("/api/auth/login", {
    data: { email: ADMIN_EMAIL, password: SEED_PASSWORD },
  });
  expect(res.ok()).toBeTruthy();
  return request;
}

export function uniqueSuffix() {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

/** Every screen a signed-in Admin can reach, for checks that should hold everywhere. */
export const ADMIN_SCREENS = ["/", "/profile", "/admin/users", "/admin/groups", "/admin/audit"] as const;

/** Wait until loading skeletons and the progress bar have gone. */
export async function settled(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
}
