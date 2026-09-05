import { expect, test } from "@playwright/test";

for (const domain of ["standard", "dark"] as const) {
  for (const [width, height] of [
    [1440, 1000],
    [1366, 768],
    [390, 844],
    [320, 720],
  ]) {
    test(`${domain} ${width}px: 長文・エラー・フォーカス・モーション軽減`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      let authenticated = true;
      await page.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith("/me") && !authenticated)
          return route.fulfill({
            status: 401,
            json: { error: { code: "SESSION_REQUIRED", message: "ログインしてください" } },
          });
        if (path.endsWith("/me"))
          return route.fulfill({
            json: {
              data: {
                user: { id: "visual-user", username: "画面確認", membershipTier: "basic" },
                csrfToken: "visual-fixture",
              },
            },
          });
        if (route.request().method() === "POST")
          return route.fulfill({
            status: 422,
            json: {
              error: {
                code: "INPUT_REJECTED",
                message: "入力を確認してください。" + "確認が必要な長い説明文。".repeat(20),
              },
            },
          });
        return route.fulfill({ json: { data: { entries: [] } } });
      });
      const prefix = domain === "dark" ? "/dark-lab" : "";
      await page.goto(`${prefix}/app/entries`);
      const open = page.getByRole("button", { name: "＋ キャラクターを登録" });
      await open.click();
      const modal = page.getByRole("dialog");
      await expect(modal).toBeVisible();
      await modal.getByRole("button", { name: "閉じる", exact: true }).focus();
      await page.keyboard.press("Shift+Tab");
      await expect(modal.getByRole("button", { name: "保存して理解抽出を開始" })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(modal.getByRole("button", { name: "閉じる", exact: true })).toBeFocused();
      await modal.getByRole("button", { name: "オリジナル", exact: true }).click();
      await modal.getByLabel("キャラクター名", { exact: false }).fill("長い名前の試験キャラクター".repeat(5));
      await modal.getByLabel("キャラクター基本情報", { exact: false }).fill("試験用の架空人物の設定。".repeat(200));
      if (domain === "dark")
        await modal
          .getByLabel("注目するダーク状態・役割", { exact: false })
          .fill("外部からの支配に抵抗している状態。".repeat(20));
      await modal.getByLabel("好きな理由", { exact: true }).fill("物語の展開と葛藤が好き。".repeat(50));
      await modal.getByRole("button", { name: "保存して理解抽出を開始" }).click();
      await expect(modal.locator(".notice-danger")).toContainText("入力を確認してください");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await modal.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
      await testInfo.attach("registration-error", { body: await page.screenshot(), contentType: "image/png" });
      page.once("dialog", (dialog) => dialog.accept());
      await page.keyboard.press("Escape");
      await expect(modal).not.toBeVisible();
      await expect(open).toBeFocused();
      authenticated = false;
      await page.goto(`${prefix}/`);
      await expect(page.locator(".scope-scan")).toHaveCSS("animation-name", "none");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(errors).toEqual([]);
    });
  }
}
