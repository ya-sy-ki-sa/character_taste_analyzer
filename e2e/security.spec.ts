import { type APIRequestContext, request as createRequest, expect, test } from "@playwright/test";

async function createUser(api: APIRequestContext, prefix: string) {
  const username = `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
  const registration = await api.post("/api/v1/users", {
    headers: { "Idempotency-Key": crypto.randomUUID(), Origin: "http://localhost:5173" },
    data: { username },
  });
  expect(registration.status()).toBe(201);
  const created = (await registration.json()).data as { user: { id: string }; accessKey: string };
  const activation = await api.post(`/api/v1/users/${created.user.id}/activate`, {
    headers: { "Idempotency-Key": crypto.randomUUID(), Origin: "http://localhost:5173" },
    data: { accessKey: created.accessKey },
  });
  expect(activation.ok()).toBe(true);
  const login = await api.post("/api/v1/sessions", {
    headers: { "Idempotency-Key": crypto.randomUUID(), Origin: "http://localhost:5173" },
    data: { userId: created.user.id, accessKey: created.accessKey },
  });
  expect(login.ok()).toBe(true);
  const loginData = (await login.json()).data as { csrfToken: string };
  return { ...created, username, csrfToken: loginData.csrfToken };
}

test("CSRF・水平権限・stored XSS・実行中削除を防御する", async ({ page }) => {
  const first = await createUser(page.request, "security-a");
  const xssMarker = '<img src=x onerror="window.__storedXss=true">';
  const entryResponse = await page.request.post("/api/v1/entries", {
    headers: {
      "Idempotency-Key": crypto.randomUUID(),
      "X-CSRF-Token": first.csrfToken,
      Origin: "http://localhost:5173",
    },
    data: {
      kind: "original",
      characterName: "安全性検証",
      overview: `仲間を守る責任感の強い人物。表示時の安全性も確認する。${xssMarker}`,
    },
  });
  expect(entryResponse.status()).toBe(202);
  const entryId = (await entryResponse.json()).data.entryId as string;

  const crossOrigin = await page.request.post("/api/v1/entries", {
    headers: {
      "Idempotency-Key": crypto.randomUUID(),
      "X-CSRF-Token": first.csrfToken,
      Origin: "https://attacker.invalid",
    },
    data: { kind: "original", overview: "この送信はOrigin検査によって拒否されるべき十分な長さの概要です。" },
  });
  expect(crossOrigin.status()).toBe(403);

  const missingCsrf = await page.request.post("/api/v1/entries", {
    headers: { "Idempotency-Key": crypto.randomUUID(), Origin: "http://localhost:5173" },
    data: { kind: "original", overview: "この送信はCSRF検査によって拒否されるべき十分な長さの概要です。" },
  });
  expect(missingCsrf.status()).toBe(403);

  await page.goto("/app/entries");
  await expect(page.getByText(xssMarker, { exact: false })).toBeVisible();
  expect(await page.locator('img[src="x"]').count()).toBe(0);
  expect(await page.evaluate(() => (window as Window & { __storedXss?: boolean }).__storedXss)).not.toBe(true);

  const secondApi = await createRequest.newContext({ baseURL: "http://localhost:5173" });
  const second = await createUser(secondApi, "security-b");
  const horizontalRead = await secondApi.get(`/api/v1/entries/${entryId}`);
  expect(horizontalRead.status()).toBe(404);

  // Deleting while the analysis job may still be running must revoke the session
  // and cascade the user's data without exposing a half-deleted account.
  const deleteFirst = await page.request.delete("/api/v1/account", {
    headers: {
      "Idempotency-Key": crypto.randomUUID(),
      "X-CSRF-Token": first.csrfToken,
      Origin: "http://localhost:5173",
    },
  });
  expect(deleteFirst.status()).toBe(204);
  expect((await page.request.get("/api/v1/me")).status()).toBe(401);

  const deleteSecond = await secondApi.delete("/api/v1/account", {
    headers: {
      "Idempotency-Key": crypto.randomUUID(),
      "X-CSRF-Token": second.csrfToken,
      Origin: "http://localhost:5173",
    },
  });
  expect(deleteSecond.status()).toBe(204);
  await secondApi.dispose();
});
