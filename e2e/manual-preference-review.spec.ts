import { expect, test } from "@playwright/test";

for (const domain of ["standard", "dark"] as const) {
  test(`内容訂正の確認文を表示しプロフィールへ反映する (${domain})`, async ({ page }) => {
    test.setTimeout(120_000);
    page.setDefaultTimeout(15_000);
    const base = domain === "dark" ? "/api/v1/dark" : "/api/v1";
    const appBase = domain === "dark" ? "/dark-lab/app" : "/app";
    await page.setViewportSize(domain === "dark" ? { width: 320, height: 740 } : { width: 1366, height: 900 });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const headers = { Origin: "http://localhost:41737", "Idempotency-Key": crypto.randomUUID() };
    const username = `manual-${domain}-${Date.now()}`;
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
    const card = review.locator(".preference-channel-item").first();
    await card.getByRole("button", { name: "編集", exact: true }).click();
    const form = card.locator("form");
    const oldLabel = await form.getByLabel("好みの属性名").inputValue();
    const original = initial.assertions.find((item: { raw_label: string }) => item.raw_label === oldLabel);
    const label = "二人の対等な関係を一方的な支配と服従に固定する描写";
    await form.getByLabel("好みの属性名").fill(label);
    await form.getByLabel("Ontology属性").selectOption("");
    await form.getByRole("combobox", { name: "支持", exact: true }).selectOption("negative");
    await form.getByRole("slider").focus();
    await page.keyboard.press("Home");
    for (let step = 0; step < 16; step++) await page.keyboard.press("ArrowRight");
    await form.getByRole("button", { name: "修正を保存" }).click();
    await expect
      .poll(async () =>
        (await read()).preferenceAnalysis.assertions.some(
          (item: { originalLabel: string }) => item.originalLabel === label,
        ),
      )
      .toBe(true);
    const updated = (await read()).preferenceAnalysis.assertions.find(
      (item: { originalLabel: string }) => item.originalLabel === label,
    );
    expect(updated.evidence).toHaveLength(1);
    expect(updated.evidence[0]).toMatchObject({
      evidenceOrigin: "review",
      verificationStatus: "verified_quote",
      sourceUrl: null,
      canNavigate: false,
    });
    expect(updated.evidence[0].quote).toContain(label);
    expect(updated.evidence[0].quote).toContain("苦手・否定的");
    expect(updated.evidence[0].quote).toContain("反応経路未確定");
    expect(updated.context).toEqual(original.context);
    const savedCard = review.locator(".preference-channel-item").filter({ hasText: label }).first();
    await savedCard.locator(".evidence-disclosure summary").click();
    await expect(savedCard.getByText("ユーザー確認文", { exact: true })).toBeVisible();
    const declaration = savedCard.locator(".evidence-declaration");
    await expect(declaration).toContainText(label);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await declaration.scrollIntoViewIfNeeded();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await declaration.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    await review.getByRole("button", { name: "すべて確認してプロフィールへ反映" }).click();
    await expect.poll(async () => (await read()).entry.status).toBe("active");
    await page.goto(`${appBase}/profile`);
    await expect(page.getByText(label, { exact: true }).first()).toBeVisible({ timeout: 30_000 });
    await page
      .getByText(label, { exact: true })
      .first()
      .evaluate((element) => element.scrollIntoView({ block: "center" }));
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  });
}
