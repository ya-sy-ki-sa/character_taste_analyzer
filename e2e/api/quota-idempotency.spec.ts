import { expect, test } from "@playwright/test";

test("別対象の再分析に同じキーを使っても分析クォータを再利用しない", async ({ request }) => {
  const origin = "http://localhost:41737";
  const username = `quota-${crypto.randomUUID().slice(0, 8)}`;
  const publicHeaders = () => ({ Origin: origin, "Idempotency-Key": crypto.randomUUID() });
  const registration = await request.post("/api/v1/users", {
    headers: publicHeaders(),
    data: { username },
  });
  expect(registration.status()).toBe(201);
  const { user, accessKey } = (await registration.json()).data as { user: { id: string }; accessKey: string };
  const activation = await request.post(`/api/v1/users/${user.id}/activate`, {
    headers: publicHeaders(),
    data: { accessKey },
  });
  expect(activation.status()).toBe(200);
  const login = await request.post("/api/v1/sessions", {
    headers: publicHeaders(),
    data: { username, accessKey },
  });
  expect(login.status()).toBe(200);
  const csrfToken = ((await login.json()).data as { csrfToken: string }).csrfToken;
  const headers = (key = crypto.randomUUID()) => ({
    Origin: origin,
    "Idempotency-Key": key,
    "X-CSRF-Token": csrfToken,
  });
  const draft = {
    registrationType: "original",
    characterName: "予約の対象確認",
    characterBasicInfo: "同じ入力の別キャラクターでも各再分析にクォータを割り当てる確認用の説明です。",
    preference: { likedReasons: "責任感のある行動が好き", responseChannels: ["person_liking"] },
  };
  const entryIds: string[] = [];
  for (let index = 0; index < 2; index++) {
    const created = await request.post("/api/v1/entries", { headers: headers(), data: draft });
    expect(created.status()).toBe(202);
    entryIds.push(((await created.json()).data as { entryId: string }).entryId);
  }
  expect(entryIds[0]).not.toBe(entryIds[1]);
  for (const entryId of entryIds) {
    await expect
      .poll(async () => {
        const response = await request.get(`/api/v1/entries/${entryId}`);
        return ((await response.json()).data as { entry: { status: string } }).entry.status;
      })
      .toBe("understanding_review");
  }
  const reusedKey = crypto.randomUUID();
  const first = await request.post(`/api/v1/entries/${entryIds[0]}/reanalysis`, {
    headers: headers(reusedKey),
    data: { draft },
  });
  expect(first.status()).toBe(202);
  const firstResult = (await first.json()).data as { jobId: string; replayed: boolean };
  expect(firstResult.replayed).toBe(false);

  const replay = await request.post(`/api/v1/entries/${entryIds[0]}/reanalysis`, {
    headers: headers(reusedKey),
    data: { draft },
  });
  expect(replay.status()).toBe(202);
  expect((await replay.json()).data).toMatchObject({ jobId: firstResult.jobId, replayed: true });

  const otherTarget = await request.post(`/api/v1/entries/${entryIds[1]}/reanalysis`, {
    headers: headers(reusedKey),
    data: { draft },
  });
  expect(otherTarget.status()).toBe(409);
  expect((await otherTarget.json()).error.code).toBe("IDEMPOTENCY_PAYLOAD_MISMATCH");

  const retryWithNewKey = await request.post(`/api/v1/entries/${entryIds[1]}/reanalysis`, {
    headers: headers(),
    data: { draft },
  });
  expect(retryWithNewKey.status()).toBe(202);
  expect((await retryWithNewKey.json()).data).toMatchObject({ replayed: false });
});
