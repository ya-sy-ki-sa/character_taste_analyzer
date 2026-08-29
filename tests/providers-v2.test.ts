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
    DEPLOYMENT_PROFILE: "free_validation",
    AUTH_PEPPER: "test",
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
    const env = providerEnv({
      LLM_PROVIDER: "workers_ai",
      LLM_MODEL: "workers-model",
      AI: {
        run: async () => {
          throw new Error("429 daily quota exceeded");
        },
      },
    });
    await expect(createLlmProvider(env).generateStructured(request)).rejects.toMatchObject({
      code: "PROVIDER_CAPACITY_EXHAUSTED",
      retryable: true,
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
  });

  it("sends the structured-output contract and execution limits to OpenAI Responses", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const headers = new Headers(init?.headers);
      expect(body).toMatchObject({
        model: "gpt-5.6-sol",
        store: false,
        max_output_tokens: 100,
        temperature: 0,
        text: { format: { type: "json_schema", strict: true } },
      });
      expect(headers.get("Idempotency-Key")).toBe(request.idempotencyKey);
      return Response.json({ id: "resp_test", output_text: '{"value":"openai"}', usage: {} });
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await createLlmProvider(
      providerEnv({
        LLM_PROVIDER: "openai",
        LLM_MODEL: "gpt-5.6-sol",
        OPENAI_API_KEY: "test-key",
        OPENAI_TRANSPORT: "direct",
      }),
    ).generateStructured(request);
    expect(result.value.value).toBe("openai");
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
        OPENAI_TRANSPORT: "direct",
      }),
    ).generateStructured({ ...request, enableWebSearch: true });
    expect(result.value.value).toBe("researched");
  });
});
