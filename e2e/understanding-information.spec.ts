import { expect, test } from "@playwright/test";

for (const domain of ["standard", "dark"] as const) {
  test(`人物像の情報量と好み分析への続行 (${domain})`, async ({ page }, testInfo) => {
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
    const initial = await read();
    expect(initial.understanding).not.toHaveProperty("confidence");
    expect(initial.understanding.evidenceSummary.assertionCount).toBe(initial.understanding.assertions.length);
    if (domain === "standard") expect(initial.understanding.informationQuality.status).toBe("limited");
    else expect(initial.understanding.informationQuality).toBeUndefined();
    await page.goto(`${appBase}/entries`);
    await page.getByRole("button", { name: /一場面の人物/u }).click();
    const dialog = page.getByRole("dialog", { name: "解析内容の確認" });
    const notice = dialog.getByText("解析時点では人物像の情報が限られています", { exact: true });
    if (domain === "standard") {
      await expect(notice).toBeVisible();
      await expect(dialog.getByText("不足する属性は追加・修正できます。このまま好み分析へ進めます。")).toBeVisible();
      await dialog.getByText("項目ごとの不足理由", { exact: true }).click();
    } else {
      await expect(notice).toHaveCount(0);
      await expect(dialog.getByText("解析時点の人物像の情報量は未評価です。")).toBeVisible();
    }
    const information = dialog.locator(".understanding-information").first();
    if (domain === "standard") {
      await expect(information).toContainText(
        `文章のある項目 ${initial.understanding.informationQuality.contentAspectCount}/7`,
      );
      await expect(information).toContainText(
        `具体的描写のある項目 ${initial.understanding.informationQuality.concreteAspectCount}/7`,
      );
    }
    const evidenceDetails = dialog.locator(".understanding-evidence-summary");
    const evidenceToggle = evidenceDetails.getByText("現在の属性に付いている根拠の内訳", { exact: true });
    await evidenceToggle.focus();
    await evidenceToggle.press("Enter");
    await expect(evidenceDetails.getByText("資料の原文照合済み", { exact: true })).toBeVisible();
    await expect(dialog.getByText(/全体登録内支持度/u)).toHaveCount(0);
    for (const [width, height] of [
      [1440, 1000],
      [1366, 768],
      [390, 844],
      [320, 720],
    ]) {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ reducedMotion: "reduce" });
      await information.scrollIntoViewIfNeeded();
      await expect(information).toBeInViewport();
      await page.screenshot({ path: testInfo.outputPath(`${domain}-${width}-information.png`), fullPage: true });
      await evidenceDetails.scrollIntoViewIfNeeded();
      await expect(dialog).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath(`${domain}-${width}.png`), fullPage: true });
    }
    await dialog.getByRole("button", { name: "この理解を確認して好み分析へ" }).click();
    await expect.poll(async () => (await read()).entry.status, { timeout: 30_000 }).toBe("analysis_review");
    expect((await read()).preferenceAnalysis.assertions.length).toBeGreaterThan(0);
    if (domain === "standard") {
      const reviewed = await read();
      // Detailed audits stay in storage/export; the public review contract stays unchanged.
      expect(reviewed.preferenceAnalysis.qualityContext).not.toHaveProperty("semanticAudit");
      expect((await read()).understanding.informationQuality).toEqual(initial.understanding.informationQuality);
      await expect(
        dialog.getByText("これは解析時点の判定です。確認時の修正内容は、この判定には反映されません。"),
      ).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    expect(errors).toEqual([]);
  });
}
