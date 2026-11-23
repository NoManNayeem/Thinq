import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, adminApi, signInWithPassword, uniqueSuffix } from "./helpers";

test.describe("user management", () => {
  test("an Admin adds a user in three steps; removing access applies on their next request and can be undone", async ({
    page,
    browser,
  }) => {
    const id = uniqueSuffix();
    const groupName = `Treasury ${id}`;
    const person = {
      name: `Robin Test ${id}`,
      email: `robin-${id}@example.com`,
      password: `robin-pass-${id}`,
    };

    await signInWithPassword(page, ADMIN_EMAIL);

    // A group, created through the UI.
    await page.goto("/admin/groups");
    await page.getByRole("button", { name: "New group" }).click();
    const groupDialog = page.getByRole("dialog");
    await groupDialog.getByLabel("Name").fill(groupName);
    await groupDialog.getByLabel("Description").fill("Created by an end-to-end test");
    await groupDialog.getByRole("button", { name: "Create group" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(groupName);

    // A user, created through the three-step flow.
    await page.goto("/admin/users");
    await page.getByRole("button", { name: "Add user" }).click();
    const wizard = page.getByRole("dialog");
    await expect(wizard).toContainText("Step 1 of 3");
    await wizard.getByRole("button", { name: "Continue" }).click();
    await expect(wizard).toContainText("Enter their full name."); // validation before moving on
    await wizard.getByLabel("Full name").fill(person.name);
    await wizard.getByLabel("Work email").fill(person.email);
    await wizard.getByRole("button", { name: "Continue" }).click();
    await expect(wizard).toContainText("Step 2 of 3");
    await wizard.getByRole("checkbox", { name: groupName }).click();
    await wizard.getByRole("button", { name: "Continue" }).click();
    await expect(wizard).toContainText("Step 3 of 3");
    await wizard.getByLabel("Initial password").fill(person.password);
    await expect(wizard.getByText("Review")).toBeVisible();
    await wizard.getByRole("button", { name: "Add user" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(person.name);
    await expect(page.getByTestId("user-groups")).toContainText(groupName);

    // They sign in elsewhere and see the group.
    const theirContext = await browser.newContext();
    const theirPage = await theirContext.newPage();
    await signInWithPassword(theirPage, person.email, person.password);
    await theirPage.goto("/profile");
    await expect(theirPage.getByTestId("profile-groups")).toContainText(groupName);

    // Remove → Undo restores the membership.
    await page.getByRole("button", { name: `Remove from ${groupName}` }).click();
    await expect(page.getByTestId("user-groups")).not.toContainText(groupName);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByTestId("user-groups")).toContainText(groupName);
    await theirPage.reload();
    await expect(theirPage.getByTestId("profile-groups")).toContainText(groupName);

    // Remove for real: it applies on their very next request, without signing out.
    await page.getByRole("button", { name: `Remove from ${groupName}` }).click();
    await expect(page.getByTestId("user-groups")).not.toContainText(groupName);
    await theirPage.reload();
    await expect(theirPage.getByTestId("profile-groups")).toBeVisible();
    await expect(theirPage.getByTestId("profile-groups")).not.toContainText(groupName);

    // Every step is in the audit log, with who did it.
    await page.goto("/admin/audit");
    const removed = page
      .getByTestId("audit-row")
      .filter({ hasText: person.email })
      .filter({ hasText: "Removed from group" });
    await expect(removed).toHaveCount(2);
    await expect(removed.first()).toContainText(ADMIN_EMAIL);

    // Deactivating them ends their session immediately.
    await page.goto("/admin/users");
    await page.getByLabel("Search users").fill(person.email);
    await page.getByTestId(`user-row-${person.email}`).click();
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Deactivate user" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Deactivate" }).click();
    await expect(page.getByText("This user is deactivated.")).toBeVisible();
    await theirPage.reload();
    await expect(theirPage).toHaveURL(/\/sign-in/);
    await theirContext.close();
  });

  test("deleting a group needs its name typed in", async ({ page }) => {
    const name = `Temp ${uniqueSuffix()}`;
    await signInWithPassword(page, ADMIN_EMAIL);
    const created = await page.request.post("/api/admin/groups", { data: { name } });
    const group = (await created.json()) as { id: string };
    await page.goto(`/admin/groups/${group.id}`);
    await page.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Delete group" }).click();
    const confirm = page.getByRole("alertdialog");
    const button = confirm.getByRole("button", { name: "Delete group" });
    await expect(button).toBeDisabled();
    await confirm.getByLabel(/Type .* to confirm/).fill(name);
    await button.click();
    await expect(page).toHaveURL(/\/admin\/groups$/);
    await expect(page.getByText(name)).toHaveCount(0);
  });

  test("an Admin can't lock themselves out", async ({ page }) => {
    await signInWithPassword(page, ADMIN_EMAIL);
    await page.goto("/admin/users");
    await page.getByLabel("Search users").fill(ADMIN_EMAIL);
    await page.getByTestId(`user-row-${ADMIN_EMAIL}`).click();
    await expect(page.getByRole("combobox", { name: "Role" })).toBeDisabled();
    await expect(page.getByText("You can't change your own role.")).toBeVisible();
    await page.getByRole("button", { name: "More actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Deactivate user" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  test.afterAll(async ({ browser }) => {
    const context = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const api = await adminApi(context);
    const groups = (await (await api.get("/api/admin/groups")).json()) as { id: string; name: string }[];
    for (const g of groups.filter((g) => /^(Treasury|Temp) /.test(g.name))) {
      await api.delete(`/api/admin/groups/${g.id}`);
    }
    await context.close();
  });
});
