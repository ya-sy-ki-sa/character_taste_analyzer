import { expect, test } from "@playwright/test";

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
