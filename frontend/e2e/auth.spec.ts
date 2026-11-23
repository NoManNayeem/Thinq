import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, MEMBER, SEED_PASSWORD, signInAsDemoUser, signInWithPassword } from "./helpers";

test("visitors are sent to sign-in and returned to where they were going", async ({ page }) => {
  await page.goto("/admin/groups");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fadmin%2Fgroups/);
  await page.getByLabel("Work email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/groups$/);
  await expect(page.getByRole("heading", { name: "Groups", level: 1 })).toBeVisible();
});

test("wrong password shows a clear error", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Work email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill("definitely-wrong");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("form", { name: "Sign in" }).getByRole("alert")).toContainText(
    "Email or password is incorrect.",
  );
  await expect(page).toHaveURL(/\/sign-in/);
});

test("a Member sees their own access and cannot open Admin screens", async ({ page }) => {
  await signInAsDemoUser(page, MEMBER.name);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(MEMBER.name.split(" ")[0] ?? "");
  await expect(page.getByTestId("my-groups")).toContainText(MEMBER.group);
  await expect(page.getByTestId("my-groups")).not.toContainText(MEMBER.otherGroup);
  await expect(page.getByRole("link", { name: "Users" })).toHaveCount(0);

  await page.goto("/admin/users");
  await expect(page.getByTestId("forbidden")).toBeVisible();

  const api = await page.request.get("/api/admin/users");
  expect(api.status()).toBe(403);
});

test("signing out ends the session", async ({ page }) => {
  await signInWithPassword(page, ADMIN_EMAIL);
  await page.locator("[data-testid=user-menu]:visible").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
  expect((await page.request.get("/api/auth/me")).status()).toBe(401);
  await page.goto("/profile");
  await expect(page).toHaveURL(/\/sign-in/);
});
