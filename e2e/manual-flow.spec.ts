import { expect, test } from "@playwright/test";

test("ログイン後に3方式の登録画面と主要画面を操作できる", async ({ page, request }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const username = `ui-check-${Date.now()}`;
  const idempotencyKey = crypto.randomUUID();
  const createdResponse = await request.post("/api/v1/users", {
    headers: { "Idempotency-Key": idempotencyKey },
    data: { username, idempotencyKey },
  });
  expect(createdResponse.ok()).toBe(true);
  const created = (await createdResponse.json()).data as { user: { id: string }; accessKey: string };
  const activated = await request.post(`/api/v1/users/${created.user.id}/activate`, {
    headers: { "Idempotency-Key": crypto.randomUUID() },
    data: { accessKey: created.accessKey },
  });
  expect(activated.ok()).toBe(true);

  await page.goto("/");
  await page.getByPlaceholder("ユーザー名を検索").fill(username);
  await page.getByRole("button", { name: new RegExp(username) }).click();
  await page.getByLabel("アクセスキー").fill(created.accessKey);
  await page.getByRole("button", { name: "ラボに入る" }).click();
  await expect(page).toHaveURL(/\/app\/profile/u);
  await expect(page.getByRole("heading", { name: "嗜好解析結果" })).toBeVisible();

  await page.locator('.side-nav a[href="/app/entries"]').click();
  await page.getByRole("button", { name: "＋ キャラクターを登録" }).click();
  await expect(page.getByRole("button", { name: "既成", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "既成（カスタム）" })).toBeVisible();
  await expect(page.getByRole("button", { name: "オリジナル", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "既成（カスタム）" }).click();
  await page.getByLabel(/作品名/u).fill("UI架空作品");
  await page.getByLabel(/キャラクター名/u).fill("黒曜卿UI");
  await page.getByLabel("特に好きな時期・場面・状態（任意）").fill("第7章で裏人格が現れている間");
  await page.getByLabel(/基本像からどう違うか/u).fill("善への無関心を明言し、残酷さを楽しむ裏人格だけ。改心しない。");
  await page
    .getByLabel("解析に加えたい参考情報（任意）")
    .fill("物語のヴィランである黒曜卿は、狡猾で冷酷な策略家として主人公たちを妨害する。");
  await page
    .getByLabel("好きな理由", { exact: true })
    .fill("純粋悪と非道徳を穏当化せず、善への無関心を貫き、改心しないところが好き。");
  await page.getByLabel(/善悪・価値観/u).fill("フィクション上の悪そのものを肯定する。");
  await page.getByRole("button", { name: "保存して理解抽出を開始" }).click();

  await page.getByRole("button", { name: /黒曜卿UI/u }).click();
  await expect(page.getByRole("button", { name: "この理解を確認して嗜好解析へ" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "既成キャラクターの基本像" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "対象像・基本像からの差分" })).toBeVisible();
  await page.getByRole("button", { name: "この理解を確認して嗜好解析へ" }).click();
  await expect(page.getByRole("button", { name: "すべて確認してプロフィールへ反映" })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole("button", { name: "すべて確認してプロフィールへ反映" }).click();
  await expect(page.getByText("現在: 解析済み")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "閉じる" }).click();

  await page.locator('.side-nav a[href="/app/profile"]').click();
  await expect(page.getByRole("heading", { name: "惹かれる属性" })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".graph-stage")).toBeVisible();

  await page.locator('.side-nav a[href="/app/generate"]').click();
  await expect(page.getByRole("heading", { name: "オリジナルキャラクター作成" })).toBeVisible();
  await page.getByRole("button", { name: /選択した\d+項目から作成/u }).click();
  await expect(page.getByRole("heading", { name: "霧綴のエナ" })).toBeVisible({ timeout: 20_000 });
  expect(pageErrors).toEqual([]);
});
