import { type APIRequestContext, request as createRequest, expect, test } from "@playwright/test";

async function createUser(api: APIRequestContext, prefix: string) {
  const username = `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
  const registration = await api.post("/api/v1/users", {
    headers: { "Idempotency-Key": crypto.randomUUID(), Origin: "http://localhost:41737" },
    data: { username },
  });
  expect(registration.status()).toBe(201);
  const created = (await registration.json()).data as { user: { id: string }; accessKey: string };
  const activation = await api.post(`/api/v1/users/${created.user.id}/activate`, {
    headers: { "Idempotency-Key": crypto.randomUUID(), Origin: "http://localhost:41737" },
    data: { accessKey: created.accessKey },
  });
  expect(activation.ok()).toBe(true);
  const login = await api.post("/api/v1/sessions", {
    headers: { "Idempotency-Key": crypto.randomUUID(), Origin: "http://localhost:41737" },
    data: { userId: created.user.id, accessKey: created.accessKey },
  });
  expect(login.ok()).toBe(true);
  const loginData = (await login.json()).data as { csrfToken: string };
  return { ...created, username, csrfToken: loginData.csrfToken };
}

function jsonBodyOfSize(size: number): string {
  const value = { username: `body-limit-${crypto.randomUUID()}`, padding: "" };
  const empty = JSON.stringify(value);
  const paddingSize = size - new TextEncoder().encode(empty).byteLength;
  if (paddingSize < 0) throw new Error("requested body size is too small");
  return JSON.stringify({ ...value, padding: "x".repeat(paddingSize) });
}

test("E2E専用環境のreadinessがReplay/Fakeを報告する", async ({ request }) => {
  const response = await request.get("/api/v1/health/ready");
  expect(response.status()).toBe(200);
  expect((await response.json()).data).toMatchObject({
    status: "ready",
    llmProvider: "replay",
    embeddingProvider: "fake",
    checks: { database: true, configuration: true, embedding: true },
  });
});

test("Origin欠落と64 KiB境界を共通envelopeで処理する", async ({ request }) => {
  const noOrigin = await request.post("/api/v1/users", {
    headers: { "Idempotency-Key": crypto.randomUUID() },
    data: { username: `origin-required-${Date.now()}` },
  });
  expect(noOrigin.status()).toBe(403);
  expect((await noOrigin.json()).error.code).toBe("ORIGIN_REQUIRED");

  const invalid = await request.post("/api/v1/users", {
    headers: { "Idempotency-Key": crypto.randomUUID(), Origin: "http://localhost:41737" },
    data: { username: "" },
  });
  expect(invalid.status()).toBe(400);
  expect((await invalid.json()).error).toMatchObject({ code: "VALIDATION_ERROR", requestId: expect.any(String) });

  const atLimit = await request.post("/api/v1/users", {
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
      Origin: "http://localhost:41737",
    },
    data: jsonBodyOfSize(64 * 1024),
  });
  expect(atLimit.status()).not.toBe(413);

  const overLimit = await request.post("/api/v1/users", {
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": crypto.randomUUID(),
      Origin: "http://localhost:41737",
    },
    data: jsonBodyOfSize(64 * 1024 + 1),
  });
  expect(overLimit.status()).toBe(413);
  expect((await overLimit.json()).error.code).toBe("REQUEST_TOO_LARGE");
});

test("CSRF・水平権限・stored XSS・実行中削除を防御する", async ({ page }) => {
  const documentResponse = await page.request.get("/");
  expect(documentResponse.headers()["content-security-policy"]).toContain("worker-src 'self' blob:");
  const first = await createUser(page.request, "security-a");
  const xssMarker = '<img src=x onerror="window.__storedXss=true">';
  const entryKey = crypto.randomUUID();
  const entryData = {
    registrationType: "original" as const,
    characterName: "安全性検証",
    characterBasicInfo: "仲間を守る責任感の強い人物。危険な状況では自分を犠牲にして仲間を逃がす。",
    referenceMaterial: `仲間を守る責任感の強い人物。表示時の安全性も確認する。${xssMarker}`,
    preference: { likedReasons: "責任感が好き", responseChannels: ["person_liking"] },
  };
  const entryResponse = await page.request.post("/api/v1/entries", {
    headers: {
      "Idempotency-Key": entryKey,
      "X-CSRF-Token": first.csrfToken,
      Origin: "http://localhost:41737",
    },
    data: entryData,
  });
  expect(entryResponse.status()).toBe(202);
  const entryId = (await entryResponse.json()).data.entryId as string;
  const replay = await page.request.post("/api/v1/entries", {
    headers: {
      "Idempotency-Key": entryKey,
      "X-CSRF-Token": first.csrfToken,
      Origin: "http://localhost:41737",
    },
    data: entryData,
  });
  expect(replay.status()).toBe(202);
  expect((await replay.json()).data.entryId).toBe(entryId);
  const mismatchedReplay = await page.request.post("/api/v1/entries", {
    headers: {
      "Idempotency-Key": entryKey,
      "X-CSRF-Token": first.csrfToken,
      Origin: "http://localhost:41737",
    },
    data: { ...entryData, characterName: "同じキーの別内容" },
  });
  expect(mismatchedReplay.status()).toBe(409);

  const crossOrigin = await page.request.post("/api/v1/entries", {
    headers: {
      "Idempotency-Key": crypto.randomUUID(),
      "X-CSRF-Token": first.csrfToken,
      Origin: "https://attacker.invalid",
    },
    data: {
      registrationType: "original",
      characterName: "攻撃元",
      characterBasicInfo: "Origin検査の対象となるオリジナルキャラクターの基本情報です。",
      referenceMaterial: "この送信はOrigin検査によって拒否されるべき十分な長さの概要です。",
      preference: { responseChannels: [] },
    },
  });
  expect(crossOrigin.status()).toBe(403);
  expect((await crossOrigin.json()).error.code).toBe("ORIGIN_DENIED");

  const missingCsrf = await page.request.post("/api/v1/entries", {
    headers: { "Idempotency-Key": crypto.randomUUID(), Origin: "http://localhost:41737" },
    data: {
      registrationType: "original",
      characterName: "CSRF検証",
      characterBasicInfo: "CSRF検査の対象となるオリジナルキャラクターの基本情報です。",
      referenceMaterial: "この送信はCSRF検査によって拒否されるべき十分な長さの概要です。",
      preference: { responseChannels: [] },
    },
  });
  expect(missingCsrf.status()).toBe(403);

  await page.goto("/app/entries");
  await expect
    .poll(async () => {
      const response = await page.request.get(`/api/v1/entries/${entryId}`);
      return ((await response.json()).data as { entry: { status: string } }).entry.status;
    })
    .toBe("understanding_review");
  const reviewResponse = await page.request.get(`/api/v1/entries/${entryId}`);
  const review = (await reviewResponse.json()).data as {
    understanding: { id: string; assertions: Array<{ id: string; raw_label: string }> };
  };
  const mutationKey = crypto.randomUUID();
  const mutationBody = {
    action: "add_assertion",
    rawLabel: "冪等な手動追加",
    valueText: "同じ操作の再送では重複しない",
  };
  const mutationHeaders = {
    "Idempotency-Key": mutationKey,
    "X-CSRF-Token": first.csrfToken,
    Origin: "http://localhost:41737",
  };
  const firstMutation = await page.request.post(`/api/v1/understanding-snapshots/${review.understanding.id}/review`, {
    headers: mutationHeaders,
    data: mutationBody,
  });
  const replayedMutation = await page.request.post(
    `/api/v1/understanding-snapshots/${review.understanding.id}/review`,
    { headers: mutationHeaders, data: mutationBody },
  );
  expect(firstMutation.status()).toBe(200);
  expect(replayedMutation.status()).toBe(200);
  expect((await replayedMutation.json()).data.replayed).toBe(true);
  const afterMutation = (await (await page.request.get(`/api/v1/entries/${entryId}`)).json()).data as {
    understanding: { assertions: Array<{ raw_label: string }> };
  };
  expect(afterMutation.understanding.assertions.filter((item) => item.raw_label === "冪等な手動追加")).toHaveLength(1);
  await page.reload();
  await page.getByRole("button", { name: /安全性検証/u }).click();
  await expect(page.getByText(xssMarker, { exact: false }).first()).toBeVisible();
  expect(await page.locator('img[src="x"]').count()).toBe(0);
  expect(await page.evaluate(() => (window as Window & { __storedXss?: boolean }).__storedXss)).not.toBe(true);

  const secondApi = await createRequest.newContext({ baseURL: "http://localhost:41737" });
  const second = await createUser(secondApi, "security-b");
  const horizontalRead = await secondApi.get(`/api/v1/entries/${entryId}`);
  expect(horizontalRead.status()).toBe(404);
  const horizontalMutation = await secondApi.post(`/api/v1/understanding-snapshots/${review.understanding.id}/review`, {
    headers: {
      "Idempotency-Key": crypto.randomUUID(),
      "X-CSRF-Token": second.csrfToken,
      Origin: "http://localhost:41737",
    },
    data: { action: "delete_assertion", targetId: review.understanding.assertions[0].id },
  });
  expect(horizontalMutation.status()).toBe(404);

  const wrongConfirmation = await page.request.delete("/api/v1/account", {
    headers: {
      "Idempotency-Key": crypto.randomUUID(),
      "X-CSRF-Token": first.csrfToken,
      Origin: "http://localhost:41737",
    },
    data: { usernameConfirmation: "一致しない確認名" },
  });
  expect(wrongConfirmation.status()).toBe(422);

  // Deleting while the analysis job may still be running must revoke the session
  // and cascade the user's data without exposing a half-deleted account.
  const deleteFirst = await page.request.delete("/api/v1/account", {
    headers: {
      "Idempotency-Key": crypto.randomUUID(),
      "X-CSRF-Token": first.csrfToken,
      Origin: "http://localhost:41737",
    },
    data: { usernameConfirmation: first.username },
  });
  expect(deleteFirst.status()).toBe(204);
  expect((await page.request.get("/api/v1/me")).status()).toBe(401);

  const deleteSecond = await secondApi.delete("/api/v1/account", {
    headers: {
      "Idempotency-Key": crypto.randomUUID(),
      "X-CSRF-Token": second.csrfToken,
      Origin: "http://localhost:41737",
    },
    data: { usernameConfirmation: second.username },
  });
  expect(deleteSecond.status()).toBe(204);
  await secondApi.dispose();
});
