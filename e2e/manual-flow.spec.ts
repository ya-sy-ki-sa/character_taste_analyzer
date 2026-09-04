import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("ログイン後に3方式の登録画面と主要画面を操作できる", async ({ page, request }) => {
  test.setTimeout(120_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const username = `ui-check-${Date.now()}`;
  const idempotencyKey = crypto.randomUUID();
  const createdResponse = await request.post("/api/v1/users", {
    headers: { "Idempotency-Key": idempotencyKey, Origin: "http://localhost:41737" },
    data: { username, idempotencyKey },
  });
  expect(createdResponse.ok()).toBe(true);
  const created = (await createdResponse.json()).data as { user: { id: string }; accessKey: string };
  const activated = await request.post(`/api/v1/users/${created.user.id}/activate`, {
    headers: { "Idempotency-Key": crypto.randomUUID(), Origin: "http://localhost:41737" },
    data: { accessKey: created.accessKey },
  });
  expect(activated.ok()).toBe(true);

  await page.goto("/");
  await page.getByRole("button", { name: "ログイン", exact: true }).click();
  const loginDialog = page.getByRole("dialog", { name: "観測記録を開く" });
  await loginDialog.getByLabel("ユーザー名").fill(username);
  await loginDialog.getByLabel("ログインキー").fill(created.accessKey);
  await loginDialog.getByRole("button", { name: "ログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/profile/u);
  await expect(page.getByRole("heading", { name: "好み分析結果" })).toBeVisible();

  await page.locator('.side-nav a[href="/app/entries"]').click();
  await page.getByRole("button", { name: "＋ キャラクターを登録" }).click();
  const registrationDialog = page.getByRole("dialog", { name: "キャラクターを登録" });
  await expect(registrationDialog).toBeVisible();
  await expect(page.locator("#root")).toHaveAttribute("inert", "");
  await registrationDialog.getByRole("button", { name: "閉じる" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(registrationDialog.locator(":focus")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "既成", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "既成（カスタム）" })).toBeVisible();
  await expect(page.getByRole("button", { name: "オリジナル", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "既成（カスタム）" }).click();
  await page.getByRole("textbox", { name: "作品名 必須", exact: true }).fill("UI架空作品");
  await page.getByRole("textbox", { name: /^既成キャラクター名 必須/u }).fill("黒曜卿UI原典");
  await page.getByRole("textbox", { name: /^キャラクター名 必須/u }).fill("黒曜卿UI");
  await page.getByLabel("特に好きな時期・場面・状態（任意）").fill("第7章で裏人格が現れている間");
  await page.getByLabel(/基本像からどう違うか/u).fill("善への無関心を明言し、残酷さを楽しむ裏人格だけ。改心しない。");
  await page
    .getByLabel("解析に加えたい参考情報（任意）")
    .fill("物語のヴィランである黒曜卿は、狡猾で冷酷な策略家として主人公たちを妨害する。");
  await page
    .getByLabel("好きな理由", { exact: true })
    .fill("純粋悪と非道徳を穏当化せず、善への無関心を貫き、改心しないところが好き。");
  await page.getByLabel(/善悪・価値観/u).fill("フィクション上の悪そのものを肯定する。");
  await page.getByRole("button", { name: "同一キャラクター候補を確認" }).click();

  await page.getByRole("button", { name: /黒曜卿UI/u }).click();
  await expect(page.getByRole("button", { name: "この理解を確認して好み分析へ" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "既成キャラクターの基本像" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "対象像・基本像からの差分" })).toBeVisible();
  await expect(page.getByText("物語での役割", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("善悪・道徳的な傾向", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("目的・目標", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("narrativeRole", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "原典からどのように変わっているか" })).toBeVisible();
  const baseUnderstandingCard = page.getByRole("heading", { name: "既成キャラクターの基本像" }).locator("..");
  await expect(baseUnderstandingCard.getByText("黒曜卿UI原典", { exact: true })).toBeVisible();
  await baseUnderstandingCard.getByRole("button", { name: "＋ 属性を手動追加" }).click();
  const baseAssertionAddForm = baseUnderstandingCard.locator("form.manual-add-form").first();
  await baseAssertionAddForm.getByLabel("属性名").fill("E2E基本像属性");
  await baseAssertionAddForm.getByLabel("内容").fill("ユーザーが追加した基本像の理解内容");
  await baseAssertionAddForm.getByRole("button", { name: "追加する" }).click();
  let manualBaseAssertion = baseUnderstandingCard
    .locator(".assertion-list > article")
    .filter({ hasText: "E2E基本像属性" });
  await expect(manualBaseAssertion).toBeVisible();
  await manualBaseAssertion.getByRole("button", { name: "修正", exact: true }).click();
  await manualBaseAssertion.getByLabel("属性名").fill("E2E基本像修正属性");
  await manualBaseAssertion.getByLabel("内容").fill("ユーザーが修正した基本像の理解内容");
  await manualBaseAssertion.getByRole("button", { name: "修正を保存" }).click();
  manualBaseAssertion = baseUnderstandingCard
    .locator(".assertion-list > article")
    .filter({ hasText: "E2E基本像修正属性" });
  await expect(manualBaseAssertion.getByText("ユーザーが修正した基本像の理解内容", { exact: true })).toBeVisible();
  await expect(manualBaseAssertion.getByText("ユーザー修正", { exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await manualBaseAssertion.getByRole("button", { name: "削除", exact: true }).click();
  await expect(baseUnderstandingCard.getByText("E2E基本像修正属性", { exact: true })).toHaveCount(0);

  const targetUnderstandingCard = page.getByRole("heading", { name: "対象像・基本像からの差分" }).locator("..");
  await targetUnderstandingCard.getByRole("button", { name: "＋ 属性を手動追加" }).click();
  const assertionAddForm = targetUnderstandingCard.locator("form.manual-add-form").first();
  await assertionAddForm.getByLabel("属性名").fill("E2E手動属性");
  await assertionAddForm.getByLabel("内容").fill("ユーザーが追加した理解内容");
  await assertionAddForm.getByRole("button", { name: "追加する" }).click();
  let manualAssertion = targetUnderstandingCard.locator(".assertion-list > article").filter({ hasText: "E2E手動属性" });
  await expect(manualAssertion).toBeVisible();
  await manualAssertion.getByRole("button", { name: "修正", exact: true }).click();
  await manualAssertion.getByLabel("属性名").fill("E2E修正属性");
  await manualAssertion.getByLabel("内容").fill("ユーザーが修正した理解内容");
  await manualAssertion.getByRole("button", { name: "修正を保存" }).click();
  manualAssertion = targetUnderstandingCard.locator(".assertion-list > article").filter({ hasText: "E2E修正属性" });
  await expect(manualAssertion.getByText("ユーザーが修正した理解内容", { exact: true })).toBeVisible();
  await expect(manualAssertion.getByText("ユーザー修正", { exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await manualAssertion.getByRole("button", { name: "削除", exact: true }).click();
  await expect(targetUnderstandingCard.getByText("E2E修正属性", { exact: true })).toHaveCount(0);

  await targetUnderstandingCard.getByRole("button", { name: "＋ 差分を手動追加" }).click();
  const deltaAddForm = targetUnderstandingCard.locator("form.delta-edit-form").last();
  await deltaAddForm.getByLabel("変更後の設定").fill("ユーザーが追加した差分");
  await deltaAddForm.getByLabel("補足・判定理由（任意）").fill("ユーザーの認識を反映");
  await deltaAddForm.getByRole("button", { name: "追加する" }).click();
  let manualDelta = targetUnderstandingCard
    .locator(".customization-delta")
    .filter({ hasText: "ユーザーが追加した差分" });
  await expect(manualDelta).toBeVisible();
  await manualDelta.getByRole("button", { name: "修正", exact: true }).click();
  await manualDelta.getByLabel("変更後の設定").fill("ユーザーが修正した差分");
  await manualDelta.getByRole("button", { name: "修正を保存" }).click();
  manualDelta = targetUnderstandingCard.locator(".customization-delta").filter({ hasText: "ユーザーが修正した差分" });
  await expect(manualDelta).toBeVisible();
  await expect(manualDelta.getByText("ユーザー修正", { exact: true })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await manualDelta.getByRole("button", { name: "削除", exact: true }).click();
  await expect(targetUnderstandingCard.getByText("ユーザーが修正した差分", { exact: true })).toHaveCount(0);

  const deltaCard = page.locator(".customization-delta").first();
  await expect(deltaCard.getByText("その他の変更", { exact: true })).toBeVisible();
  await expect(deltaCard.getByText("原典の設定", { exact: true })).toBeVisible();
  await expect(deltaCard.getByText("黒曜卿UIの設定", { exact: true })).toBeVisible();
  await expect(deltaCard.locator(".confidence-pill")).toHaveText(/^登録内支持度 \d+%$/u);
  const firstAssertion = page.locator(".assertion-list > article").first();
  await expect(firstAssertion.locator(".assertion-value")).toBeVisible();
  await expect(firstAssertion.locator(".assertion-card-header > .confidence-pill")).toHaveText(/^登録内支持度 \d+%$/u);
  const customizationEvidence = page
    .locator("details.evidence-disclosure")
    .filter({ has: page.getByText("改変内容", { exact: true }) })
    .first();
  await expect(customizationEvidence).not.toHaveAttribute("open", "");
  await customizationEvidence.getByText("詳細を見る", { exact: true }).click();
  await expect(customizationEvidence).toHaveAttribute("open", "");
  await expect(customizationEvidence.getByText("原文照合済み").first()).toBeVisible();
  await expect(customizationEvidence.getByText("改変内容", { exact: true }).first()).toBeVisible();
  await expect(customizationEvidence.getByText("/customizationDescription", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "この理解を確認して好み分析へ" }).click();
  await expect(page.getByRole("button", { name: "すべて確認してプロフィールへ反映" })).toBeVisible({
    timeout: 20_000,
  });
  const reviewDialog = page.getByRole("dialog", { name: "解析内容の確認" });
  await expect(reviewDialog.getByText("人物として好き", { exact: true }).first()).toBeVisible();
  await expect(reviewDialog.getByText(/強さ \d+%/u).first()).toBeVisible();
  await expect(reviewDialog.getByText("person_liking", { exact: true })).toHaveCount(0);
  await expect(reviewDialog.getByText("user_explicit", { exact: true })).toHaveCount(0);
  await expect(reviewDialog.locator("code").filter({ hasText: /^\//u })).toHaveCount(0);
  const preferenceReviewCard = reviewDialog
    .getByRole("heading", { name: "この登録から読み取った「好き」" })
    .locator("..");
  const preferenceList = preferenceReviewCard.locator(".preference-attribute-list");
  await expect(preferenceList.locator(".preference-attribute-group").first()).toBeVisible();
  expect(await preferenceList.locator(".preference-channel-item").count()).toBeGreaterThan(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await preferenceList.scrollIntoViewIfNeeded();
  expect(await reviewDialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  const rejectedPreferenceLabel = await preferenceList
    .locator(".preference-attribute-header > h4")
    .first()
    .textContent();
  expect(rejectedPreferenceLabel).toBeTruthy();
  const rejectedPreferenceGroup = preferenceList
    .locator(".preference-attribute-group")
    .filter({
      has: page.getByRole("heading", { name: rejectedPreferenceLabel ?? "", exact: true }),
    })
    .first();
  const rejectedPreference = rejectedPreferenceGroup.locator(".preference-channel-item").first();
  const matchingPreferenceCount = await rejectedPreferenceGroup.locator(".preference-channel-item").count();
  page.once("dialog", (dialog) => dialog.accept());
  await rejectedPreference.getByRole("button", { name: "削除", exact: true }).click();
  await expect(rejectedPreferenceGroup.locator(".preference-channel-item")).toHaveCount(matchingPreferenceCount - 1);
  const valueStanceList = preferenceReviewCard.locator(".assertion-list").first();
  const rejectedStanceLabel = await valueStanceList.locator(":scope > article strong").first().textContent();
  expect(rejectedStanceLabel).toBeTruthy();
  const matchingStanceCount = await valueStanceList
    .locator(":scope > article")
    .filter({ hasText: rejectedStanceLabel ?? "" })
    .count();
  page.once("dialog", (dialog) => dialog.accept());
  await valueStanceList
    .locator(":scope > article")
    .filter({ hasText: rejectedStanceLabel ?? "" })
    .first()
    .getByRole("button", { name: "削除", exact: true })
    .click();
  await expect(valueStanceList.locator(":scope > article").filter({ hasText: rejectedStanceLabel ?? "" })).toHaveCount(
    matchingStanceCount - 1,
  );
  await page.getByRole("button", { name: "すべて確認してプロフィールへ反映" }).click();
  await expect(page.getByText("現在: 解析済み")).toBeVisible({ timeout: 20_000 });
  await page.getByRole("button", { name: "閉じる" }).click();

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "登録情報をMarkdownで保存" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("黒曜卿UI-登録情報.md");
  const downloadPath = await download.path();
  expect(downloadPath).toBeTruthy();
  const markdown = await readFile(downloadPath as string, "utf8");
  expect(markdown).toContain("# 黒曜卿UI");
  expect(markdown).toContain("既成キャラクターの基本像");
  expect(markdown).toContain("善への無関心を明言");
  expect(markdown).not.toContain("純粋悪と非道徳を穏当化せず");
  expect(markdown).not.toContain("この登録から読み取った");

  await page.locator('.side-nav a[href="/app/profile"]').click();
  await expect(page.getByRole("heading", { name: "惹かれる属性" })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".graph-stage")).toBeVisible();
  await page.getByText("キーボード操作用のノード・エッジ表").click();
  const nodeTable = page.getByRole("table", { name: "表示中のノード" });
  const edgeTable = page.getByRole("table", { name: "表示中のエッジ" });
  await expect(nodeTable).toBeVisible();
  await expect(edgeTable).toBeVisible();
  const firstNode = nodeTable.getByRole("button").first();
  const firstNodeLabel = await firstNode.textContent();
  await firstNode.focus();
  await firstNode.press("Enter");
  await expect(page.locator(".graph-selection strong")).toHaveText(firstNodeLabel ?? "");

  await page.locator('.side-nav a[href="/app/generate"]').click();
  await expect(page.getByRole("heading", { name: "オリジナルキャラクター作成" })).toBeVisible();
  await expect(page.getByLabel("改心・贖罪", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("隠れた善性", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /選択した\d+項目から作成/u }).click();
  await expect(page.getByRole("heading", { name: "霧綴のエナ" })).toBeVisible({ timeout: 20_000 });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "「霧綴のエナ」の履歴を削除" }).click();
  await expect(page.getByText("作成履歴を削除しました。")).toBeVisible();
  await expect(page.getByRole("heading", { name: "まだ作成履歴がありません" })).toBeVisible();

  await page.goto("/app/entries");
  await page.getByRole("button", { name: /黒曜卿UI/u }).click();
  await page
    .getByRole("dialog", { name: "解析内容の確認" })
    .getByRole("button", { name: "入力を見直して再分析" })
    .click();
  const reanalysisDialog = page.getByRole("dialog", { name: "入力を見直して再分析" });
  await expect(reanalysisDialog.getByLabel("作品名 必須")).toHaveValue("UI架空作品");
  await expect(reanalysisDialog.getByLabel(/^既成キャラクター名 必須/u)).toHaveValue("黒曜卿UI原典");
  await expect(reanalysisDialog.getByLabel(/^キャラクター名 必須/u)).toHaveValue("黒曜卿UI");
  await expect(reanalysisDialog.getByLabel("特に好きな時期・場面・状態（任意）")).toHaveValue(
    "第7章で裏人格が現れている間",
  );
  await reanalysisDialog.getByLabel("作品名 必須").fill("UI架空作品・改訂版");
  await reanalysisDialog.getByLabel(/^既成キャラクター名 必須/u).fill("黒曜卿UI原典改訂");
  await reanalysisDialog.getByLabel(/^キャラクター名 必須/u).fill("黒曜卿UI改訂");
  await reanalysisDialog.getByLabel("媒体・版").fill("ゲーム完全版");
  await reanalysisDialog.getByLabel("特に好きな時期・場面・状態（任意）").fill("最終章の決戦中");
  await reanalysisDialog.getByLabel("カスタムの種類").selectOption("alternate_setting");
  await reanalysisDialog.getByLabel("基本像からどう違うか 必須").fill("別世界で支配者となり、改心しない設定。");
  await reanalysisDialog.getByLabel("解析に加えたい参考情報（任意）").fill("再分析時に追加した公式設定メモ");
  await reanalysisDialog.getByLabel("あなた自身のキャラクター解釈").fill("再分析時に見直した解釈");
  await reanalysisDialog.getByRole("textbox", { name: "好きな理由", exact: true }).fill("再分析時に見直した好きな理由");
  await reanalysisDialog.getByLabel("苦手な要素・このキャラで好きではない点").fill("再分析時に追加した苦手な要素");
  await reanalysisDialog.getByLabel("善悪・価値観について残したいニュアンス").fill("悪を悪のまま評価する");
  await expect(reanalysisDialog.getByRole("checkbox", { name: /人物として好き/u })).toBeChecked();
  await reanalysisDialog.getByRole("button", { name: "同一キャラクター候補を確認" }).click();
  await expect(
    page.getByText("入力を新しい履歴として保存し、キャラクター理解から再分析を開始しました。"),
  ).toBeVisible();
  const entryListResponse = await page.request.get("/api/v1/entries");
  expect(entryListResponse.ok()).toBe(true);
  const entryList = (await entryListResponse.json()).data as { entries: Array<{ id: string; title: string }> };
  const revisedEntry = entryList.entries.find((entry) => entry.title === "黒曜卿UI改訂");
  expect(revisedEntry).toBeTruthy();
  const revisedDetailResponse = await page.request.get(`/api/v1/entries/${revisedEntry?.id}`);
  expect(revisedDetailResponse.ok()).toBe(true);
  const revisedDraft = (await revisedDetailResponse.json()).data.entry.draft as Record<string, unknown>;
  expect(revisedDraft).toMatchObject({
    registrationType: "customized_existing",
    workTitle: "UI架空作品・改訂版",
    baseCharacterName: "黒曜卿UI原典改訂",
    characterName: "黒曜卿UI改訂",
    mediaType: "ゲーム完全版",
    preferenceContext: "最終章の決戦中",
    representationType: "alternate_setting",
    customizationDescription: "別世界で支配者となり、改心しない設定。",
    referenceMaterial: "再分析時に追加した公式設定メモ",
    userCharacterView: "再分析時に見直した解釈",
    preference: {
      likedReasons: "再分析時に見直した好きな理由",
      dislikedReasons: "再分析時に追加した苦手な要素",
      valueStanceNote: "悪を悪のまま評価する",
    },
  });
  expect(pageErrors).toEqual([]);
});
