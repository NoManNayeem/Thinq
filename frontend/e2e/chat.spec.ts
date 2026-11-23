import { expect, type Page, test } from "@playwright/test";
import {
  ADMIN_EMAIL,
  DOCS,
  MEMBER,
  settled,
  signInAsDemoUser,
  signInWithPassword,
  uniqueSuffix,
} from "./helpers";

// Answers may come from a local model, so allow for a slow first token.
const ANSWER_TIMEOUT = 90_000;

async function askQuestion(page: Page, question: string) {
  await page.getByTestId("chat-input").fill(question);
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByTestId("user-message").last()).toContainText(question);
  const answer = page.getByTestId("assistant-message").last();
  await expect(answer).toHaveAttribute("aria-busy", "false", { timeout: ANSWER_TIMEOUT });
  return answer;
}

test.describe.configure({ timeout: 180_000 });

// Tests delete the chats they create, so repeated runs don't fill people's history.
test.afterEach(async ({ page }) => {
  const id = new URL(page.url()).searchParams.get("c");
  if (id) await page.request.delete(`/api/chat/conversations/${id}`);
});

test("an answer streams in with its sources, status and owner", async ({ page }) => {
  await signInWithPassword(page, ADMIN_EMAIL);
  await page.goto("/chat");
  await settled(page);
  await expect(page.getByTestId("chat-welcome")).toBeVisible();
  const answer = await askQuestion(page, `What does "${DOCS.tableTitle}" say?`);
  await expect(answer.getByTestId("answer-text")).not.toBeEmpty();
  // Sources stay folded until asked for; the toggle still shows how many there are.
  const toggle = answer.getByTestId("sources-toggle");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(answer.getByTestId("answer-sources")).toHaveCount(0);
  await toggle.click();
  const panel = answer.getByTestId("answer-sources");
  await expect(panel).toContainText(DOCS.tableTitle);
  const first = panel.getByTestId("source-card").first();
  await expect(first.getByTestId("status-badge")).toBeVisible();
  // Each source's excerpt opens on request too, rendered as Markdown (never raw table pipes).
  await first.locator("summary").click();
  await expect(first.getByTestId("source-excerpt")).toBeVisible();
  await expect(first.getByTestId("source-excerpt")).not.toContainText("|---|");
  await expect(first.getByRole("link", { name: /Open document/ })).toBeVisible();
  await expect(panel.getByTestId("retrieval-summary")).toContainText("you can access");
  // The conversation is saved and survives a reload.
  await expect(page).toHaveURL(/\/chat\?c=/);
  await page.reload();
  const saved = page.getByTestId("assistant-message").last();
  await saved.getByTestId("sources-toggle").click();
  await expect(saved.getByTestId("answer-sources")).toContainText(DOCS.tableTitle);
});

test("a Member's answers never use documents outside their groups", async ({ page }) => {
  await signInAsDemoUser(page, MEMBER.name);
  await page.goto("/chat");
  await expect(page.getByTestId("answering-from")).toContainText(MEMBER.group);
  await expect(page.getByTestId("answering-from")).not.toContainText(MEMBER.otherGroup);
  // Ask for it by name. The answer may repeat the question's words, but no source may be the
  // restricted document and nothing from inside it may appear.
  const answer = await askQuestion(page, `What does "${DOCS.restrictedTitle}" say?`);
  await expect(answer.getByTestId("answer-text")).not.toBeEmpty();
  if (await answer.getByTestId("sources-toggle").count()) {
    await answer.getByTestId("sources-toggle").click();
    await expect(answer.getByTestId("answer-sources")).not.toContainText(DOCS.restrictedTitle);
  }
  await expect(answer).not.toContainText(DOCS.restrictedPhrase);
});

test("conversations are private, and can be rated, renamed and deleted", async ({ page, browser }) => {
  await signInAsDemoUser(page, MEMBER.name);
  await page.goto("/chat");
  const answer = await askQuestion(page, `Who owns "${DOCS.tableTitle}"?`);
  const url = page.url();
  const id = new URL(url).searchParams.get("c");
  expect(id).toBeTruthy();

  // Feedback persists.
  await answer.getByRole("button", { name: "Helpful", exact: true }).click();
  await expect(answer.getByRole("button", { name: "Helpful", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.reload();
  await expect(
    page.getByTestId("assistant-message").last().getByRole("button", { name: "Helpful", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  // Nobody else can read it, Admins included.
  const admin = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const adminPage = await admin.newPage();
  await signInWithPassword(adminPage, ADMIN_EMAIL);
  expect((await adminPage.request.get(`/api/chat/conversations/${id}`)).status()).toBe(404);
  await admin.close();

  // Rename, then delete. Earlier runs may have left chats with the same title, so work on
  // this chat's own row.
  const list = page.getByTestId("conversation-list").first();
  const row = list.locator("li", { has: page.locator(`a[href$="${id}"]`) });
  const name = `Help desk owner ${uniqueSuffix()}`;
  await row.getByRole("button", { name: /^Options for/ }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByLabel("Chat name").fill(name);
  await page.getByLabel("Chat name").press("Enter");
  await expect(page.getByTestId("chat-title")).toHaveText(name);
  await row.getByRole("button", { name: `Options for ${name}` }).click();
  await page.getByRole("menuitem", { name: "Delete" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: /Delete/ })
    .click();
  await expect(list).not.toContainText(name);
  expect((await page.request.get(`/api/chat/conversations/${id}`)).status()).toBe(404);
});
