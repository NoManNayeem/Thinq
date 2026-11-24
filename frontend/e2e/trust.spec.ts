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

test.describe.configure({ timeout: 120_000 });

test("approvals: drafts wait for a decision, and approving retires nothing outside the family", async ({
  page,
}) => {
  await signInWithPassword(page, ADMIN_EMAIL);
  const api = page.request;
  const suffix = uniqueSuffix();
  const title = `E2E Leave Policy ${suffix}`;
  const group = await groupId(api, MEMBER.group);
  const upload = await api.post("/api/admin/documents/upload", {
    data: {
      filename: `e2e-leave-${suffix}.md`,
      content: `# ${title}\n\nBook leave two weeks ahead.\n`,
      access_group_id: group,
      owner_name: null,
      status: "draft",
    },
  });
  expect(upload.ok()).toBeTruthy();
  const id = (await upload.json()).id as string;

  await page.goto("/approvals");
  await settled(page);
  await expect(page.getByTestId("approvals-awaiting_approval")).toContainText(title);

  await page.goto(`/library/${id}`);
  await settled(page);
  await page.getByTestId("status-primary").click(); // Approve
  await page.getByRole("dialog").getByLabel("Note (optional)").fill("Signed off in the weekly review");
  await page.getByRole("dialog").getByRole("button", { name: "Approve" }).click();
  await expect(
    page.getByRole("heading", { level: 1 }).locator("..").getByTestId("status-badge").first(),
  ).toHaveAttribute("data-status", "approved");
  await expect(page.getByTestId("history")).toContainText("Approved");
  await expect(page.getByTestId("history")).toContainText("Signed off in the weekly review");

  // Clean up: retire it so it never shows up in answers.
  await api.post(`/api/documents/${id}/status`, { data: { action: "mark_outdated" } });
});

test("a Member sees trust details but can't change status, and can report a problem", async ({
  page,
  browser,
}) => {
  await signInAsDemoUser(page, MEMBER.name);
  const draft = await documentId(page.request, DOCS.draftTitle);
  await page.goto(`/library/${draft}`);
  await settled(page);
  await expect(page.getByTestId("family")).toBeVisible();
  await expect(page.getByTestId("family")).toContainText("Current version");
  await expect(page.getByTestId("status-menu")).toHaveCount(0);
  expect(
    (await page.request.post(`/api/documents/${draft}/status`, { data: { action: "approve" } })).status(),
  ).toBe(403);

  const table = await documentId(page.request, DOCS.tableTitle);
  await page.goto(`/library/${table}`);
  await page.getByTestId("report-document").click();
  const comment = `E2E report ${uniqueSuffix()}`;
  await page.getByRole("dialog").getByLabel("Details (optional)").fill(comment);
  await page.getByRole("dialog").getByRole("button", { name: "Send report" }).click();
  await expect(page.getByText(/^Sent to /)).toBeVisible();

  // It reaches someone who can fix it, who resolves it; the reporter sees the outcome.
  const adminContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const admin = await adminContext.newPage();
  await signInWithPassword(admin, ADMIN_EMAIL);
  await admin.goto("/feedback");
  await settled(admin);
  const row = admin.getByTestId("feedback-item").filter({ hasText: comment });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Resolve" }).click();
  await admin.getByRole("dialog").getByLabel("Note for the reporter").fill("Checked with the owner");
  await admin.getByRole("dialog").getByRole("button", { name: "Resolve" }).click();
  await expect(admin.getByText("Resolved. The reporter can see the outcome.")).toBeVisible();
  await adminContext.close();

  await page.goto("/feedback");
  await settled(page);
  const mine = page.getByTestId("feedback-item").filter({ hasText: comment });
  await expect(mine).toContainText("Fixed");
  await expect(mine.getByTestId("feedback-outcome")).toContainText("Checked with the owner");
});

test("sources: sync now records history; quality: the inspector never leaks", async ({ page, browser }) => {
  await signInWithPassword(page, ADMIN_EMAIL);
  await page.goto("/admin/sources");
  await settled(page);
  await page.getByRole("button", { name: "Sync now" }).click();
  await expect(page.getByText(/^Synced: /)).toBeVisible();
  await expect(page.getByTestId("scan-history").locator("li").first()).toContainText("Sync now");

  await page.goto("/admin/quality");
  await settled(page);
  await expect(page.getByTestId("quality-stats")).toBeVisible();
  const api = await adminApi(await browser.newContext({ baseURL: test.info().project.use.baseURL }));
  const users = (await (await api.get("/api/admin/users", { params: { q: MEMBER.name } })).json()).items as {
    id: string;
    name: string;
  }[];
  const member = users.find((u) => u.name === MEMBER.name);
  expect(member).toBeTruthy();
  await page.getByLabel("Person").click();
  await page.getByRole("option", { name: MEMBER.name }).click();
  await page.getByLabel("Question", { exact: true }).fill(DOCS.restrictedTitle);
  await page.getByRole("button", { name: "Inspect" }).click();
  const result = page.getByTestId("inspect-result");
  await expect(result).toContainText(`As ${MEMBER.name}`);
  await expect(result).not.toContainText(DOCS.restrictedPhrase);
  await expect(result.locator("table")).not.toContainText(DOCS.restrictedTitle);
});
