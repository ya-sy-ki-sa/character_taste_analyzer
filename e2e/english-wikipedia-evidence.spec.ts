import { expect, test } from "@playwright/test";

for (const domain of ["standard", "dark"] as const) {
  test(`英語Wikipediaの出典表示（API応答フィクスチャ） (${domain})`, async ({ page }, testInfo) => {
    test.setTimeout(120_000);
    const base = domain === "dark" ? "/api/v1/dark" : "/api/v1";
    const appBase = domain === "dark" ? "/dark-lab/app" : "/app";
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const username = `sparse-${domain}-${Date.now()}`;
    const headers = { Origin: "http://localhost:41737", "Idempotency-Key": crypto.randomUUID() };
    const userResponse = await page.request.post("/api/v1/users", { headers, data: { username } });
    expect(userResponse.status()).toBe(201);
    const user = (await userResponse.json()).data;
    await page.request.post(`/api/v1/users/${user.user.id}/activate`, {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      data: { accessKey: user.accessKey },
    });
    const login = await page.request.post("/api/v1/sessions", {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      data: { username, accessKey: user.accessKey },
    });
    const session = (await login.json()).data;
    const created = await page.request.post(`${base}/entries`, {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID(), "X-CSRF-Token": session.csrfToken },
      data: {
        registrationType: "original",
        characterName: "一場面の人物",
        characterBasicInfo: "冷酷な策略家として敵対する。",
        preference: { likedReasons: "策略で相手に対抗するところが好き。", responseChannels: [] },
        ...(domain === "dark" ? { darkContext: { focusDescription: "敵対する状態" } } : {}),
      },
    });
    expect(created.status()).toBe(202);
    const entryId = (await created.json()).data.entryId;
    const read = async () => (await (await page.request.get(`${base}/entries/${entryId}`)).json()).data;
    await expect.poll(async () => (await read()).entry.status, { timeout: 30_000 }).toBe("understanding_review");
    // Fake analysis supplies the review; only this response's evidence is a UI fixture.
    await page.route(`**${base}/entries/${entryId}`, async (route) => {
      const response = await route.fetch();
      const payload = await response.json();
      payload.data.understanding.assertions[0].evidence = [
        {
          id: "english-wikipedia-fixture",
          verificationStatus: "verified_quote",
          evidenceOrigin: "source",
          inferenceType: "direct",
          quote: "This is an English Wikipedia evidence display fixture.",
          inputPointer: null,
          sourceTitle: "English evidence fixture",
          sourceUrl: "https://en.wikipedia.org/wiki/Example",
          sourceProvider: "wikipedia_en",
          trustReason: "表示確認用フィクスチャ",
          canNavigate: true,
        },
      ];
      await route.fulfill({ response, json: payload });
    });
    await page.goto(`${appBase}/entries`);
    await page.getByRole("button", { name: /一場面の人物/u }).click();
    const dialog = page.getByRole("dialog", { name: "解析内容の確認" });
    const evidence = dialog.locator(".evidence-disclosure").filter({ hasText: "表示確認用フィクスチャ" });
    await evidence.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(evidence.getByText(/取得元: 英語Wikipedia/u)).toBeVisible();
    await expect(evidence.getByRole("link", { name: "原文へ移動" })).toHaveAttribute(
      "href",
      "https://en.wikipedia.org/wiki/Example",
    );
    for (const width of [1366, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await evidence.scrollIntoViewIfNeeded();
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`english-evidence-${domain}-${width}.png`) });
    }
    expect(errors).toEqual([]);
  });
}
