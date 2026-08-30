import { type APIRequestContext, request as createRequest, expect, test } from "@playwright/test";

const origin = "http://localhost:41737";

async function createUser(api: APIRequestContext, prefix: string) {
  const username = `${prefix.slice(0, 12)}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 6)}`;
  const registration = await api.post("/api/v1/users", {
    headers: { "Idempotency-Key": crypto.randomUUID(), Origin: origin },
    data: { username },
  });
  expect(registration.status()).toBe(201);
  const created = (await registration.json()).data as { user: { id: string }; accessKey: string };
  const activation = await api.post(`/api/v1/users/${created.user.id}/activate`, {
    headers: { "Idempotency-Key": crypto.randomUUID(), Origin: origin },
    data: { accessKey: created.accessKey },
  });
  expect(activation.ok()).toBe(true);
  const login = await api.post("/api/v1/sessions", {
    headers: { "Idempotency-Key": crypto.randomUUID(), Origin: origin },
    data: { userId: created.user.id, accessKey: created.accessKey },
  });
  expect(login.ok()).toBe(true);
  const { csrfToken } = (await login.json()).data as { csrfToken: string };
  return { ...created, username, csrfToken };
}

function unsafeHeaders(csrfToken: string) {
  return {
    "Idempotency-Key": crypto.randomUUID(),
    "X-CSRF-Token": csrfToken,
    Origin: origin,
  };
}

test("identity候補をowner内だけでreuseし、完全exportを認証付きで取得する", async () => {
  const ownerApi = await createRequest.newContext({ baseURL: origin });
  const otherApi = await createRequest.newContext({ baseURL: origin });
  const owner = await createUser(ownerApi, "identity-owner");
  const other = await createUser(otherApi, "identity-other");
  const character = {
    schemaVersion: "2",
    registrationType: "existing",
    workTitle: "候補分離作品",
    characterName: "候補分離キャラクター",
    referenceMaterial: "同一identityの再利用と利用者間の候補分離を検証するための参考情報です。",
    preference: { likedReasons: "一貫した選択をするところが好き", responseChannels: ["person_liking"] },
  };

  const firstEntry = await ownerApi.post("/api/v1/entries", {
    headers: unsafeHeaders(owner.csrfToken),
    data: { ...character, identityResolution: { mode: "new" } },
  });
  expect(firstEntry.status()).toBe(202);

  const candidates = await ownerApi.post("/api/v1/identity-candidates", {
    headers: unsafeHeaders(owner.csrfToken),
    data: { workTitle: character.workTitle, characterName: character.characterName },
  });
  expect(candidates.ok()).toBe(true);
  const ownerCandidates = (await candidates.json()).data.candidates as Array<{
    workId: string;
    characterIdentityId: string;
  }>;
  expect(ownerCandidates).toHaveLength(1);

  const isolatedCandidates = await otherApi.post("/api/v1/identity-candidates", {
    headers: unsafeHeaders(other.csrfToken),
    data: { workTitle: character.workTitle, characterName: character.characterName },
  });
  expect((await isolatedCandidates.json()).data.candidates).toEqual([]);

  const secondEntry = await ownerApi.post("/api/v1/entries", {
    headers: unsafeHeaders(owner.csrfToken),
    data: {
      ...character,
      preferenceContext: "別の物語局面",
      identityResolution: {
        mode: "reuse",
        workId: ownerCandidates[0].workId,
        characterIdentityId: ownerCandidates[0].characterIdentityId,
      },
    },
  });
  expect(secondEntry.status()).toBe(202);
  expect((await secondEntry.json()).data.entryId).not.toBe((await firstEntry.json()).data.entryId);

  const exportResponse = await ownerApi.post("/api/v1/account/exports", {
    headers: unsafeHeaders(owner.csrfToken),
    data: {},
  });
  expect(exportResponse.status()).toBe(202);
  const exportId = (await exportResponse.json()).data.exportId as string;

  await expect
    .poll(
      async () => {
        const status = await ownerApi.get(`/api/v1/account/exports/${exportId}`);
        return ((await status.json()).data.export as { status: string }).status;
      },
      { timeout: 20_000 },
    )
    .toBe("ready");

  expect((await otherApi.get(`/api/v1/account/exports/${exportId}`)).status()).toBe(404);
  expect((await otherApi.get(`/api/v1/account/exports/${exportId}/download`)).status()).toBe(404);

  const download = await ownerApi.get(`/api/v1/account/exports/${exportId}/download`);
  expect(download.ok()).toBe(true);
  expect(download.headers()["cache-control"]).toContain("no-store");
  const payload = (await download.json()) as {
    schemaVersion: string;
    entries: { entries: unknown[]; identities: unknown[]; representations: unknown[] };
  };
  expect(payload.schemaVersion).toBe("2.0");
  expect(payload.entries.entries).toHaveLength(2);
  expect(payload.entries.identities).toHaveLength(1);
  expect(payload.entries.representations).toHaveLength(2);
  const serialized = JSON.stringify(payload);
  for (const forbidden of ["key_digest", "token_digest", "csrf_digest", "request_rate_limits", "outbox_events"])
    expect(serialized).not.toContain(forbidden);

  const deleteOwner = await ownerApi.delete("/api/v1/account", {
    headers: unsafeHeaders(owner.csrfToken),
    data: { usernameConfirmation: owner.username },
  });
  expect(deleteOwner.status()).toBe(204);
  const deleteOther = await otherApi.delete("/api/v1/account", {
    headers: unsafeHeaders(other.csrfToken),
    data: { usernameConfirmation: other.username },
  });
  expect(deleteOther.status()).toBe(204);
  await ownerApi.dispose();
  await otherApi.dispose();
});
