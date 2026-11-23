import { expect, test } from "@playwright/test";
import {
  ADMIN_EMAIL,
  adminApi,
  DOCS,
  documentId,
  groupId,
  MEMBER,
  settled,
  signInAsDemoUser,
  signInWithPassword,
  uniqueSuffix,
} from "./helpers";

test("a Member's library holds only their groups' documents", async ({ page, browser }) => {
  const adminContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const api = await adminApi(adminContext);
  const restrictedId = await documentId(api, DOCS.restrictedTitle);

  await signInAsDemoUser(page, MEMBER.name);
  await page.goto("/library");
  await settled(page);
  await expect(page.getByTestId("document-list")).toBeVisible();
  await expect(page.getByTestId("document-list")).not.toContainText(DOCS.restrictedTitle);
  await expect(page.getByTestId("document-list")).not.toContainText("Unregistered");

  // Searching for words that only exist in the restricted document finds nothing.
  await page.getByLabel("Search documents").fill(DOCS.restrictedPhrase);
  await expect(page.getByText("No documents match")).toBeVisible();

  // A direct link is indistinguishable from a document that doesn't exist.
  await page.goto(`/library/${restrictedId}`);
  await expect(page.getByText("This page doesn't exist")).toBeVisible();
  expect((await page.request.get(`/api/documents/${restrictedId}`)).status()).toBe(404);
  await adminContext.close();
});

test("documents show their status, owner and audience, and render safely", async ({ page }) => {
  await signInWithPassword(page, ADMIN_EMAIL);
  const draft = await documentId(page.request, DOCS.draftTitle);
  await page.goto(`/library/${draft}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(DOCS.draftTitle);
  await expect(page.getByText("Not approved for use yet.")).toBeVisible();
  await expect(page.getByTestId("audience")).toContainText("people in total");

  const table = await documentId(page.request, DOCS.tableTitle);
  await page.goto(`/library/${table}`);
  await expect(page.getByTestId("document-content").locator("table")).toBeVisible();
  await expect(page.getByTestId("document-content").locator("script")).toHaveCount(0);
});

test("Admins triage flagged documents; Members never see flags", async ({ page, browser }) => {
  await signInWithPassword(page, ADMIN_EMAIL);
  await page.goto("/admin/attention");
  await settled(page);
  const first = page.getByTestId("attention-list").getByRole("listitem").first();
  await expect(first).toContainText("Not in the manifest");
  await page.getByTestId(`attention-${DOCS.unregisteredFile}`).click();
  await expect(page.getByTestId("document-flags")).toContainText("Likely a copy");
  await page.getByRole("button", { name: "Register document" }).click();
  await expect(page.getByRole("dialog")).toContainText("Register this document");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();

  const memberContext = await browser.newContext();
  const member = await memberContext.newPage();
  await signInAsDemoUser(member, MEMBER.name);
  const someDoc = await documentId(member.request, DOCS.draftTitle);
  await member.goto(`/library/${someDoc}`);
  await expect(member.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(member.getByTestId("document-flags")).toHaveCount(0);
  await memberContext.close();
});

test("losing group membership hides a document on the very next request", async ({ page, browser }) => {
  const id = uniqueSuffix();
  const adminContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const api = await adminApi(adminContext);
  const otherGroup = await groupId(api, MEMBER.otherGroup);
  const password = `doc-test-${id}`;
  const created = await api.post("/api/admin/users", {
    data: { name: `Doc Tester ${id}`, email: `doc-${id}@example.com`, password, group_ids: [otherGroup] },
  });
  const user = (await created.json()) as { id: string };
  const restrictedId = await documentId(api, DOCS.restrictedTitle);

  await signInWithPassword(page, `doc-${id}@example.com`, password);
  await page.goto(`/library/${restrictedId}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(DOCS.restrictedTitle);

  await api.delete(`/api/admin/users/${user.id}/groups/${otherGroup}`);

  await page.reload();
  await expect(page.getByText("This page doesn't exist")).toBeVisible();
  await page.goto("/library");
  await settled(page);
  await expect(page.getByText(DOCS.restrictedTitle)).toHaveCount(0);

  await api.patch(`/api/admin/users/${user.id}`, { data: { is_active: false } });
  await adminContext.close();
});
