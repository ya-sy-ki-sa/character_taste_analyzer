import { expect, test } from "@playwright/test";

for (const domain of ["standard", "dark"] as const) {
  test(`未確定の好みを確認・編集してプロフィールへ反映する (${domain})`, async ({ page }) => {
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
        characterName: "反応経路が未確定の人物",
        characterBasicInfo: "冷酷な策略家として敵対し、支配下でも内的抵抗と知略を持つ。",
        preference: {
          likedReasons: "冷酷な悪役として知略を巡らせ、改心しないところが好き。",
          responseChannels: [],
        },
        ...(domain === "dark" ? { darkContext: { focusDescription: "外部から操作され、敵対する状態" } } : {}),
      },
    });
    expect(response.status()).toBe(202);
    const entryId = (await response.json()).data.entryId;
    const read = async () => (await (await page.request.get(`${base}/entries/${entryId}`)).json()).data;
    await page.goto(`${appBase}/entries`);
    await page.getByRole("button", { name: /反応経路が未確定の人物/u }).click();
    const review = page.getByRole("dialog", { name: "解析内容の確認" });
    await review.getByRole("button", { name: "この理解を確認して好み分析へ" }).click({ timeout: 30_000 });
    await expect.poll(async () => (await read()).entry.status).toBe("analysis_review");
    const initial = (await read()).preferenceAnalysis;
    expect(initial.assertions.length).toBeGreaterThan(1);
    expect(
      initial.assertions.every((item: { response_channel: string | null }) => item.response_channel === null),
    ).toBe(true);
    const card = review.locator(".preference-channel-item").first();
    await expect(card.getByText("反応経路未確定", { exact: true })).toBeVisible();
    await card.getByRole("button", { name: "編集", exact: true }).click();
    const form = card.locator("form");
    await expect(form.getByRole("combobox", { name: "反応経路", exact: true })).toHaveValue("");
    const initialLabel = await form.getByLabel("好みの属性名").inputValue();
    const original = initial.assertions.find((item: { raw_label: string }) => item.raw_label === initialLabel);
    for (const width of [1366, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await form.scrollIntoViewIfNeeded();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await form.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await page.screenshot({ path: `test-results/unresolved-${domain}-${width}.png` });
    }
    await form.getByRole("combobox", { name: "反応経路", exact: true }).focus();
    const channel = domain === "dark" ? "villain_role_fascination" : "narrative_interest";
    await form.getByRole("combobox", { name: "反応経路", exact: true }).selectOption(channel);
    await form.getByRole("button", { name: "修正を保存" }).click();
    await expect
      .poll(async () =>
        (await read()).preferenceAnalysis.assertions.some(
          (item: { response_channel: string }) => item.response_channel === channel,
        ),
      )
      .toBe(true);
    const updated = (await read()).preferenceAnalysis.assertions.find(
      (item: { response_channel: string }) => item.response_channel === channel,
    );
    expect(updated.confidence).toBe(original.confidence);
    expect(updated.evidence.length).toBe(original.evidence.length);
    expect(updated.evidence[0].quote).toBe(original.evidence[0].quote);
    await review.getByRole("button", { name: "すべて確認してプロフィールへ反映" }).click();
    await expect.poll(async () => (await read()).entry.status).toBe("active");
    await page.goto(`${appBase}/profile`);
    await expect(page.getByText(/反応経路未確定/u).first()).toBeVisible({ timeout: 30_000 });
    for (const width of [1366, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.locator(".trait-list").first().scrollIntoViewIfNeeded();
      await page.screenshot({ path: `test-results/unresolved-profile-${domain}-${width}.png` });
    }
    expect(errors).toEqual([]);
  });
}
