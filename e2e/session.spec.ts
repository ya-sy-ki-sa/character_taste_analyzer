import { expect, test } from "@playwright/test";

test("ログアウトとセッション失効時にトップページへ戻れる", async ({ page, context }) => {
  const username = `session-e2e-${Date.now()}`;
  await page.goto("/");
  await page.getByRole("button", { name: "＋ 新規作成" }).click();
  await page.getByLabel("ユーザー名").fill(username);
  await page.getByRole("button", { name: "アクセスキーを発行" }).click();
  const accessKey = await page.locator(".credential-box code").textContent();
  if (!accessKey) throw new Error("アクセスキーが表示されませんでした");
  expect(accessKey).toMatch(/^[0-9a-f-]{36}$/u);
  await page.getByLabel("アクセスキーを安全な場所に保存しました").check();
  await page.getByRole("button", { name: "保存を確認してユーザーを作成" }).click();

  async function login() {
    await page.getByRole("button", { name: new RegExp(username, "u") }).click();
    await page.getByLabel("アクセスキー").fill(accessKey);
    await page.getByRole("button", { name: "ラボに入る" }).click();
    await expect(page.getByRole("heading", { name: "分析プロフィール" })).toBeVisible();
  }

  await login();
  await page.getByRole("button", { name: "ログアウトしてトップページに戻る" }).click();
  await expect(page.getByRole("heading", { name: /「好き」を集めて/u })).toBeVisible();

  await login();
  await context.clearCookies();
  await page.locator('.side-nav a[href="/app/entries"]').click();
  await expect(page.getByRole("heading", { name: /「好き」を集めて/u })).toBeVisible();

  await login();
  await page.locator('.side-nav a[href="/app/settings"]').click();
  await page.getByRole("button", { name: "アカウントを削除" }).click();
  await page.getByLabel(new RegExp(`確認のため「${username}」と入力`, "u")).fill(username);
  await page.getByRole("button", { name: "完全に削除" }).click();
  await expect(page.getByRole("heading", { name: /「好き」を集めて/u })).toBeVisible();
});
