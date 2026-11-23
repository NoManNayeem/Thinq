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
export const ADMIN_SCREENS = [
  "/",
  "/library",
  "/profile",
  "/admin/attention",
  "/admin/users",
  "/admin/groups",
  "/admin/audit",
] as const;

/** Wait until loading skeletons and the progress bar have gone. */
export async function settled(page: Page) {
  await page.waitForLoadState("networkidle");
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await animationsDone(page);
}

/** Wait for entry animations (dialogs fade in) so checks see final colours. */
export async function animationsDone(page: Page) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .filter((a) => a.effect?.getTiming().iterations !== Number.POSITIVE_INFINITY)
      .every((a) => a.playState !== "running"),
  );
}

/** Documents in the seed data used by the document tests. Defaults match seed/sample. */
export const DOCS = {
  /** In MEMBER.otherGroup only. */
  restrictedTitle: process.env.E2E_RESTRICTED_DOC ?? "Payroll Calendar 2027",
  /** A phrase that appears only in the restricted document. */
  restrictedPhrase: process.env.E2E_RESTRICTED_PHRASE ?? "Bonus payments",
  unregisteredFile: process.env.E2E_UNREGISTERED_FILE ?? "travel policy (1).md",
  draftTitle: process.env.E2E_DRAFT_DOC ?? "Travel Policy v3",
  /** A document containing a Markdown table. */
  tableTitle: process.env.E2E_TABLE_DOC ?? "IT Help Desk",
};

export async function documentId(api: APIRequestContext, title: string): Promise<string> {
  const res = await api.get("/api/documents", { params: { q: title, limit: 50 } });
  const body = (await res.json()) as { items: { id: string; title: string }[] };
  const doc = body.items.find((d) => d.title === title);
  if (!doc) throw new Error(`No document titled "${title}" is visible to this user`);
  return doc.id;
}

export async function groupId(api: APIRequestContext, name: string): Promise<string> {
  const groups = (await (await api.get("/api/admin/groups")).json()) as { id: string; name: string }[];
  const group = groups.find((g) => g.name === name);
  if (!group) throw new Error(`No group named "${name}"`);
  return group.id;
}
