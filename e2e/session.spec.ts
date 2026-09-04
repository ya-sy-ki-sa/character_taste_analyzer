import { expect, test } from "@playwright/test";

test("ログアウトとセッション失効時にトップページへ戻れる", async ({ page, context }) => {
  const username = `session-e2e-${Date.now()}`;
  await page.goto("/");
  await expect(page.getByRole("button", { name: "新規ユーザ作成" })).toBeVisible();
  await expect(page.getByRole("button", { name: "ログイン", exact: true })).toBeVisible();
  await expect(page.getByPlaceholder("ユーザー名を検索")).toHaveCount(0);
  await page.getByRole("button", { name: "新規ユーザ作成" }).click();
  await page.getByLabel("ユーザー名").fill(username);
  const createButton = page.getByRole("button", { name: "アクセスキーを発行" });
  await expect(createButton).toBeDisabled();
  await page.getByRole("button", { name: "利用上の注意を確認する" }).click();
  const usageNotesDialog = page.getByRole("dialog", { name: "利用上の注意" });
  await expect(usageNotesDialog).toContainText(
    "現在ベータ版として提供しているため、予告なくサービス内容の変更・中断・終了を行う場合があります。",
  );
  await expect(usageNotesDialog).toContainText("個人情報や機密情報を入力しないでください");
  await expect(usageNotesDialog).toContainText("AIの分析結果には誤りが含まれる場合があります");
  await usageNotesDialog.getByRole("button", { name: "登録画面に戻る" }).click();
  await page.getByLabel("利用上の注意を確認し、同意します").check();
  await expect(createButton).toBeEnabled();
  await createButton.click();
  const accessKey = await page.locator(".credential-box code").textContent();
  if (!accessKey) throw new Error("アクセスキーが表示されませんでした");
  expect(accessKey).toMatch(/^[0-9a-f-]{36}$/u);
  await page.getByLabel("アクセスキーを安全な場所に保存しました").check();
  await page.getByRole("button", { name: "保存を確認してユーザーを作成" }).click();

  async function login() {
    await page.getByRole("button", { name: "ログイン", exact: true }).click();
    const loginDialog = page.getByRole("dialog", { name: "観測記録を開く" });
    await loginDialog.getByLabel("ユーザー名").fill(username);
    await loginDialog.getByLabel("ログインキー").fill(accessKey);
    await loginDialog.getByRole("button", { name: "ログイン", exact: true }).click();
    await expect(page.getByRole("heading", { name: "好み分析結果" })).toBeVisible({ timeout: 20_000 });
  }

  await login();
  await page.getByRole("button", { name: "ログアウトしてトップページに戻る" }).click();
  await expect(page.getByRole("heading", { name: /好きは、/u })).toBeVisible();

  await login();
  await context.clearCookies();
  await page.locator('.side-nav a[href="/app/entries"]').click();
  await expect(page.getByRole("heading", { name: /好きは、/u })).toBeVisible();

  await login();
  await page.locator('.side-nav a[href="/app/settings"]').click();
  await expect(page.getByRole("heading", { name: "アクセスキー", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "アクセスキーを変更", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "アカウントを削除" }).click();
  await page.getByLabel(new RegExp(`確認のため「${username}」と入力`, "u")).fill(username);
  await page.getByRole("button", { name: "完全に削除" }).click();
  await expect(page.getByRole("heading", { name: /好きは、/u })).toBeVisible();
});
