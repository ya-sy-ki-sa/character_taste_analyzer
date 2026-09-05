import { expect, test } from "@playwright/test";

for (const domain of ["standard", "dark"] as const) {
  test(`質問文と仮説の作成・再作成・選択で既存の好みを保持する (${domain})`, async ({ page }) => {
    test.setTimeout(120_000);
    const base = domain === "dark" ? "/api/v1/dark" : "/api/v1";
    const appBase = domain === "dark" ? "/dark-lab/app" : "/app";
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const headers = { Origin: "http://localhost:41737", "Idempotency-Key": crypto.randomUUID() };
    const username = `hyp-${domain}-${Date.now()}`;
    const createdResponse = await page.request.post("/api/v1/users", { headers, data: { username } });
    expect(createdResponse.status()).toBe(201);
    const created = (await createdResponse.json()).data;
    await page.request.post(`/api/v1/users/${created.user.id}/activate`, {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      data: { accessKey: created.accessKey },
    });
    const login = await page.request.post("/api/v1/sessions", {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      data: { username, accessKey: created.accessKey },
    });
    const session = (await login.json()).data;
    const response = await page.request.post(`${base}/entries`, {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID(), "X-CSRF-Token": session.csrfToken },
      data: {
        registrationType: "original",
        characterName: "仮説を比較する人物",
        characterBasicInfo: "冷酷な策略家として敵対し、支配下でも内的抵抗と知略を持つ。",
        preference: {
          likedReasons: "物語上の敵対者として知略を巡らせ、改心しないところが好き。",
          responseChannels: [domain === "dark" ? "villain_role_fascination" : "narrative_interest"],
        },
        ...(domain === "dark" ? { darkContext: { focusDescription: "外部から操作され、敵対する状態" } } : {}),
      },
    });
    expect(response.status()).toBe(202);
    const entryId = (await response.json()).data.entryId;
    const read = async () => (await (await page.request.get(`${base}/entries/${entryId}`)).json()).data;
    await page.goto(`${appBase}/entries`);
    await page.getByRole("button", { name: /仮説を比較する人物/u }).click();
    const review = page.getByRole("dialog", { name: "解析内容の確認" });
    await review.getByRole("button", { name: "この理解を確認して好み分析へ" }).click({ timeout: 30_000 });
    await expect.poll(async () => (await read()).entry.status).toBe("analysis_review");
    const initial = (await read()).preferenceAnalysis;
    await expect(review.getByRole("heading", { name: "この登録から読み取った「好き」" })).toBeVisible();
    await review.getByText("追加質問・仮説候補を使う", { exact: true }).click();
    const refinements = review.getByRole("region", { name: "好みをもう少し確かめる" });
    const labels = await refinements.locator(".quality-question > span").allTextContents();
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((text) => /[？?]/u.test(text))).toBe(true);
    await refinements.getByRole("button", { name: "仮説候補から選ぶ", exact: true }).click();
    const candidates = refinements.getByRole("group", { name: "仮説候補", exact: true });
    await expect(candidates.getByRole("checkbox").first()).toBeEnabled({ timeout: 30_000 });
    const first = (await read()).preferenceAnalysis;
    expect(first.id).toBe(initial.id);
    expect(first.assertions).toEqual(initial.assertions);
    await expect(candidates.getByRole("button", { name: "決定", exact: true })).toBeDisabled();
    await candidates.getByRole("checkbox").first().focus();
    await page.keyboard.press("Space");
    await expect(candidates.getByRole("button", { name: "決定", exact: true })).toBeEnabled();
    await candidates.getByRole("button", { name: "仮説候補を再作成する" }).click();
    await expect
      .poll(async () => (await read()).preferenceAnalysis.hypothesisPreview?.id)
      .not.toBe(first.hypothesisPreview.id);
    await expect(candidates.getByRole("checkbox").first()).toBeEnabled({ timeout: 30_000 });
    await expect(candidates.getByRole("checkbox").first()).not.toBeChecked();
    await expect(candidates.getByRole("button", { name: "決定", exact: true })).toBeDisabled();
    expect((await read()).preferenceAnalysis.assertions).toEqual(initial.assertions);
    await page.setViewportSize({ width: 1366, height: 900 });
    await candidates.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `test-results/refinement-${domain}-desktop.png` });
    await page.setViewportSize({ width: 320, height: 740 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await candidates.scrollIntoViewIfNeeded();
    expect(await candidates.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/refinement-${domain}-320.png` });
    await candidates.getByRole("checkbox").first().check();
    await candidates.getByRole("button", { name: "決定", exact: true }).click();
    await expect.poll(async () => (await read()).preferenceAnalysis.id, { timeout: 30_000 }).not.toBe(initial.id);
    const final = (await read()).preferenceAnalysis;
    expect(final.assertions).toHaveLength(initial.assertions.length + 1);
    expect(final.hypothesisPreview).toBeNull();
    expect(errors).toEqual([]);
  });
}
