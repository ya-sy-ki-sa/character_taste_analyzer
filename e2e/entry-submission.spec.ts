import { expect, test } from "@playwright/test";

function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

for (const domain of ["standard", "dark"] as const) {
  test(`候補確認から保存まで二重送信せず、応答消失後の再試行でも登録を増やさない (${domain})`, async ({ page }) => {
    const base = domain === "dark" ? "/api/v1/dark" : "/api/v1";
    const headers = { Origin: "http://localhost:41737", "Idempotency-Key": crypto.randomUUID() };
    const username = `send-${domain}-${Date.now()}`;
    const createdResponse = await page.request.post("/api/v1/users", { headers, data: { username } });
    expect(createdResponse.status()).toBe(201);
    const created = (await createdResponse.json()).data;
    const activated = await page.request.post(`/api/v1/users/${created.user.id}/activate`, {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      data: { accessKey: created.accessKey },
    });
    expect(activated.ok()).toBe(true);
    const login = await page.request.post("/api/v1/sessions", {
      headers: { ...headers, "Idempotency-Key": crypto.randomUUID() },
      data: { username, accessKey: created.accessKey },
    });
    expect(login.ok()).toBe(true);
    await page.setViewportSize(domain === "dark" ? { width: 320, height: 740 } : { width: 1366, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(domain === "dark" ? "/dark-lab/app/entries" : "/app/entries");
    await page.getByRole("button", { name: "＋ キャラクターを登録" }).click();
    const registration = page.getByRole("dialog");
    await registration.getByLabel("作品名 必須").fill("重複防止テスト作品");
    await registration.getByLabel("キャラクター名 必須").fill("重複させない人物");
    await registration.getByLabel("好きな理由", { exact: true }).fill("敵対者として知略を巡らせるところが好き");
    if (domain === "dark") await registration.getByLabel("注目するダーク状態・役割 必須").fill("敵対者としての状態");

    const checking = gate();
    const saving = gate();
    let checkCount = 0;
    const keys: Array<string | undefined> = [];
    const results: Array<{ entryId: string; jobId: string; replayed: boolean }> = [];
    await page.route(`**${base}/identity-candidates`, async (route) => {
      checkCount++;
      await checking.promise;
      await route.continue();
    });
    await page.route(`**${base}/entries`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      keys.push(route.request().headers()["idempotency-key"]);
      const response = await route.fetch();
      expect(response.status()).toBe(202);
      results.push((await response.json()).data);
      if (keys.length === 1) {
        await saving.promise;
        // The server saved successfully, but the browser never receives its response.
        await route.abort("failed");
      } else {
        await route.fulfill({ response });
      }
    });

    const repeatSubmit = () =>
      registration.locator("form").evaluate((form) => {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
    await registration.getByRole("button", { name: "保存して理解抽出を開始" }).click();
    await expect(registration.getByRole("button", { name: "候補を確認中…" })).toBeDisabled();
    await page.keyboard.press("Enter");
    await repeatSubmit();
    await expect.poll(() => checkCount).toBe(1);
    expect(keys).toHaveLength(0);
    expect(
      await registration
        .locator("input,textarea,select")
        .evaluateAll((inputs) => inputs.every((input) => input.matches(":disabled"))),
    ).toBe(true);

    checking.release();
    await expect(registration.getByRole("button", { name: "保存・開始中…" })).toBeDisabled();
    await expect.poll(() => results.length).toBe(1);
    await repeatSubmit();
    expect(keys).toHaveLength(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/entry-submission-${domain}.png` });

    saving.release();
    await expect(registration.locator(".notice-danger")).toBeVisible();
    const retry = registration.getByRole("button", { name: "保存して理解抽出を開始" });
    await expect(retry).toBeEnabled();
    await expect(registration.getByLabel("キャラクター名 必須")).toHaveValue("重複させない人物");
    await retry.click();
    await expect(registration).not.toBeVisible();
    expect(checkCount).toBe(1);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect(results[1]).toMatchObject({ entryId: results[0].entryId, jobId: results[0].jobId, replayed: true });
    const entries = (await (await page.request.get(`${base}/entries`)).json()).data.entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe(results[0].entryId);
  });
}
