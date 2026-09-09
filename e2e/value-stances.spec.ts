import { expect, type Locator, type Page, test } from "@playwright/test";
import type { ProfileView } from "../shared/contracts/profile-response";

// Fixed browser fixtures for keyboard, refresh and layout behavior; no LLM calls.
const stances: ProfileView["valueStances"] = [
  {
    orientation: "evil",
    stance: "affirm",
    count: 1,
    labels: ["悪役的方向性"],
    targetRef: "villainous_direction",
    scope: {
      entryScope: "人物Aの闇堕ち形態",
      subjects: ["人物A"],
      narrativePhases: ["闇堕ち後"],
      conditions: ["本来の善性との反転が魅力として機能する場合"],
      exceptions: [
        "人物への好意と行為への評価は区別する。関係や物語の時期が変われば、同じ評価が当てはまるとは限らない。",
      ],
    },
  },
  {
    orientation: "evil",
    stance: "affirm",
    count: 1,
    labels: ["冷淡"],
    targetRef: "coldness",
    scope: { subjects: ["人物B"], narrativePhases: ["闇堕ち後"] },
  },
  {
    orientation: "transgressive",
    stance: "reject",
    count: 2,
    labels: ["善への敵対"],
    targetRef: "opposition_to_good",
    scope: { subjects: ["人物A"], relationships: ["主人公側との対立"] },
  },
];

async function mockProfile(page: Page, getStances: () => ProfileView["valueStances"]) {
  const freshness = { status: "fresh", desiredGeneration: 1, builtGeneration: 1, errorCode: null };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/me"))
      return route.fulfill({
        json: {
          data: {
            user: { id: "visual", username: "価値態度の表示確認", membershipTier: "basic" },
            csrfToken: "visual",
          },
        },
      });
    if (path.endsWith("/profile"))
      return route.fulfill({
        json: {
          data: {
            profile: {
              projectionId: "visual",
              generation: 1,
              profileSnapshotId: "visual",
              evidenceSetHash: "visual",
              dimensions: [],
              valueStances: getStances(),
              entryCount: 5,
              updatedAt: "2026-09-06T00:00:00Z",
            },
            freshness,
          },
        },
      });
    if (path.endsWith("/profile/graph")) return route.fulfill({ json: { data: { graph: null, freshness } } });
    return route.fulfill({ json: { data: { entries: [], generations: [], feedback: [] } } });
  });
}

async function expectReadableLayout(page: Page, section: Locator) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const content = section.locator(
    ".value-stance-group-summary, .value-stance-summary:visible, .value-stance-context:visible, .value-stance-context:visible dd",
  );
  for (const element of await content.all()) {
    expect(await element.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await element.evaluate((node) => Number.parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(
      14,
    );
  }
}

for (const domain of ["standard", "dark"] as const) {
  test(`価値態度をキーボードで開閉し、プロフィール更新後も開いた状態を保つ (${domain})`, async ({ page }) => {
    await page.setViewportSize(domain === "dark" ? { width: 320, height: 740 } : { width: 1366, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    let currentStances = stances;
    await page.clock.install();
    await mockProfile(page, () => currentStances);
    await page.goto(`${domain === "dark" ? "/dark-lab/app" : "/app"}/profile`);
    const section = page.getByRole("region", { name: "価値・善悪との関わり方" });
    const groups = section.locator(".value-stance-group");
    const groupSummaries = groups.locator(":scope > summary");
    const details = section.locator(".value-stance-details");
    await expect(groups).toHaveCount(2);
    await expect(section.locator("details[open]")).toHaveCount(0);
    await expectReadableLayout(page, section);

    await groupSummaries.first().focus();
    await page.keyboard.press("Space");
    await expect(groups.first()).toHaveAttribute("open", "");
    await page.keyboard.press("Tab");
    const firstSummary = details.first().locator("summary");
    await expect(firstSummary).toBeFocused();
    await expect(firstSummary).toHaveCSS("outline-width", "2px");
    await page.keyboard.press("Enter");
    await expect(details.first().locator("dl")).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(details.nth(1).locator("summary")).toBeFocused();
    await groupSummaries.nth(1).focus();
    await page.keyboard.press("Enter");
    await expect(groups.nth(1)).toHaveAttribute("open", "");
    await expectReadableLayout(page, section);

    await groupSummaries.first().click();
    await expect(details.first()).not.toBeVisible();
    await expect(groups.nth(1)).toHaveAttribute("open", "");
    await groupSummaries.first().click();
    await expect(details.first().locator("dl")).toBeVisible();

    currentStances = stances.map((item, index) => ({ ...item, count: item.count + (index === 0 ? 1 : 0) }));
    await page.clock.fastForward(10_000);
    await expect(firstSummary).toContainText("肯定的に捉える・2件");
    await expect(section.locator(".value-stance-group[open]")).toHaveCount(2);
    await expect(details.first().locator("dl")).toBeVisible();
    await expectReadableLayout(page, section);
  });
}
