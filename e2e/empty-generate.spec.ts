import { expect, test } from "@playwright/test";

test("登録・嗜好解析が0件でもオリジナルキャラクター作成画面が安定して表示される", async ({ page, request }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  const username = `empty-${Date.now()}`;
  const createdResponse = await request.post("/api/v1/users", {
    headers: { "Idempotency-Key": crypto.randomUUID() },
    data: { username },
  });
  expect(createdResponse.status()).toBe(201);
  const created = (await createdResponse.json()).data as { user: { id: string }; accessKey: string };
  const activatedResponse = await request.post(`/api/v1/users/${created.user.id}/activate`, {
    headers: { "Idempotency-Key": crypto.randomUUID() },
    data: { accessKey: created.accessKey },
  });
  expect(activatedResponse.ok()).toBe(true);

  await page.goto("/");
  await page.getByPlaceholder("ユーザー名を検索").fill(username);
  await page.getByRole("button", { name: new RegExp(username) }).click();
  await page.getByLabel("アクセスキー").fill(created.accessKey);
  await page.getByRole("button", { name: "ラボに入る" }).click();
  await expect(page).toHaveURL(/\/app\/profile/u);

  await page.goto("/app/entries");
  await expect(page.getByRole("heading", { name: "キャラクター登録" })).toBeVisible();
  await page.getByRole("button", { name: "＋ キャラクターを登録" }).click();
  const preferenceContext = page.getByLabel("特に好きな時期・場面・状態（任意）");
  await expect(preferenceContext).toBeVisible();
  await expect(preferenceContext).not.toHaveAttribute("required", "");
  await expect(page.getByText("今回どの範囲を指すか", { exact: false })).toHaveCount(0);
  const referenceMaterial = page.getByLabel("解析に加えたい参考情報（任意）");
  await expect(referenceMaterial).toBeVisible();
  await expect(referenceMaterial).not.toHaveAttribute("required", "");
  await expect(page.getByText("キャラクターを判断できる資料・説明", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "既成（カスタム）", exact: true }).click();
  const customizationType = page.getByLabel("カスタムの種類");
  await expect(customizationType.locator("option")).toHaveText(["独自解釈", "二次創作", "別設定"]);
  await expect(customizationType).toHaveValue("user_interpretation");
  const personLiking = page.getByRole("checkbox", { name: /人物として好き/u });
  await expect(personLiking).toBeVisible();
  await expect(personLiking).toBeChecked();
  await expect(page.locator(".channel-accordion")).toHaveCount(7);
  const selfRelationAccordion = page.locator(".channel-accordion", { hasText: "自分との重なり・同一化" });
  await expect(selfRelationAccordion.getByRole("checkbox", { name: /自分に似ていると感じる/u })).not.toBeVisible();
  await selfRelationAccordion.getByText("自分との重なり・同一化", { exact: true }).click();
  await expect(selfRelationAccordion.getByRole("checkbox", { name: /自分に似ていると感じる/u })).toBeVisible();
  await page.getByRole("button", { name: "オリジナル", exact: true }).click();
  const characterBasicInfo = page.getByLabel("キャラクター基本情報 必須");
  await expect(characterBasicInfo).toBeVisible();
  await expect(characterBasicInfo).toHaveAttribute("required", "");
  await expect(
    page.getByText("このオリジナルキャラクターがどのような人物か分かる、基本的な設定を入力してください。"),
  ).toBeVisible();
  await expect(referenceMaterial).not.toHaveAttribute("required", "");
  await expect(
    page.getByText(
      "ヴィラン、非道徳、善への無関心、端役、一場面限定、二次創作も、そのまま有効な「好き」として記録します。",
    ),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "閉じる" }).click();

  await page.goto("/app/generate");
  await expect(page.getByRole("heading", { name: "オリジナルキャラクター作成" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "先に嗜好解析を確定してください" })).toBeVisible();
  await expect(
    page.getByText(
      "悪や非道徳、善への無関心、無改心を指定しても、実は善人・悲劇的弁明・贖罪・処罰を自動では追加しません。",
    ),
  ).toHaveCount(0);
  await page.waitForTimeout(500);

  expect(pageErrors).toEqual([]);
});
