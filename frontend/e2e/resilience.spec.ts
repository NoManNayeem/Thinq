import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, adminApi, SEED_PASSWORD, signInWithPassword, uniqueSuffix } from "./helpers";

test("sign-in works on a slow mobile network and shows that it's working", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Work email").fill(ADMIN_EMAIL);
  await page.getByLabel("Password", { exact: true }).fill(SEED_PASSWORD);

  // Roughly "slow 3G": 400 ms latency, 400 kbit/s down.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 400,
    downloadThroughput: 50 * 1024,
    uploadThroughput: 25 * 1024,
  });

  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("button", { name: /Signing in/ })).toBeDisabled();
  await expect(page.getByTestId("global-progress")).toBeVisible({ timeout: 15_000 });
  await expect(page.locator("[data-testid=user-menu]:visible")).toBeVisible({ timeout: 60_000 });
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
});

test("going offline is announced, and coming back clears it", async ({ page, context }) => {
  await signInWithPassword(page, ADMIN_EMAIL);
  await context.setOffline(true);
  await expect(page.getByText("You're offline.")).toBeVisible();
  await context.setOffline(false);
  await expect(page.getByText("You're offline.")).toBeHidden();
});

test("Bangla names render in the Bangla font without overflowing", async ({ page, context }) => {
  const id = uniqueSuffix();
  const groupName = `অর্থ ও হিসাব বিভাগ ${id}`;
  const personName = "নাদিয়া রহমান চৌধুরী";
  const api = await adminApi(context);
  const group = (await (await api.post("/api/admin/groups", { data: { name: groupName } })).json()) as {
    id: string;
  };
  const user = (await (
    await api.post("/api/admin/users", {
      data: { name: personName, email: `bn-${id}@example.com`, group_ids: [group.id] },
    })
  ).json()) as { id: string };

  await page.goto(`/admin/users/${user.id}`);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(personName);
  await expect(page.getByTestId("user-groups")).toContainText(groupName);

  const bengaliFontLoaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return [...document.fonts].some((f) => f.family.includes("Noto Sans Bengali") && f.status === "loaded");
  });
  expect(bengaliFontLoaded).toBe(true);

  for (const width of [360, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `sideways scroll at ${width}px`).toBeLessThanOrEqual(0);
  }

  await page.goto("/admin/groups");
  await expect(page.getByText(groupName)).toBeVisible();

  await api.patch(`/api/admin/users/${user.id}`, { data: { is_active: false } });
  await api.delete(`/api/admin/groups/${group.id}`);
});

test("no sideways scrolling from 360 to 1920 pixels wide", async ({ page }) => {
  await signInWithPassword(page, ADMIN_EMAIL);
  for (const path of ["/", "/admin/users", "/admin/groups", "/admin/audit"]) {
    await page.goto(path);
    // Checked straight away, so loading states must fit too.
    for (const width of [360, 768, 1280, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, `${path} at ${width}px`).toBeLessThanOrEqual(0);
    }
  }
});
