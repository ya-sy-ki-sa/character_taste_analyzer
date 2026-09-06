import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleError } from "../worker/error-handler";
import { createModerationProvider, OpenAiModerationProvider } from "../worker/moderation/providers";
import type { AppEnv, Env } from "../worker/types";

function openAiEnv(): Env {
  return {
    MODERATION_PROVIDER: "openai",
    MODERATION_MODEL: "omni-moderation-latest",
    OPENAI_API_KEY: "test-key",
    AI_GATEWAY_ACCOUNT_ID: "account",
    AI_GATEWAY_GATEWAY_ID: "gateway",
    AI_GATEWAY_TOKEN: "gateway-token",
  } as Env;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("moderation providers", () => {
  it("rejects only the configured OpenAI categories with user-facing reasons", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            { flagged: true, categories: { violence: true } },
            {
              flagged: true,
              categories: {
                "illicit/violent": true,
                "self-harm/instructions": true,
                "sexual/minors": true,
                harassment: true,
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenAiModerationProvider(openAiEnv()).moderate([
      { field: "作品名", text: "non-blocking category" },
      { field: "自由指示", text: "flagged" },
    ]);

    expect(result).toEqual({
      allowed: false,
      reasons: [
        { field: "自由指示", category: "illicit/violent", label: "暴力を伴う違法行為" },
        { field: "自由指示", category: "self-harm/instructions", label: "自傷行為の助長・手順" },
        { field: "自由指示", category: "sexual/minors", label: "未成年者に関する性的な内容" },
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://gateway.ai.cloudflare.com/v1/account/gateway/openai/moderations",
      expect.objectContaining({ method: "POST" }),
    );
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      model: "omni-moderation-latest",
      input: ["non-blocking category", "flagged"],
    });
  });

  it("allows input when only categories outside the rejection list are flagged", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          results: [{ flagged: true, categories: { harassment: true, hate: true, violence: true } }],
        }),
      ),
    );

    await expect(
      new OpenAiModerationProvider(openAiEnv()).moderate([{ field: "自由指示", text: "allowed categories" }]),
    ).resolves.toEqual({ allowed: true, reasons: [] });
  });

  it("supports a replaceable fake provider for offline execution", async () => {
    const provider = createModerationProvider({ MODERATION_PROVIDER: "fake" } as Env);
    await expect(provider.moderate([{ field: "自由指示", text: "any" }])).resolves.toEqual({
      allowed: true,
      reasons: [],
    });
  });

  it("fails closed when the provider response is invalid", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    await expect(
      new OpenAiModerationProvider(openAiEnv()).moderate([{ field: "自由指示", text: "text" }]),
    ).rejects.toMatchObject({ code: "MODERATION_PROVIDER_UNAVAILABLE" });
  });

  it.each(["OPENAI_API_KEY", "AI_GATEWAY_ACCOUNT_ID", "AI_GATEWAY_GATEWAY_ID", "AI_GATEWAY_TOKEN"] as const)(
    "identifies missing %s before attempting a connection",
    async (name) => {
      const env = openAiEnv();
      env[name] = " ";
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);
      await expect(
        new OpenAiModerationProvider(env).moderate([{ field: "自由指示", text: "text" }]),
      ).rejects.toMatchObject({
        code: "MODERATION_CONFIGURATION_INVALID",
        diagnostics: { reason: "missing_configuration", missingBindings: [name] },
      });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    { status: 401, body: '{"error":{"message":"private-provider-message"}}', reason: "http_error" },
    { status: 403, body: "Forbidden", reason: "http_error" },
    { status: 429, body: "Rate limited", reason: "http_error" },
    { status: 502, body: "Bad gateway", reason: "http_error" },
    { status: 200, body: "null", reason: "invalid_response" },
    { status: 200, body: '{"results":[null]}', reason: "invalid_response" },
    { status: 200, body: '{"results":[]}', reason: "invalid_response" },
    { status: 200, body: "not-json", reason: "invalid_response" },
  ])(
    "logs safe diagnostics for $status / $body without exposing them to the client",
    async ({ status, body, reason }) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status })));
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const app = new Hono<AppEnv>();
      app.onError(handleError);
      app.post("/", async (context) => {
        context.set("requestId", "test-request-id");
        await new OpenAiModerationProvider(openAiEnv()).moderate([{ field: "自由指示", text: "private-input" }]);
        return context.json({ ok: true });
      });

      const response = await app.request("/", { method: "POST" });
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({
        error: {
          code: "MODERATION_PROVIDER_UNAVAILABLE",
          message: "入力内容の事前チェックを完了できませんでした。時間をおいて再度お試しください。",
          requestId: "test-request-id",
        },
      });
      expect(log).toHaveBeenCalledExactlyOnceWith(
        JSON.stringify({
          event: "moderation_provider_error",
          requestId: "test-request-id",
          code: "MODERATION_PROVIDER_UNAVAILABLE",
          diagnostics: { reason, status },
        }),
      );
    },
  );

  it.each([
    { error: new TypeError("private-key-or-url"), reason: "network_error" },
    { error: new DOMException("private-input", "TimeoutError"), reason: "timeout" },
  ])("classifies $reason without retaining the exception message", async ({ error, reason }) => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(error));
    await expect(
      new OpenAiModerationProvider(openAiEnv()).moderate([{ field: "自由指示", text: "text" }]),
    ).rejects.toMatchObject({
      code: "MODERATION_PROVIDER_UNAVAILABLE",
      diagnostics: { reason },
      message: "入力内容の事前チェックに接続できません",
    });
  });
});
