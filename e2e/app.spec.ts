import { expect, test } from "@playwright/test";

test("作成から分析・訂正・生成・フィードバック・削除まで", async ({ page }) => {
  test.setTimeout(360_000);
  const username = `e2e-${Date.now()}`;
  await page.goto("/");
  await page.getByRole("button", { name: "＋ 新規作成" }).click();
  await page.getByLabel("ユーザー名").fill(username);
  await page.getByRole("button", { name: "アクセスキーを発行" }).click();
  const accessKey = await page.locator(".credential-box code").textContent();
  if (!accessKey) throw new Error("アクセスキーが表示されませんでした");
  expect(accessKey).toMatch(/^[0-9a-f-]{36}$/u);
  await page.getByLabel("アクセスキーを安全な場所に保存しました").check();
  await page.getByRole("button", { name: "保存を確認してユーザーを作成" }).click();

  await page.getByRole("button", { name: new RegExp(username, "u") }).click();
  await page.getByLabel("アクセスキー").fill(accessKey);
  await page.getByRole("button", { name: "ラボに入る" }).click();
  await expect(page.getByRole("heading", { name: "分析プロフィール" })).toBeVisible();

  await page.locator('.side-nav a[href="/app/entries"]').click();
  await page
    .getByRole("button", { name: /キャラを登録/u })
    .first()
    .click();
  await page.getByLabel(/作品名/u).fill("E2E架空作品");
  await page.getByLabel(/キャラクター名/u).fill("E2E架空人物");
  await page
    .getByLabel(/キャラクター概要/u)
    .fill("寡黙だが仲間を守る責任感の強い人物で、少しずつ心を開いて信頼を築く。");
  await page.getByLabel(/好きな点/u).fill("不器用な優しさと仲間を守る姿勢が好きです。");
  await page.getByLabel(/少し苦手な点/u).fill("衝動的な判断は少し苦手です。");
  await page.getByRole("button", { name: "保存して分析" }).click();
  await expect(page.getByText("分析が完了し、プロフィールを更新しました。")).toBeVisible({ timeout: 120_000 });

  await page.locator('.side-nav a[href="/app/profile"]').click();
  await page.getByRole("button", { name: /候補を表示/u }).click();
  await expect(page.locator(".recommendation-card").first()).toBeVisible({ timeout: 180_000 });
  const recommendationCount = await page.locator(".recommendation-card").count();
  expect(recommendationCount).toBeGreaterThanOrEqual(4);
  expect(recommendationCount).toBeLessThanOrEqual(6);
  await expect(page.locator(".recommendation-card .recommendation-traits").first()).toBeVisible();

  await page.locator('.side-nav a[href="/app/entries"]').click();
  await page.getByRole("button", { name: /E2E架空人物/u }).click();
  await expect(page.getByRole("heading", { name: "抽出された属性と根拠" })).toBeVisible();
  const reserved = page.locator(".assertion-row").filter({ hasText: "寡黙・内向的" });
  if (await reserved.count()) await reserved.getByRole("button", { name: "違う" }).click();
  await page.getByRole("button", { name: "閉じる" }).click();

  await page.locator('.side-nav a[href="/app/generate"]').click();
  await page.getByRole("button", { name: /キャラクターを生成/u }).click();
  await expect(page.getByText("キャラクターを生成しました。フィードバックは任意です。")).toBeVisible({
    timeout: 240_000,
  });
  await expect(page.locator(".character-sheet")).toBeVisible({ timeout: 240_000 });
  await page.getByRole("button", { name: "5点" }).click();
  await page.getByRole("button", { name: "フィードバックを保存" }).click();
  await expect(page.getByText(/フィードバックを保存しました/u)).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "閉じる" }).click();

  await page.locator('.side-nav a[href="/app/settings"]').click();
  await page.getByRole("button", { name: "アカウントを削除" }).click();
  await page.getByLabel(new RegExp(`確認のため「${username}」と入力`, "u")).fill(username);
  await page.getByRole("button", { name: "完全に削除" }).click();
  await expect(page.getByRole("heading", { name: /「好き」を集めて/u })).toBeVisible({ timeout: 20_000 });
});
