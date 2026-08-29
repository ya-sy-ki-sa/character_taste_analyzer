import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ProviderRouter } from "../worker/llm/providers";
import type { Env } from "../worker/types";

const outputSchema = z.object({ summary: z.string().min(1) });
const jsonSchema = z.toJSONSchema(outputSchema, { target: "draft-7" }) as Record<string, unknown>;

function request() {
  return {
    task: "profile-summary" as const,
    messages: [{ role: "user" as const, content: "要約対象" }],
    schema: outputSchema,
    jsonSchema,
    model: "ignored-by-router",
    promptVersion: "test-v1",
    localFactory: () => ({ summary: "local" }),
  };
}

function env(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    ENVIRONMENT: "production",
    OPENAI_API_KEY: "test-key",
    OPENAI_MODEL: "gpt-5.6-sol-test",
    WORKERS_AI_MODEL: "@cf/openai/gpt-oss-120b-test",
    EMBEDDING_MODEL: "@cf/baai/bge-m3",
    AUTH_PEPPER: "test-pepper",
    ALLOW_LOCAL_AI_FALLBACK: "false",
    ANALYSIS_DAILY_QUOTA: "30",
    GENERATION_DAILY_QUOTA: "10",
    SESSION_DAYS: "30",
    ...overrides,
  };
}

function openAiResponse(text: string, status = 200) {
  return new Response(
    JSON.stringify(
      status === 200
        ? { output_text: text, usage: { input_tokens: 12, output_tokens: 5 } }
        : { error: { message: "provider error" } },
    ),
    {
      status,
      headers: { "Content-Type": "application/json" },
    },
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("shared structured-provider contract", () => {
  it("uses Responses Structured Outputs without provider storage or personalized cache", async () => {
    const fetchMock = vi.fn().mockResolvedValue(openAiResponse('{"summary":"ok"}'));
    vi.stubGlobal("fetch", fetchMock);
    const artifact = await new ProviderRouter(env()).generateObject(request());
    expect(artifact).toMatchObject({ provider: "openai", model: "gpt-5.6-sol-test", value: { summary: "ok" } });
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const headers = new Headers(init.headers);
    expect(body).toMatchObject({ model: "gpt-5.6-sol-test", store: false });
    expect(body.text).toMatchObject({ format: { type: "json_schema", strict: true } });
    expect(headers.get("cf-aig-collect-log-payload")).toBe("false");
    expect(headers.get("cf-aig-skip-cache")).toBe("true");
  });

  it("repairs schema-invalid JSON once with the same model", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(openAiResponse('{"summary":42}'))
      .mockResolvedValueOnce(openAiResponse('{"summary":"修復済み"}'));
    vi.stubGlobal("fetch", fetchMock);
    const artifact = await new ProviderRouter(env()).generateObject(request());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(artifact.value.summary).toBe("修復済み");
    const repairedBody = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body)) as {
      input: Array<{ content: string }>;
    };
    expect(repairedBody.input.at(-1)?.content).toContain("検証エラー");
  });

  it("falls back on provider refusal or rate failure and records the actual Workers AI model", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(openAiResponse("", 429)));
    const run = vi.fn().mockResolvedValue({
      response: '{"summary":"Workersへ切替"}',
      usage: { prompt_tokens: 8, completion_tokens: 4 },
    });
    const artifact = await new ProviderRouter(env({ AI: { run } })).generateObject(request());
    expect(artifact).toMatchObject({
      provider: "workers-ai",
      model: "@cf/openai/gpt-oss-120b-test",
      value: { summary: "Workersへ切替" },
    });
    expect(artifact.fallbackFrom).toContain("openai:openai_429");
    expect(run).toHaveBeenCalledWith("@cf/openai/gpt-oss-120b-test", expect.any(Object));
    expect(run.mock.calls[0][1]).toMatchObject({
      response_format: {
        type: "json_schema",
        json_schema: jsonSchema,
      },
    });
  });

  it.each([
    {
      name: "Chat Completions",
      response: { choices: [{ message: { content: '{"summary":"Chat形式"}' } }] },
      summary: "Chat形式",
    },
    {
      name: "Responses API",
      response: { output: [{ content: [{ type: "output_text", text: '{"summary":"Responses形式"}' }] }] },
      summary: "Responses形式",
    },
  ])("normalizes Workers AI $name output", async ({ response, summary }) => {
    const run = vi.fn().mockResolvedValue(response);
    const artifact = await new ProviderRouter(env({ OPENAI_API_KEY: undefined, AI: { run } })).generateObject(
      request(),
    );
    expect(artifact).toMatchObject({ provider: "workers-ai", value: { summary } });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("repairs malformed Workers AI JSON once with the same model", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: '{"summary":"途中で切れた"' } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: '{"summary":"修復済み"}' } }] });
    const artifact = await new ProviderRouter(env({ OPENAI_API_KEY: undefined, AI: { run } })).generateObject(
      request(),
    );
    expect(artifact).toMatchObject({ provider: "workers-ai", value: { summary: "修復済み" } });
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][1]).toMatchObject({
      messages: expect.arrayContaining([expect.objectContaining({ content: expect.stringContaining("検証エラー") })]),
    });
  });

  it("uses Workers AI in development when remote AI is enabled", async () => {
    const run = vi.fn().mockResolvedValue({ response: '{"summary":"Workers開発環境"}' });
    const fetchMock = vi.fn().mockRejectedValue(new Error("OpenAI must not be preferred in development"));
    vi.stubGlobal("fetch", fetchMock);
    const artifact = await new ProviderRouter(
      env({
        AI: { run },
        ENVIRONMENT: "development",
        ALLOW_LOCAL_AI_FALLBACK: "true",
        USE_REMOTE_AI_IN_DEV: "true",
      }),
    ).generateObject(request());

    expect(artifact).toMatchObject({ provider: "workers-ai", value: { summary: "Workers開発環境" } });
    expect(run).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the recommendation sampling budget on Workers AI", async () => {
    const run = vi.fn().mockResolvedValue({ response: '{"summary":"推薦結果"}' });
    await new ProviderRouter(
      env({
        AI: { run },
        ENVIRONMENT: "development",
        ALLOW_LOCAL_AI_FALLBACK: "true",
        USE_REMOTE_AI_IN_DEV: "true",
      }),
    ).generateObject({ ...request(), task: "character-recommendation", localFactory: undefined });

    expect(run.mock.calls[0][1]).toMatchObject({ max_tokens: 3_000, temperature: 0.6 });
  });

  it("does not invent character recommendations with the deterministic local fallback", async () => {
    const run = vi.fn();
    await expect(
      new ProviderRouter(
        env({
          AI: { run },
          ENVIRONMENT: "development",
          ALLOW_LOCAL_AI_FALLBACK: "true",
          USE_REMOTE_AI_IN_DEV: "false",
        }),
      ).generateObject({ ...request(), task: "character-recommendation", localFactory: undefined }),
    ).rejects.toThrow("利用可能なLLMがありません");
    expect(run).not.toHaveBeenCalled();
  });

  it("uses deterministic local output when remote AI is explicitly disabled in development", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("remote providers must not be called"));
    const run = vi.fn().mockRejectedValue(new Error("remote providers must not be called"));
    vi.stubGlobal("fetch", fetchMock);
    const artifact = await new ProviderRouter(
      env({
        AI: { run },
        ENVIRONMENT: "development",
        ALLOW_LOCAL_AI_FALLBACK: "true",
        USE_REMOTE_AI_IN_DEV: "false",
      }),
    ).generateObject(request());
    expect(artifact).toMatchObject({ provider: "local-deterministic", model: "local-v1", value: { summary: "local" } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });
});
