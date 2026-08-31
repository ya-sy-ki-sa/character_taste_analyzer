import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createLlmProvider } from "../worker/llm/providers";
import type { Env } from "../worker/types";

const outputSchema = z.object({ value: z.string() });
const request = {
  operation: "character_understanding" as const,
  schemaName: "test",
  schemaVersion: "1",
  schema: outputSchema,
  jsonSchema: z.toJSONSchema(outputSchema) as Record<string, unknown>,
  messages: [{ role: "user" as const, content: "data" }],
  maxOutputTokens: 100,
  temperature: 0,
  idempotencyKey: crypto.randomUUID(),
  fakeFactory: () => ({ value: "replayed" }),
};

function providerEnv(overrides: Partial<Env>): Env {
  return {
    LLM_PROVIDER: "fake",
    LLM_MODEL: "fake-v1",
    EMBEDDING_PROVIDER: "fake",
    EMBEDDING_MODEL: "fake-v1",
    ENVIRONMENT: "local",
    AUTH_PEPPER: "test",
    AI_GATEWAY_ACCOUNT_ID: "test-account",
    AI_GATEWAY_GATEWAY_ID: "test-gateway",
    AI_GATEWAY_TOKEN: "test-gateway-token",
    ANALYSIS_DAILY_QUOTA: "100",
    GENERATION_DAILY_QUOTA: "100",
    SESSION_DAYS: "30",
    PUBLIC_WRITE_LIMIT_10_MIN: "100",
    USER_WRITE_LIMIT_PER_MIN: "100",
    IP_WRITE_LIMIT_PER_MIN: "100",
    ...overrides,
  } as Env;
}

describe("explicit LLM provider routing", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses deterministic fake output only when explicitly selected", async () => {
    const result = await createLlmProvider(providerEnv({})).generateStructured(request);
    expect(result.value.value).toBe("replayed");
    expect(result.metadata.provider).toBe("fake");
  });

  it("preserves Workers AI capacity failures without a configured fallback", async () => {
    const run = vi.fn(async () => {
      throw new Error("429 daily quota exceeded");
    });
    const env = providerEnv({
      LLM_PROVIDER: "workers_ai",
      LLM_MODEL: "workers-model",
      AI: { run },
    });
    await expect(createLlmProvider(env).generateStructured(request)).rejects.toMatchObject({
      code: "PROVIDER_CAPACITY_EXHAUSTED",
      retryable: true,
    });
    expect(run).toHaveBeenCalledWith("workers-model", expect.objectContaining({ messages: request.messages }), {
      gateway: { id: "test-gateway" },
    });
  });

  it("uses a configured deterministic fallback after a retryable failure", async () => {
    const env = providerEnv({
      LLM_PROVIDER: "workers_ai",
      LLM_MODEL: "workers-model",
      LLM_FALLBACK_PROVIDER: "fake",
      LLM_FALLBACK_MODEL: "fake-v1",
      AI: {
        run: async () => {
          throw new Error("capacity unavailable");
        },
      },
    });
    const result = await createLlmProvider(env).generateStructured(request);
    expect(result.metadata.provider).toBe("fake");
    expect(result.fallbackFrom).toContain("workers_ai:PROVIDER_CAPACITY_EXHAUSTED");
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts?.[0].output).toMatchObject({ errorCode: "PROVIDER_CAPACITY_EXHAUSTED" });
    expect(result.attempts?.[1].metadata).toMatchObject({
      fallbackFromProvider: "workers_ai",
      fallbackErrorCode: "PROVIDER_CAPACITY_EXHAUSTED",
    });
  });

  it("returns auditable metadata for a rejected OpenAI attempt", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { id: "resp_rejected", error: { code: "invalid_request", message: "bad schema" } },
          { status: 400, headers: { "x-request-id": "req_rejected" } },
        ),
      ),
    );
    const error = await createLlmProvider(
      providerEnv({
        LLM_PROVIDER: "openai",
        LLM_MODEL: "gpt-5.6-luna",
        OPENAI_API_KEY: "test-key",
      }),
    )
      .generateStructured(request)
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: "EXTERNAL_PROVIDER_REJECTED",
      safeDetail: "HTTP 400: invalid_request: bad schema",
      operation: "character_understanding",
      attempts: [
        {
          output: { errorCode: "EXTERNAL_PROVIDER_REJECTED" },
          metadata: {
            provider: "openai",
            resolvedModel: "gpt-5.6-luna",
            providerRequestId: "req_rejected",
            attemptNumber: 0,
            providerResponseDiagnostics: {
              httpStatus: 400,
              requestId: "req_rejected",
              responseId: "resp_rejected",
              errorCode: "invalid_request",
              errorMessage: "bad schema",
              safetySignal: "provider_error",
            },
          },
        },
      ],
    });
  });

  it("records an OpenAI refusal separately from application validation errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          id: "resp_refusal",
          status: "completed",
          output: [
            {
              type: "message",
              content: [{ type: "refusal", refusal: "この内容には回答できません" }],
            },
          ],
        }),
      ),
    );
    const error = await createLlmProvider(
      providerEnv({
        LLM_PROVIDER: "openai",
        LLM_MODEL: "gpt-5.6-luna",
        OPENAI_API_KEY: "test-key",
      }),
    )
      .generateStructured(request)
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: "EXTERNAL_PROVIDER_REFUSED",
      safeDetail: "OpenAIの拒否応答: この内容には回答できません",
      attempts: [
        {
          metadata: {
            providerRequestId: "resp_refusal",
            providerResponseDiagnostics: {
              httpStatus: 200,
              responseStatus: "completed",
              refusal: "この内容には回答できません",
              safetySignal: "refusal",
            },
          },
        },
      ],
    });
  });

  it("records content-filter signals from an incomplete OpenAI response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          id: "resp_filtered",
          status: "incomplete",
          incomplete_details: { reason: "content_filter" },
          output: [],
          usage: { input_tokens: 123, output_tokens: 100 },
        }),
      ),
    );
    const error = await createLlmProvider(
      providerEnv({
        LLM_PROVIDER: "openai",
        LLM_MODEL: "gpt-5.6-luna",
        OPENAI_API_KEY: "test-key",
      }),
    )
      .generateStructured(request)
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: "EXTERNAL_PROVIDER_INCOMPLETE",
      safeDetail: "未完了理由: content_filter",
      attempts: [
        {
          metadata: {
            providerRequestId: "resp_filtered",
            inputTokens: 123,
            outputTokens: 100,
            providerResponseDiagnostics: {
              responseStatus: "incomplete",
              incompleteReason: "content_filter",
              safetySignal: "content_filter",
            },
          },
        },
      ],
    });
  });

  it("records token usage when an OpenAI response reaches the output limit", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          {
            id: "resp_output_limit",
            status: "incomplete",
            incomplete_details: { reason: "max_output_tokens" },
            output: [],
            usage: { input_tokens: 7_816, output_tokens: 5_000 },
          },
          { headers: { "x-request-id": "req_output_limit" } },
        ),
      ),
    );
    const error = await createLlmProvider(
      providerEnv({
        LLM_PROVIDER: "openai",
        LLM_MODEL: "gpt-5.6-luna",
        OPENAI_API_KEY: "test-key",
      }),
    )
      .generateStructured(request)
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: "EXTERNAL_PROVIDER_INCOMPLETE",
      attempts: [
        {
          metadata: {
            providerRequestId: "req_output_limit",
            inputTokens: 7_816,
            outputTokens: 5_000,
            providerResponseDiagnostics: {
              requestId: "req_output_limit",
              responseId: "resp_output_limit",
              responseStatus: "incomplete",
              incompleteReason: "max_output_tokens",
              safetySignal: "incomplete",
            },
          },
        },
      ],
    });
  });

  it("retains a safe excerpt when the model response is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ id: "resp_invalid", output_text: "JSONではない応答です", usage: {} })),
    );
    const error = await createLlmProvider(
      providerEnv({
        LLM_PROVIDER: "openai",
        LLM_MODEL: "gpt-5.6-luna",
        OPENAI_API_KEY: "test-key",
      }),
    )
      .generateStructured(request)
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({
      code: "LLM_SCHEMA_INVALID",
      safeDetail: "JSONとして解釈できなかったモデル応答: JSONではない応答です",
      operation: "character_understanding",
      attempts: [
        {
          output: {
            errorCode: "LLM_SCHEMA_INVALID",
            safeDetail: "JSONとして解釈できなかったモデル応答: JSONではない応答です",
          },
        },
      ],
    });
  });

  it("sends the structured-output contract and execution limits to OpenAI Responses", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const headers = new Headers(init?.headers);
      expect(String(input)).toBe("https://gateway.ai.cloudflare.com/v1/test-account/test-gateway/openai/responses");
      expect(body).toMatchObject({
        model: "gpt-5.6-sol",
        service_tier: "flex",
        store: false,
        safety_identifier: "privacy-safe-user-hash",
        max_output_tokens: 100,
        text: { format: { type: "json_schema", strict: true } },
      });
      expect(body).not.toHaveProperty("temperature");
      expect(headers.get("Idempotency-Key")).toBe(`${request.idempotencyKey}:attempt-0`);
      expect(headers.get("cf-aig-authorization")).toBe("Bearer test-gateway-token");
      expect(headers.get("cf-aig-request-timeout")).toBe("900000");
      return Response.json({ id: "resp_test", output_text: '{"value":"openai"}', usage: {} });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await createLlmProvider(
      providerEnv({
        LLM_PROVIDER: "openai",
        LLM_MODEL: "gpt-5.6-sol",
        OPENAI_API_KEY: "test-key",
      }),
    ).generateStructured({ ...request, safetyIdentifier: "privacy-safe-user-hash" });
    expect(result.value.value).toBe("openai");
    expect(result.metadata.effectiveSettings).toMatchObject({ serviceTier: "flex" });
    expect(result.metadata.providerRequestId).toBe("resp_test");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("enables hosted web search only when the operation requests it", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body.tools).toEqual([{ type: "web_search" }]);
      expect(body.tool_choice).toBe("auto");
      expect(body.max_tool_calls).toBe(3);
      return Response.json({ id: "resp_search", output_text: '{"value":"researched"}', usage: {} });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await createLlmProvider(
      providerEnv({
        LLM_PROVIDER: "openai",
        LLM_MODEL: "gpt-5.6-sol",
        OPENAI_API_KEY: "test-key",
      }),
    ).generateStructured({ ...request, enableWebSearch: true });
    expect(result.value.value).toBe("researched");
  });
});
