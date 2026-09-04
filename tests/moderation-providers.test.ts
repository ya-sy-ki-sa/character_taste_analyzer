import { afterEach, describe, expect, it, vi } from "vitest";
import { createModerationProvider, OpenAiModerationProvider } from "../worker/moderation/providers";
import type { Env } from "../worker/types";

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

afterEach(() => vi.unstubAllGlobals());

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
});
