import { expect, test } from "@playwright/test";

for (const domain of ["standard", "dark"] as const) {
  test(`登録を閉じる際に入力の破棄を確認し、キャンセル時は入力を保持する (${domain})`, async ({ page }) => {
    const headers = { Origin: "http://localhost:41737", "Idempotency-Key": crypto.randomUUID() };
    const username = `close-${domain}-${Date.now()}`;
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
    await page.goto(domain === "dark" ? "/dark-lab/app/entries" : "/app/entries");
    const open = page.getByRole("button", { name: /＋ .*キャラクターを登録/u });
    const registration = page.getByRole("dialog", {
      name: domain === "dark" ? "ダークキャラクターを登録" : "キャラクターを登録",
    });
    const messages: string[] = [];
    let discard = false;
    page.on("dialog", async (dialog) => {
      expect(dialog.type()).toBe("confirm");
      messages.push(dialog.message());
      if (discard) await dialog.accept();
      else await dialog.dismiss();
    });

    await open.click();
    await registration.getByRole("button", { name: "閉じる", exact: true }).click();
    await expect(registration).not.toBeVisible();
    expect(messages).toHaveLength(0);

    await open.click();
    const workTitle = registration.getByLabel("作品名 必須");
    await workTitle.fill("入力途中の作品名");
    const closeActions = [
      () => registration.getByRole("button", { name: "閉じる", exact: true }).click(),
      () => registration.getByRole("button", { name: "キャンセル", exact: true }).click(),
      () => page.keyboard.press("Escape"),
      () => page.getByRole("button", { name: "ダイアログを終了" }).click({ position: { x: 2, y: 2 } }),
    ];
    for (const close of closeActions) {
      const previousCount = messages.length;
      await close();
      expect(messages).toHaveLength(previousCount + 1);
      expect(messages.at(-1)).toBe("入力途中の内容があります。閉じると入力内容は失われます。閉じてもよろしいですか？");
      await expect(registration).toBeVisible();
      await expect(workTitle).toHaveValue("入力途中の作品名");
    }

    await workTitle.fill("");
    await registration.getByRole("button", { name: "閉じる", exact: true }).click();
    await expect(registration).not.toBeVisible();
    expect(messages).toHaveLength(4);

    await open.click();
    const defaultChannel = registration
      .getByRole("group", { name: domain === "dark" ? "ダークな状態の、どこに惹かれるか" : "どういう意味で好きか" })
      .getByRole("checkbox")
      .first();
    await expect(defaultChannel).toBeChecked();
    await defaultChannel.uncheck();
    await page.keyboard.press("Escape");
    expect(messages).toHaveLength(5);
    await expect(registration).toBeVisible();
    await expect(defaultChannel).not.toBeChecked();

    discard = true;
    await registration.getByRole("button", { name: "キャンセル", exact: true }).click();
    await expect(registration).not.toBeVisible();
    expect(messages).toHaveLength(6);
    await open.click();
    await expect(workTitle).toHaveValue("");
    await expect(defaultChannel).toBeChecked();
    await registration.getByRole("button", { name: "閉じる", exact: true }).click();
    await expect(registration).not.toBeVisible();
    expect(messages).toHaveLength(6);
  });
}
