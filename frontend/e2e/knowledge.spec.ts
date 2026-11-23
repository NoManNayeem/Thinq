import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, DOCS, MEMBER, settled, signInAsDemoUser, signInWithPassword } from "./helpers";

test("the knowledge graph only shows what the person can access", async ({ page, browser }) => {
  await signInAsDemoUser(page, MEMBER.name);
  await page.goto("/knowledge");
  await settled(page);
  await expect(page.getByTestId("graph-access")).toContainText(MEMBER.group);
  const nodes = page.getByTestId("graph-node");
  await expect(nodes.first()).toBeVisible();
  await expect(page.locator(`[data-testid=graph-node][data-label="${DOCS.restrictedTitle}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-testid=graph-node][data-label="${MEMBER.otherGroup}"]`)).toHaveCount(0);
  const body = await (await page.request.get("/api/knowledge/graph")).json();
  expect(JSON.stringify(body)).not.toContain(DOCS.restrictedTitle);
  expect(JSON.stringify(body)).not.toContain(DOCS.restrictedPhrase);

  // The list view is the same graph as text.
  await page.getByRole("radio", { name: "List" }).click();
  await expect(page.getByTestId("graph-list")).toContainText(DOCS.tableTitle);
  await expect(page.getByTestId("graph-list")).not.toContainText(DOCS.restrictedTitle);

  // Someone in the other group does see it.
  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const adminPage = await other.newPage();
  await signInWithPassword(adminPage, ADMIN_EMAIL);
  await adminPage.goto("/knowledge");
  await settled(adminPage);
  await expect(
    adminPage.locator(`[data-testid=graph-node][data-label="${DOCS.restrictedTitle}"]`),
  ).toHaveCount(1);
  await other.close();
});

test("graph nodes work with the keyboard and show details", async ({ page }) => {
  await signInWithPassword(page, ADMIN_EMAIL);
  await page.goto("/knowledge");
  await settled(page);
  const node = page.locator(`[data-testid=graph-node][data-label="${DOCS.draftTitle}"]`);
  await node.focus();
  await page.keyboard.press("Enter");
  const details = page.getByTestId("node-details");
  await expect(details).toContainText(DOCS.draftTitle);
  await expect(details.getByTestId("status-badge").first()).toHaveAttribute("data-status", "draft");
  await expect(details.getByRole("link", { name: /Open document/ })).toBeVisible();
  await expect(details.getByRole("region", { name: "Connections" })).toContainText(/version/i);

  await page.getByLabel("Find in the graph").fill(DOCS.tableTitle);
  await expect(page.getByText(/\d+ match/)).toBeVisible();
});
