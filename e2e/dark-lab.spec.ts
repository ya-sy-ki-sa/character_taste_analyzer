import { expect, test } from "@playwright/test";

test("隠しURLだけから入り、通常トップには導線を出さず、認証セッションを共有する", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator('a[href="/dark-lab"]')).toHaveCount(0);

  await page.goto("/dark-lab");
  await expect(page.getByRole("heading", { name: /悪、堕落、支配の/u })).toBeVisible();
  await expect(page.getByRole("link", { name: "通常のキャラ嗜好ラボへ" })).toHaveAttribute("href", "/");

  const username = `dark-lab-${Date.now()}`;
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

  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  const loginDialog = page.getByRole("dialog", { name: "ログイン" });
  await loginDialog.getByLabel("ユーザー名").fill(username);
  await loginDialog.getByLabel("ログインキー").fill(created.accessKey);
  await loginDialog.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/dark-lab\/app\/profile/u);

  await page.goto("/app/profile");
  await expect(page).toHaveURL(/\/app\/profile/u);
  await expect(page.getByRole("heading", { name: "嗜好解析結果" })).toBeVisible();
  await page.goto("/dark-lab/app/entries");
  await expect(page.getByRole("heading", { name: "ダークキャラクター登録" })).toBeVisible();
});

test("堕落前ベースラインを通常属性へ混ぜず、専用差分からダークプロフィールを作る", async ({ page, request }) => {
  test.setTimeout(120_000);
  const username = `dark-flow-${Date.now()}`;
  const createdResponse = await request.post("/api/v1/users", {
    headers: { "Idempotency-Key": crypto.randomUUID(), Origin: "http://localhost:41737" },
    data: { username },
  });
  const created = (await createdResponse.json()).data as { user: { id: string }; accessKey: string };
  await request.post(`/api/v1/users/${created.user.id}/activate`, {
    headers: { "Idempotency-Key": crypto.randomUUID(), Origin: "http://localhost:41737" },
    data: { accessKey: created.accessKey },
  });

  await page.goto("/dark-lab");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  const loginDialog = page.getByRole("dialog", { name: "ログイン" });
  await loginDialog.getByLabel("ユーザー名").fill(username);
  await loginDialog.getByLabel("ログインキー").fill(created.accessKey);
  await loginDialog.getByRole("button", { name: "ログイン", exact: true }).click();
  await page.goto("/dark-lab/app/entries");
  await page.getByRole("button", { name: "＋ キャラクターを登録" }).click();
  const form = page.getByRole("dialog", { name: "ダークキャラクターを登録" });
  await form.getByRole("button", { name: "既成（カスタム）" }).click();
  await form.getByLabel("作品名 必須").fill("闇化E2E作品");
  await form.getByLabel(/^既成キャラクター名 必須/u).fill("光の勇者E2E");
  await form.getByLabel(/^キャラクター名 必須/u).fill("支配された勇者E2E");
  await form.getByLabel("注目するダーク状態・役割 必須").fill("敵に洗脳され、元の仲間へ剣を向けている期間");
  await form.getByRole("checkbox", { name: "支配された勇者" }).check();
  await form.getByLabel("変化前・通常時（任意）").fill("仲間を守り、自分で判断する勇者だった");
  await form.getByLabel("闇化・敵対化の契機（任意）").fill("敵の術者による洗脳");
  await form.getByLabel("支配者・影響源（任意）").fill("敵の術者");
  await form.getByLabel("認識・抵抗・自我（任意）").fill("自我と正義感が残り、内側で抵抗している");
  await form.getByLabel("基本像からどう違うか 必須").fill("価値観が反転し、命令に従って元味方を攻撃する");
  await form.getByLabel("好きな理由", { exact: true }).fill("正義の反転と、支配下でも残る内的抵抗に惹かれる");
  await form.getByRole("checkbox", { name: /支配・洗脳された状態に惹かれる/u }).check();
  await form.getByRole("button", { name: "同一キャラクター候補を確認" }).click();
  await expect(form).toBeHidden({ timeout: 20_000 });

  const darkEntriesResponse = await page.request.get("/api/v1/dark/entries");
  const darkEntries = (await darkEntriesResponse.json()).data as { entries: Array<{ id: string }> };
  expect(darkEntries.entries).toHaveLength(1);
  const crossDomainResponse = await page.request.get(`/api/v1/entries/${darkEntries.entries[0].id}`);
  expect(crossDomainResponse.status()).toBe(404);

  await page.getByRole("button", { name: /支配された勇者E2E/u }).click();
  const review = page.getByRole("dialog", { name: "解析内容の確認" });
  await expect(review.getByRole("heading", { name: "ダーク化前の比較ベースライン" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(review.getByRole("heading", { name: "ダーク化前からの専用差分" })).toBeVisible();
  await expect(review.getByText("通常分析器や通常嗜好属性には対応させず", { exact: false })).toBeVisible();
  await review.getByRole("button", { name: "この理解を確認して嗜好解析へ" }).click();
  await expect(review.getByRole("button", { name: "すべて確認してプロフィールへ反映" })).toBeVisible({
    timeout: 20_000,
  });
  await expect(review.getByText(/支配・洗脳された状態に惹かれる/u).first()).toBeVisible();
  const preferenceCard = review.locator(".card", { hasText: "この登録から読み取った「好き」" });
  await preferenceCard.getByRole("button", { name: "＋ 嗜好候補を手動追加" }).click();
  const addedPreferenceForm = preferenceCard.locator("form.manual-add-form").last();
  await addedPreferenceForm.getByLabel("嗜好属性名").fill("E2E手動ダーク嗜好");
  await addedPreferenceForm.getByLabel("Ontology属性").selectOption({ label: "価値観の反転" });
  await addedPreferenceForm.getByRole("button", { name: "嗜好候補を追加" }).click();
  let addedPreference = preferenceCard.locator("article", { hasText: "価値観の反転" });
  await expect(addedPreference).toBeVisible();
  await addedPreference.getByRole("button", { name: "編集" }).click();
  await addedPreference.getByLabel("嗜好属性名").fill("E2E修正ダーク嗜好");
  await addedPreference.getByLabel("Ontology属性").selectOption({ label: "自我の保持" });
  await addedPreference.getByRole("button", { name: "修正を保存" }).click();
  await expect(addedPreference.getByLabel("嗜好属性名")).toBeHidden({ timeout: 20_000 });
  addedPreference = preferenceCard.locator("article", { hasText: "自我の保持" }).last();
  await expect(addedPreference).toBeVisible();
  await preferenceCard.getByRole("button", { name: "＋ 価値スタンスを手動追加" }).click();
  const stanceForm = preferenceCard.locator("form.manual-add-form").last();
  await stanceForm.getByLabel("対象の価値・行為・結末").fill("支配下での価値反転");
  await stanceForm.getByRole("button", { name: "保存" }).click();
  await expect(preferenceCard.getByText("支配下での価値反転", { exact: true })).toBeVisible();
  await review.getByRole("button", { name: "すべて確認してプロフィールへ反映" }).click();
  await expect(review.getByText("現在: 解析済み")).toBeVisible({ timeout: 20_000 });
  await review.getByRole("button", { name: "閉じる" }).click();

  await page.goto("/dark-lab/app/profile");
  await expect(page.getByRole("heading", { name: "惹かれる属性" })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".trait-row").first()).toBeVisible();
  await expect(page.getByText(/確認済み 1人／1作品/u).first()).toBeVisible();

  await page.goto("/dark-lab/app/generate");
  await expect(page.getByRole("button", { name: /選択した\d+項目から作成/u })).toBeEnabled({ timeout: 20_000 });
  await page.getByRole("button", { name: /選択した\d+項目から作成/u }).click();
  await expect(page.getByRole("heading", { name: "霧綴のエナ" })).toBeVisible({ timeout: 20_000 });
  await page.locator("button.generation-card", { hasText: "霧綴のエナ" }).click();
  await expect(page.getByRole("heading", { name: "ダーク状態・主体性・変化" })).toBeVisible();

  await page.goto("/app/profile");
  await expect(page.locator(".trait-row")).toHaveCount(0);
  await expect(page.locator(".summary-meta")).toContainText("0確認済み登録");
  await expect(page.getByText("あなたの言葉から輪郭を作成中")).toBeVisible();
});

test("対象外判定だけはユーザー確認で続行できる", async ({ page, request }) => {
  test.setTimeout(90_000);
  const username = `dark-override-${Date.now()}`;
  const createdResponse = await request.post("/api/v1/users", {
    headers: { "Idempotency-Key": crypto.randomUUID(), Origin: "http://localhost:41737" },
    data: { username },
  });
  const created = (await createdResponse.json()).data as { user: { id: string }; accessKey: string };
  await request.post(`/api/v1/users/${created.user.id}/activate`, {
    headers: { "Idempotency-Key": crypto.randomUUID(), Origin: "http://localhost:41737" },
    data: { accessKey: created.accessKey },
  });
  await page.goto("/dark-lab");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  const loginDialog = page.getByRole("dialog", { name: "ログイン" });
  await loginDialog.getByLabel("ユーザー名").fill(username);
  await loginDialog.getByLabel("ログインキー").fill(created.accessKey);
  await loginDialog.getByRole("button", { name: "ログイン", exact: true }).click();
  await page.goto("/dark-lab/app/entries");
  await page.getByRole("button", { name: "＋ キャラクターを登録" }).click();
  const form = page.getByRole("dialog", { name: "ダークキャラクターを登録" });
  await form.getByRole("button", { name: "オリジナル", exact: true }).click();
  await form.getByLabel(/^キャラクター名 必須/u).fill("境界判定E2E");
  await form.getByLabel("キャラクター基本情報 必須").fill("善良な案内人として日常を送る人物");
  await form.getByLabel("注目するダーク状態・役割 必須").fill("ダークではないという判定を意図的に確認する状態");
  await form.getByRole("button", { name: "保存して理解抽出を開始" }).click();

  await page.getByRole("button", { name: /境界判定E2E/u }).click();
  const review = page.getByRole("dialog", { name: "解析内容の確認" });
  await expect(review.getByRole("heading", { name: "ダークラボの対象外と判定されました" })).toBeVisible({
    timeout: 20_000,
  });
  await review.getByRole("button", { name: "対象として続行" }).click();
  await expect(review.getByRole("button", { name: "この理解を確認して嗜好解析へ" })).toBeVisible({
    timeout: 20_000,
  });
});
