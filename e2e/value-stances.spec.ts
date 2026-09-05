import { expect, type Locator, type Page, test } from "@playwright/test";
import type { ProfileView } from "../shared/contracts/profile-response";

// Fixed browser fixtures for layout and disclosure behavior; no LLM calls.
const stances = [
  {
    orientation: "evil",
    stance: "affirm",
    count: 1,
    labels: ["悪役的方向性"],
    targetRef: "villainous_direction",
    scope: {
      entryScope: "カスタマイズ版ソラの闇堕ち形態",
      subjects: ["カスタマイズ版ソラ"],
      narrativePhases: ["闇堕ち後"],
      conditions: ["ヴィランとしての危ない魅力が物語上の対立を深める場合"],
      exceptions: ["人物への好意を、現実の加害行為への賛同として扱わない"],
    },
  },
  {
    orientation: "transgressive",
    stance: "affirm",
    count: 1,
    labels: ["善への敵対"],
    targetRef: "opposition_to_good",
    scope: {
      entryScope: "オロチへの好意",
      subjects: ["オロチ"],
      relationships: ["主人公側との対立"],
      narrativePhases: ["主人公側の正義との対決"],
      conditions: ["正義の力を踏み躙る反・正義の力として描かれ、対立する双方の信念が物語で掘り下げられること"],
      exceptions: [
        "フィクション上の背徳的な興奮であり、現実の加害意図や道徳的支持を示すものではない。人物の魅力と行為への評価は区別し、関係や物語の時期が変われば同じ評価が当てはまるとは限らない。",
      ],
    },
  },
  {
    orientation: "evil",
    stance: "affirm",
    count: 1,
    labels: ["悪役的方向性"],
    targetRef: "villainous_direction",
    scope: {
      entryScope: "キャラクター全体",
      subjects: ["ダークロックマン"],
      relationships: ["主人公側と敵対する"],
      narrativePhases: ["闇堕ち後"],
      conditions: ["悪役的存在として機能する"],
    },
  },
  {
    orientation: "transgressive",
    stance: "reject",
    count: 2,
    labels: ["善への敵対"],
    targetRef: "opposition_to_good",
    scope: {
      entryScope: "光と闇の対立",
      subjects: ["カスタマイズ版ソラ"],
      relationships: ["光の守護者たちへの敵対"],
      narrativePhases: ["ヴィランとしての登場時"],
      conditions: ["物語の事情を無視して、すべての行為を一律に肯定すること"],
    },
  },
  {
    orientation: "transgressive",
    stance: "ambivalent",
    count: 1,
    labels: ["堕落", "変化に対する葛藤"],
    targetRef: "corruption",
    scope: {
      entryScope: "人物変化",
      subjects: ["ソラ", "カスタマイズ版ソラ"],
      relationships: ["ラスボスによる闇堕ち"],
      narrativePhases: ["光の主人公から闇の器への変質"],
      conditions: ["本来の善性との反転が魅力として機能する場合"],
    },
  },
  {
    orientation: "evil",
    stance: "affirm",
    count: 1,
    labels: ["冷淡"],
    targetRef: "coldness",
    scope: {
      entryScope: "闇堕ち後の人物像",
      subjects: ["カスタマイズ版ソラ"],
      narrativePhases: ["闇堕ち後"],
    },
  },
  {
    orientation: "evil",
    stance: "affirm",
    count: 1,
    labels: ["悪そのものへの志向"],
    targetRef: "evil_orientation",
    scope: {
      entryScope: "道徳的方向性",
      subjects: ["カスタマイズ版ソラ"],
      narrativePhases: ["闇堕ち後"],
    },
  },
] satisfies ProfileView["valueStances"];

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
  const appBase = domain === "dark" ? "/dark-lab/app" : "/app";

  test(`価値態度の見出しに項目数を表示し、グループと各項目を開閉できる (${domain})`, async ({ page, browser }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let currentStances = stances;
    await page.clock.install();
    await mockProfile(page, () => currentStances);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${appBase}/profile`);
    const section = page.getByRole("region", { name: "価値・善悪との関わり方" });
    const groups = section.locator(".value-stance-group");
    const groupSummaries = groups.locator(":scope > summary");
    const rows = section.locator("li");
    const details = section.locator(".value-stance-details");
    await expect(rows).toHaveCount(7);
    await expect(section.locator(".value-stance-group-title")).toHaveText(["悪そのもの4件", "規範からの逸脱3件"]);
    await expect(groups.nth(0).locator("li")).toHaveCount(4);
    await expect(groups.nth(1).locator("li")).toHaveCount(3);
    await expect(section.locator("details[open]")).toHaveCount(0);
    await expect(rows.first()).not.toBeVisible();
    for (const width of [1366, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expectReadableLayout(page, section);
      await section.screenshot({ path: `test-results/value-stances-${domain}-${width}-collapsed.png` });
    }
    await groupSummaries.nth(0).focus();
    await page.keyboard.press("Space");
    await expect(groups.nth(0)).toHaveAttribute("open", "");
    await expect(rows.first()).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(details.first().locator("summary")).toBeFocused();
    await groupSummaries.nth(1).focus();
    await page.keyboard.press("Enter");
    await expect(section.locator(".value-stance-group[open]")).toHaveCount(2);
    expect(await groupSummaries.nth(1).evaluate((node) => getComputedStyle(node).outlineWidth)).toBe("2px");
    const groupedStances = [stances[0], stances[2], stances[5], stances[6], stances[1], stances[3], stances[4]];
    for (const [index, stance] of groupedStances.entries()) {
      const summary = rows.nth(index).locator("summary");
      await expect(summary).toContainText(stance.labels.join("、"));
      await expect(summary).toContainText(stance.scope.entryScope);
      await expect(summary).toContainText(stance.scope.subjects.join("、"));
    }
    await expect(rows.nth(5).locator("summary")).toContainText("支持しない・2件");
    await expect(rows.nth(6).locator("summary")).toContainText("肯定・否定の両面がある・1件");
    for (const width of [1366, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expectReadableLayout(page, section);
      const boxes = await rows.evaluateAll((elements) =>
        elements.map((element) => element.getBoundingClientRect().toJSON()),
      );
      for (let index = 1; index < boxes.length; index++) {
        expect(boxes[index].x).toBe(boxes[0].x);
        expect(boxes[index].width).toBe(boxes[0].width);
        expect(boxes[index].y).toBeGreaterThanOrEqual(boxes[index - 1].bottom);
      }
      await section.screenshot({ path: `test-results/value-stances-${domain}-${width}-items.png` });
    }

    const firstSummary = details.nth(0).locator("summary");
    await firstSummary.focus();
    await page.keyboard.press("Space");
    await expect(details.nth(0)).toHaveAttribute("open", "");
    await page.keyboard.press("Tab");
    await expect(details.nth(1).locator("summary")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(section.locator(".value-stance-details[open]")).toHaveCount(2);
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Space");
    await expect(details.nth(0)).not.toHaveAttribute("open");
    await page.keyboard.press("Enter");
    await expect(firstSummary).toBeFocused();
    expect(await firstSummary.evaluate((node) => getComputedStyle(node).outlineWidth)).toBe("2px");
    await details.nth(4).locator("summary").click();
    await groupSummaries.nth(0).click();
    await expect(rows.first()).not.toBeVisible();
    await expect(groups.nth(1)).toHaveAttribute("open", "");
    await groupSummaries.nth(0).click();
    await expect(details.first().locator("dl")).toBeVisible();

    currentStances = stances.map((item, index) => ({ ...item, count: item.count + (index === 0 ? 1 : 0) }));
    await page.clock.fastForward(10_000);
    await expect(firstSummary).toContainText("肯定的に捉える・2件");
    await expect(section.locator(".value-stance-group[open]")).toHaveCount(2);
    await expect(section.locator(".value-stance-details[open]")).toHaveCount(3);
    await expect(section.locator(".value-stance-group-count")).toHaveText(["4件", "3件"]);
    for (const width of [1366, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expectReadableLayout(page, section);
      for (const index of [0, 4]) {
        const context = details.nth(index).locator("dl");
        await expect(context.getByText("例外・除外", { exact: true })).toBeVisible();
        await expect(context).toContainText(String(groupedStances[index].scope.exceptions));
      }
      await section.screenshot({ path: `test-results/value-stances-${domain}-${width}-expanded.png` });
      await section.evaluate((node) => node.scrollIntoView({ block: "start" }));
      await page.screenshot({ path: `test-results/value-stances-${domain}-${width}-viewport.png` });
    }

    // Browser zoom at 200% halves the CSS viewport and doubles raster scale.
    const zoomContext = await browser.newContext({
      baseURL: new URL(page.url()).origin,
      viewport: { width: 683, height: 450 },
      deviceScaleFactor: 2,
      reducedMotion: "reduce",
    });
    try {
      const zoomPage = await zoomContext.newPage();
      zoomPage.on("pageerror", (error) => errors.push(error.message));
      await mockProfile(zoomPage, () => stances);
      await zoomPage.goto(`${appBase}/profile`);
      const zoomSection = zoomPage.getByRole("region", { name: "価値・善悪との関わり方" });
      const zoomGroup = zoomSection.locator(".value-stance-group").nth(1);
      await zoomGroup.locator(":scope > summary").click();
      await zoomGroup.locator(".value-stance-details > summary").first().click();
      await expectReadableLayout(zoomPage, zoomSection);
      await zoomSection.screenshot({ path: `test-results/value-stances-${domain}-zoom-200.png` });
      await zoomGroup
        .locator(".value-stance-details > summary")
        .first()
        .evaluate((node) => node.scrollIntoView({ block: "start" }));
      await zoomPage.screenshot({ path: `test-results/value-stances-${domain}-zoom-200-viewport.png` });
    } finally {
      await zoomContext.close();
    }
    expect(errors).toEqual([]);
  });

  test(`価値態度が空、1件、詳細なしの場合も適切に表示する (${domain})`, async ({ page }) => {
    let currentStances: ProfileView["valueStances"] = [];
    await mockProfile(page, () => currentStances);
    await page.goto(`${appBase}/profile`);
    await expect(page.getByRole("heading", { name: "好み分析結果" })).toBeVisible();
    const section = page.getByRole("region", { name: "価値・善悪との関わり方" });
    await expect(section).toHaveCount(0);
    currentStances = [stances[0]];
    await page.reload();
    await expect(section.locator("li")).toHaveCount(1);
    await expect(section.locator(".value-stance-group-count")).toHaveText("1件");
    await section.locator(".value-stance-group > summary").click();
    await section.locator(".value-stance-details > summary").click();
    await expect(section.getByText("例外・除外", { exact: true })).toBeVisible();
    currentStances = [{ orientation: "good", stance: "accept", count: 3, labels: [], scope: { unknown: "非表示" } }];
    await page.reload();
    await expect(section.locator("li")).toHaveCount(1);
    await expect(section.locator(".value-stance-group-count")).toHaveText("1件");
    await section.locator(".value-stance-group > summary").click();
    await expect(section).toContainText("善を重視する姿勢");
    await expect(section).toContainText("受け入れる・3件");
    await expect(section.locator("li").locator("summary, details, dl")).toHaveCount(0);
    await expect(section).not.toContainText("対象人物");
    await expect(section).not.toContainText("非表示");
  });
}
