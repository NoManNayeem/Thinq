/**
 * README screenshots: every feature, walked through as the people who'd use it.
 * Needs the sample organization (seed/sample): Dana (Operations), Sam (Finance), Alex (Admin).
 */
import { type Browser, devices, expect, type Page, test } from "@playwright/test";
import { settled, signInAsDemoUser } from "../e2e/helpers";

const OUT = "../screenshots";
const ANSWER_TIMEOUT = 180_000;

/** Saves a screenshot. ``tall`` grows the viewport to the page's height first (instead of a
 * full-page capture, which would break the sticky sidebar and header). */
async function shot(page: Page, name: string, tall = false) {
  await settled(page);
  const size = page.viewportSize();
  if (tall && size) {
    const height = await page.evaluate(() =>
      Math.max(
        ...[document.documentElement, document.body, document.querySelector("main")].map(
          (e) => e?.scrollHeight ?? 0,
        ),
      ),
    );
    await page.setViewportSize({ width: size.width, height: Math.min(Math.max(height, size.height), 2400) });
    await settled(page);
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  if (tall && size) await page.setViewportSize(size);
}

async function as(browser: Browser, name: string, device?: (typeof devices)[string]) {
  const context = await browser.newContext({
    ...(device ?? {}),
    baseURL: test.info().project.use.baseURL,
    ...(device ? {} : { viewport: { width: 1440, height: 900 } }),
  });
  const page = await context.newPage();
  await signInAsDemoUser(page, name);
  return { page, context };
}

async function ask(page: Page, question: string) {
  await page.getByTestId("chat-input").fill(question);
  await page.getByRole("button", { name: "Send question" }).click();
  await expect(page.getByTestId("user-message").last()).toContainText(question);
  const answer = page.getByTestId("assistant-message").last();
  await expect(answer).toHaveAttribute("aria-busy", "false", { timeout: ANSWER_TIMEOUT });
  return answer;
}

async function groupId(page: Page, name: string) {
  const groups = (await (await page.request.get("/api/admin/groups")).json()) as {
    id: string;
    name: string;
  }[];
  return groups.find((g) => g.name === name)?.id as string;
}

async function userId(page: Page, name: string) {
  const r = await page.request.get("/api/admin/users", { params: { q: name } });
  return ((await r.json()).items as { id: string; name: string }[]).find((u) => u.name === name)
    ?.id as string;
}

async function docId(page: Page, title: string) {
  const r = await page.request.get("/api/documents", { params: { q: title, limit: 50 } });
  return ((await r.json()).items as { id: string; title: string }[]).find((d) => d.title === title)
    ?.id as string;
}

test("README screenshots", async ({ browser }) => {
  // ---------------------------------------------------------------- public pages
  {
    // Reduced motion shows the product scene in its final state, as people with that setting see it.
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    await page.goto("/");
    await page.waitForTimeout(800);
    await shot(page, "01-landing");
    await page.goto("/sign-in");
    await page.waitForTimeout(1200);
    await shot(page, "02-sign-in");
    await context.close();
  }

  // ---------------------------------------------------------------- setup (as Admin)
  const admin = await as(browser, "Alex Morgan");
  const a = admin.page;
  const everyone = await groupId(a, "Everyone");
  const finance = await groupId(a, "Finance");
  const sam = await userId(a, "Sam Patel");
  await a.request.put(`/api/admin/users/${sam}/groups/${finance}`); // make sure Sam is in Finance
  if (!(await docId(a, "Memo: Supplier onboarding"))) {
    const memo = await a.request.post("/api/admin/documents/upload", {
      data: {
        filename: "Memo_Supplier_Onboarding.md",
        content:
          "# Memo: Supplier onboarding\nFrom: Alex Morgan, IT Lead\n\n" +
          "Effective today, use the Supplier Setup Form for every new supplier. Send it to the operations inbox.\n",
        access_group_id: everyone,
        owner_name: "Alex Morgan",
        status: "approved",
      },
    });
    expect(memo.ok()).toBeTruthy();
  }

  // ---------------------------------------------------------------- 1. approved beats newer draft
  const dana = await as(browser, "Dana Lee");
  const d = dana.page;
  await d.goto("/chat");
  await shot(d, "03-chat-welcome");
  const q1 = await ask(d, "What's the current travel policy?");
  await shot(d, "04-chat-approved-answer");
  await q1.getByTestId("sources-toggle").click();
  await q1.getByTestId("source-card").first().locator("summary").click();
  await q1.getByTestId("sources-toggle").scrollIntoViewIfNeeded();
  await shot(d, "05-chat-sources");

  // ---------------------------------------------------------------- 2. access before the AI
  await d.goto("/chat");
  await ask(d, "When does payroll run each month?");
  await shot(d, "06-chat-restricted-ops");

  const finance_ = await as(browser, "Sam Patel");
  const s = finance_.page;
  await s.goto("/chat");
  await ask(s, "When does payroll run each month?");
  await shot(s, "07-chat-finance");
  const samChat = s.url();

  // ---------------------------------------------------------------- 3. removing access applies at once
  await a.goto(`/admin/users/${sam}`);
  await settled(a);
  await a.getByRole("button", { name: "Remove from Finance" }).click();
  await expect(a.getByText("Removed from Finance")).toBeVisible();
  await shot(a, "08-admin-remove-access");
  await s.goto(samChat);
  await settled(s);
  await ask(s, "When does payroll run each month?");
  await s.getByTestId("withheld").first().scrollIntoViewIfNeeded();
  await shot(s, "09-chat-access-removed");
  await a.request.put(`/api/admin/users/${sam}/groups/${finance}`); // put Sam back

  // ---------------------------------------------------------------- library, trust and approval
  await d.goto("/library");
  await shot(d, "10-library");
  await a.goto(`/library/${await docId(a, "Travel Policy v3")}`);
  await shot(a, "11-document-trust", true);
  await a.goto("/approvals");
  await shot(a, "12-approvals", true);
  await a.goto("/admin/attention");
  await shot(a, "13-needs-attention", true);

  // ---------------------------------------------------------------- knowledge graph
  await d.goto("/knowledge");
  await settled(d);
  await d.waitForTimeout(3500);
  const node = d.locator('[data-testid=graph-node][data-label="Travel Policy v2"]');
  await node.focus();
  await d.keyboard.press("Enter");
  await d.waitForTimeout(800);
  await shot(d, "14-knowledge-graph");

  // ---------------------------------------------------------------- feedback loop
  await d.goto("/chat");
  const flagged = await ask(d, "How do I get a new laptop?");
  await flagged.getByRole("button", { name: "Not helpful", exact: true }).click();
  await d.getByRole("radio", { name: "Out of date" }).click();
  await d.getByLabel("Details (optional)").fill("The IT request form moved to the new portal.");
  await d.getByRole("dialog").getByRole("button", { name: "Send feedback" }).click();
  await expect(d.getByTestId("report-status").last()).toBeVisible();
  await a.goto("/feedback");
  await settled(a);
  const item = a.getByTestId("feedback-item").filter({ hasText: "new portal" }).first();
  await item.getByText("The answer they got").click();
  await shot(a, "15-feedback-inbox");
  await item.getByRole("button", { name: "Resolve" }).click();
  await a
    .getByRole("dialog")
    .getByLabel("Note for the reporter")
    .fill("Updated the link in the IT Help Desk page.");
  await a.getByRole("dialog").getByRole("button", { name: "Resolve" }).click();
  await expect(a.getByText("Resolved. The reporter can see the outcome.")).toBeVisible();
  await d.goto("/feedback");
  await shot(d, "16-feedback-outcome");

  // ---------------------------------------------------------------- operations and quality
  await a.goto("/admin/sources");
  await a.getByRole("button", { name: "Sync now" }).click();
  await expect(a.getByText(/^Synced: /)).toBeVisible();
  await shot(a, "17-sources-and-sync");
  await a.goto("/admin/quality");
  await settled(a);
  await a.getByLabel("Person").click();
  await a.getByRole("option", { name: "Dana Lee" }).click();
  await a.getByLabel("Question", { exact: true }).fill("What's the current travel policy?");
  await a.getByRole("button", { name: "Inspect" }).click();
  await expect(a.getByTestId("inspect-result")).toBeVisible({ timeout: 60_000 });
  await shot(a, "18-answer-quality", true);
  await a.goto("/admin/audit");
  await shot(a, "19-audit-log");
  await a.goto("/");
  await shot(a, "20-admin-overview");

  // ---------------------------------------------------------------- phone
  const phone = await as(browser, "Dana Lee", devices["Pixel 7"]);
  const p = phone.page;
  await p.goto("/chat");
  await ask(p, "Why did we move the supplier review to quarterly?");
  await shot(p, "21-mobile-chat");
  await p.goto("/knowledge");
  await settled(p);
  await p.waitForTimeout(3500);
  await p.locator('[data-testid=graph-node][data-label="Travel Policy v2"]').tap();
  await p.waitForTimeout(800);
  await shot(p, "22-mobile-graph");

  for (const c of [admin, dana, finance_, phone]) await c.context.close();
});
