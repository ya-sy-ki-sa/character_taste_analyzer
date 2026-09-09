import { expect, test } from "@playwright/test";

test("登録・好み分析が0件でもオリジナルキャラクター作成画面が安定して表示される", async ({ page, request }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  const username = `empty-${Date.now()}`;
  const createdResponse = await request.post("/api/v1/users", {
    headers: { "Idempotency-Key": crypto.randomUUID(), Origin: "http://localhost:41737" },
    data: { username },
  });
  expect(createdResponse.status()).toBe(201);
  const created = (await createdResponse.json()).data as { user: { id: string }; accessKey: string };
  const activatedResponse = await request.post(`/api/v1/users/${created.user.id}/activate`, {
    headers: { "Idempotency-Key": crypto.randomUUID(), Origin: "http://localhost:41737" },
    data: { accessKey: created.accessKey },
  });
  expect(activatedResponse.ok()).toBe(true);

  await page.goto("/");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  const loginDialog = page.getByRole("dialog", { name: "観測記録を開く" });
  await loginDialog.getByLabel("ユーザー名").fill(username);
  await loginDialog.getByLabel("ログインキー").fill(created.accessKey);
  await loginDialog.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/profile/u);

  await page.goto("/app/generate");
  await expect(page.getByRole("heading", { name: "オリジナルキャラクター作成" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "先に好み分析を確定してください" })).toBeVisible();

  expect(pageErrors).toEqual([]);
});
