import { expect, test } from "@playwright/test";
import fixtures from "../tests/fixtures/preference-semantics.json" with { type: "json" };

// Browser layout fixtures; semantic extraction and persistence are tested separately.
for (const domain of ["standard", "dark"] as const) {
  test(`対象人物・否定条件・元表現を確認できる (${domain})`, async ({ page }) => {
    const appBase = domain === "dark" ? "/dark-lab/app" : "/app";
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const cases = fixtures.filter((item) => ["C04", "C11", "C12", "D14"].includes(item.caseId));
    const dimensions = cases.flatMap((fixture) =>
      fixture.expectedAssertions.map((item, index) => ({
        id: `${fixture.caseId}-${index}`,
        stableKey: item.attributeStableKey ?? `${fixture.caseId}-${index}`,
        label: item.attributeStableKey ? "競争・宿敵" : item.rawLabel,
        originalLabel: item.rawLabel,
        category: "relationship",
        responseChannel: null,
        condition: item.context,
        positiveScore: item.polarity === "positive" ? 0.8 : 0,
        negativeScore: item.polarity === "negative" ? 0.8 : 0,
        confidence: 0.9,
        evidenceCount: 1,
        identityCount: 1,
        workCount: 1,
        classification: "emerging",
        flags: [],
      })),
    );
    const freshness = { status: "fresh", desiredGeneration: 1, builtGeneration: 1, errorCode: null };
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/me"))
        return route.fulfill({
          json: {
            data: { user: { id: "visual", username: "条件表示確認", membershipTier: "basic" }, csrfToken: "visual" },
          },
        });
      if (path.endsWith("/entries"))
        return route.fulfill({
          json: {
            data: {
              entries: [
                {
                  id: "visual-entry",
                  title: "対象と条件の表示確認",
                  subtitle: "固定fixture",
                  registrationType: "original",
                  status: "analysis_review",
                },
              ],
            },
          },
        });
      if (path.endsWith("/entries/visual-entry"))
        return route.fulfill({
          json: {
            data: {
              entry: { id: "visual-entry", status: "analysis_review" },
              ontologyAttributes: [],
              understanding: null,
              baseUnderstanding: null,
              darkScopeAssessment: null,
              preferenceAnalysis: {
                id: "visual-analysis",
                uncertainties: [],
                summary: {},
                valueStances: [],
                assertions: dimensions.map((item) => ({
                  id: item.id,
                  raw_label: item.label,
                  originalLabel: item.originalLabel,
                  context: item.condition,
                  polarity: item.negativeScore ? "negative" : "positive",
                  response_channel: null,
                  confidence: 0.9,
                  strength: 0.9,
                  explicitness: "user_explicit",
                  status: "proposed",
                  evidence: [],
                })),
              },
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
                dimensions,
                valueStances: ["相互信頼", "支配・服従"].map((label) => ({
                  orientation: "mixed",
                  stance: "reject",
                  count: 1,
                  labels: [label],
                  targetRef: label,
                  scope: {
                    subjects: ["中也", "太宰"],
                    relationships: [label],
                    conditions: ["ユーザーが二人の関係を読むとき"],
                  },
                })),
                entryCount: 4,
                updatedAt: "2026-09-06T00:00:00Z",
              },
              freshness,
            },
          },
        });
      if (path.endsWith("/profile/graph")) return route.fulfill({ json: { data: { graph: null, freshness } } });
      if (path.endsWith("/profile/snapshot-items"))
        return route.fulfill({
          json: {
            data: {
              snapshot: { id: "visual", generation: 1 },
              items: dimensions.map((item) => ({
                id: item.id,
                type: item.negativeScore ? "negative_preference" : "dimension",
                stableKey: item.stableKey,
                label: item.label,
                payload: {
                  originalLabel: item.originalLabel,
                  condition: item.condition,
                  responseChannel: null,
                  positiveScore: item.positiveScore,
                  negativeScore: item.negativeScore,
                },
              })),
            },
          },
        });
      return route.fulfill({ json: { data: { entries: [], generations: [], feedback: [] } } });
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${appBase}/profile`);
    await expect(page.getByRole("heading", { name: "好み分析結果" })).toBeVisible();
    const details = page.locator(".profile-condition-details");
    for (const detail of await details.all()) await detail.locator("summary").click();
    await expect(page.getByText("ヒューズがロイを肩書きより本人として見て接する", { exact: true })).toBeVisible();
    await expect(page.getByText("昔に戻りたいという願望ではない", { exact: true })).toBeVisible();
    await expect(page.getByText("表現：衝突しても日向と影山が互いを選び直す特別な関係", { exact: true })).toBeVisible();
    for (const width of [1366, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page
        .locator(".confidence-card")
        .screenshot({ path: `test-results/evidence-health-${domain}-${width}.png` });
      await page.locator(".trait-list").first().scrollIntoViewIfNeeded();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const context of await page.locator(".preference-context").all())
        expect(await context.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: `test-results/preference-context-${domain}-${width}.png` });
    }
    await page.goto(`${appBase}/generate`);
    await expect(
      page.getByText("ヒューズがロイを肩書きより本人として見て接する旧友らしさ", { exact: true }),
    ).toBeVisible();
    const descriptions = page.locator(".selection-description");
    const exception = page.getByText(/例外・除外：昔に戻りたいという願望ではない/u);
    await expect(exception).toBeHidden();
    for (const width of [1366, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.locator(".selection-table").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/preference-generation-${domain}-${width}-collapsed.png` });
      for (const description of await descriptions.all()) await description.locator("summary").click();
      await expect(exception).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.locator(".selection-table").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/preference-generation-${domain}-${width}-expanded.png` });
      for (const description of await descriptions.all()) {
        await description.locator("summary").focus();
        await page.keyboard.press("Enter");
      }
      await expect(exception).toBeHidden();
    }
    await page.goto(`${appBase}/entries`);
    await page.getByRole("button", { name: /対象と条件の表示確認/u }).click();
    const review = page.getByRole("dialog", { name: "解析内容の確認" });
    await expect(review.getByText("ヒューズがロイを肩書きより本人として見て接する", { exact: true })).toBeVisible();
    await expect(review.getByText("昔に戻りたいという願望ではない", { exact: true })).toBeVisible();
    const card = review
      .locator(".preference-channel-item")
      .filter({ hasText: "表現：衝突しても日向と影山が互いを選び直す特別な関係" });
    await card.getByRole("button", { name: "編集", exact: true }).click();
    await expect(card.getByLabel("好みの属性名")).toHaveValue("衝突しても日向と影山が互いを選び直す特別な関係");
    for (const width of [1366, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await card.scrollIntoViewIfNeeded();
      expect(await review.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/preference-review-${domain}-${width}.png` });
    }
    expect(errors).toEqual([]);
  });
}
