import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { membershipTierSchema } from "../shared/membership";
import { validateConfig } from "../worker/config";
import { createLlmProvider } from "../worker/llm/providers";
import { llmRoutingSnapshotSchema, resolveLlmRoutingSnapshot } from "../worker/llm/routing";
import type { Env } from "../worker/types";

const schema = z.object({ value: z.string() });
const request = {
  operation: "character_understanding" as const,
  schemaName: "effort_test",
  schemaVersion: "1",
  schema,
  jsonSchema: z.toJSONSchema(schema) as Record<string, unknown>,
  messages: [{ role: "user" as const, content: "test" }],
  maxOutputTokens: 100,
  temperature: 0,
  idempotencyKey: "effort-test",
  fakeFactory: () => ({ value: "fake" }),
};
function environment(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    ENVIRONMENT: "local",
    AUTH_PEPPER: "test-only",
    LLM_PROVIDER: "openai",
    LLM_MODEL: "configured-model",
    OPENAI_API_KEY: "test-key",
    AI_GATEWAY_ACCOUNT_ID: "test-account",
    AI_GATEWAY_GATEWAY_ID: "test-gateway",
    AI_GATEWAY_TOKEN: "test-token",
    MODERATION_PROVIDER: "fake",
    EMBEDDING_PROVIDER: "fake",
    EMBEDDING_MODEL: "fake-v1",
    EMBEDDING_DIMENSIONS: "1536",
    ...overrides,
  } as Env;
}
function mockOpenAi() {
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
    Response.json({ output_text: '{"value":"ok"}', usage: { input_tokens: 10, output_tokens: 5 } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const bodies = () => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body as string));
  return { fetchMock, bodies };
}
afterEach(() => vi.unstubAllGlobals());

describe("LLM reasoning effort transport", () => {
  it.each(["none", "minimal", "low", "medium", "high", "xhigh", "max"])(
    "sends explicit OpenAI effort %s and records it",
    async (effort) => {
      const { bodies } = mockOpenAi();
      const result = await createLlmProvider(environment({ LLM_REASONING_EFFORT: effort })).generateStructured(request);
      expect(bodies()[0].reasoning).toEqual({ effort });
      expect(bodies()[0]).not.toHaveProperty("reasoning_effort");
      expect(result.metadata.effectiveSettings).toMatchObject({
        reasoningEffort: effort,
        llmRouting: { primary: { effort } },
      });
      expect(result.metadata.ignoredParameters).not.toContain("reasoningEffort");
    },
  );

  it.each([undefined, "", "   "])("omits unspecified effort (%s) from OpenAI requests", async (effort) => {
    const { bodies } = mockOpenAi();
    const result = await createLlmProvider(environment({ LLM_REASONING_EFFORT: effort })).generateStructured(request);
    expect(bodies()[0]).not.toHaveProperty("reasoning");
    expect(result.metadata.effectiveSettings?.reasoningEffort).toBeNull();
  });

  it.each(membershipTierSchema.options)(
    "uses %s effort for tier operations and common effort for scope",
    async (tier) => {
      const { bodies } = mockOpenAi();
      const efforts = { basic: "none", silver: "low", gold: "high", premium: "max" };
      const env = environment({
        LLM_REASONING_EFFORT: "medium",
        LLM_TIER_ROUTES_JSON: JSON.stringify({
          [tier]: { provider: "openai", model: `${tier}-model`, effort: efforts[tier] },
        }),
      });
      const llm = createLlmProvider(env, { snapshot: resolveLlmRoutingSnapshot(env, tier) });
      await llm.generateStructured(request);
      await llm.generateStructured({ ...request, operation: "dark_scope_assessment" });
      await llm.generateStructured({
        ...request,
        operation: "schema_repair",
        repairOfOperation: "preference_analysis",
      });
      expect(bodies().map((body) => [body.model, body.reasoning.effort])).toEqual([
        [`${tier}-model`, efforts[tier]],
        ["configured-model", "medium"],
        [`${tier}-model`, efforts[tier]],
      ]);
    },
  );

  it("inherits the complete common route only when the tier route is omitted", async () => {
    const { bodies } = mockOpenAi();
    const env = environment({
      LLM_REASONING_EFFORT: "high",
      LLM_TIER_ROUTES_JSON: '{"gold":{"provider":"openai","model":"gold-model"}}',
    });
    await createLlmProvider(env, { snapshot: resolveLlmRoutingSnapshot(env, "silver") }).generateStructured(request);
    await createLlmProvider(env, { snapshot: resolveLlmRoutingSnapshot(env, "gold") }).generateStructured(request);
    expect(bodies()[0].reasoning).toEqual({ effort: "high" });
    expect(bodies()[1]).not.toHaveProperty("reasoning");
  });

  it("preserves effort on schema repair even when environment settings change between attempts", async () => {
    const { fetchMock, bodies } = mockOpenAi();
    const env = environment({ LLM_REASONING_EFFORT: "high" });
    fetchMock.mockImplementationOnce(async () => {
      env.LLM_REASONING_EFFORT = "low";
      return Response.json({ output_text: '{"value":42}' });
    });
    const result = await createLlmProvider(env).generateStructured(request);
    expect(bodies().map((body) => body.reasoning)).toEqual([{ effort: "high" }, { effort: "high" }]);
    expect(
      result.attempts?.map(({ metadata }) => [metadata.attemptNumber, metadata.effectiveSettings?.reasoningEffort]),
    ).toEqual([
      [0, "high"],
      [1, "high"],
    ]);
  });

  it("keeps the saved model-default effort after environment changes", async () => {
    const { bodies } = mockOpenAi();
    const env = environment();
    const snapshot = llmRoutingSnapshotSchema.parse(
      JSON.parse(JSON.stringify(resolveLlmRoutingSnapshot(env, "basic"))),
    );
    env.LLM_REASONING_EFFORT = "max";
    await createLlmProvider(env, { snapshot }).generateStructured(request);
    expect(bodies()[0]).not.toHaveProperty("reasoning");
  });

  it.each(["@cf/openai/gpt-oss-120b", "@cf/openai/gpt-oss-20b"])(
    "uses Chat Completions reasoning_effort for Workers AI %s",
    async (model) => {
      const run = vi.fn(async (_model: string, _input: Record<string, unknown>) => ({ response: '{"value":"ok"}' }));
      for (const effort of [undefined, "low", "medium", "high"]) {
        const result = await createLlmProvider(
          environment({
            LLM_PROVIDER: "workers_ai",
            LLM_MODEL: model,
            LLM_REASONING_EFFORT: effort,
            AI: { run },
          }),
        ).generateStructured(request);
        const body = run.mock.calls.at(-1)?.[1];
        expect(body).not.toHaveProperty("reasoning");
        if (effort) expect(body).toHaveProperty("reasoning_effort", effort);
        else expect(body).not.toHaveProperty("reasoning_effort");
        expect(result.metadata.effectiveSettings?.reasoningEffort).toBe(effort ?? null);
      }
    },
  );

  it.each([undefined, "low"])(
    "uses the fallback's own effort (%s) and records each attempt",
    async (fallbackEffort) => {
      const { fetchMock } = mockOpenAi();
      fetchMock.mockResolvedValue(Response.json({ error: { message: "capacity" } }, { status: 429 }));
      const run = vi.fn(async (_model: string, _input: Record<string, unknown>) => ({ response: '{"value":"ok"}' }));
      const env = environment({
        LLM_REASONING_EFFORT: "max",
        LLM_FALLBACK_PROVIDER: "workers_ai",
        LLM_FALLBACK_MODEL: "@cf/openai/gpt-oss-120b",
        LLM_FALLBACK_REASONING_EFFORT: fallbackEffort,
        AI: { run },
      });
      const result = await createLlmProvider(env).generateStructured(request);
      expect(run.mock.calls[0]?.[1].reasoning_effort).toBe(fallbackEffort);
      expect(
        result.attempts?.map(({ metadata }) => [metadata.provider, metadata.effectiveSettings?.reasoningEffort]),
      ).toEqual([
        ["openai", "max"],
        ["workers_ai", fallbackEffort ?? null],
      ]);
    },
  );

  it("records Workers AI effort on failure and uses the saved OpenAI fallback effort", async () => {
    const { bodies } = mockOpenAi();
    const env = environment({
      LLM_PROVIDER: "workers_ai",
      LLM_MODEL: "@cf/openai/gpt-oss-20b",
      LLM_REASONING_EFFORT: "low",
      LLM_FALLBACK_PROVIDER: "openai",
      LLM_FALLBACK_MODEL: "fallback-model",
      LLM_FALLBACK_REASONING_EFFORT: "high",
      AI: {
        run: vi.fn(async () => {
          throw new Error("429 capacity");
        }),
      },
    });
    const snapshot = resolveLlmRoutingSnapshot(env, "basic");
    env.LLM_FALLBACK_REASONING_EFFORT = "none";
    const result = await createLlmProvider(env, { snapshot }).generateStructured(request);
    expect(bodies()[0].reasoning).toEqual({ effort: "high" });
    expect(result.attempts?.map(({ metadata }) => metadata.effectiveSettings?.reasoningEffort)).toEqual([
      "low",
      "high",
    ]);
  });

  it("does not downgrade or retry an effort rejected by OpenAI", async () => {
    const { fetchMock } = mockOpenAi();
    fetchMock.mockResolvedValue(Response.json({ error: { message: "Unsupported reasoning.effort" } }, { status: 400 }));
    const llm = createLlmProvider(
      environment({
        LLM_REASONING_EFFORT: "max",
        LLM_FALLBACK_PROVIDER: "fake",
        LLM_FALLBACK_MODEL: "fake-v1",
      }),
    );
    await expect(llm.generateStructured(request)).rejects.toMatchObject({
      code: "EXTERNAL_PROVIDER_REJECTED",
      retryable: false,
      attempts: [{ metadata: { effectiveSettings: { reasoningEffort: "max" } } }],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("records effort when the OpenAI connection fails", async () => {
    const { fetchMock } = mockOpenAi();
    fetchMock.mockRejectedValue(new Error("connection unavailable"));
    await expect(
      createLlmProvider(environment({ LLM_REASONING_EFFORT: "high" })).generateStructured(request),
    ).rejects.toMatchObject({
      retryable: true,
      attempts: [{ metadata: { effectiveSettings: { reasoningEffort: "high" } } }],
    });
  });

  it.each(["fake", "replay"] as const)("records explicit effort as ignored for %s", async (provider) => {
    const result = await createLlmProvider(
      environment({ LLM_PROVIDER: provider, LLM_REASONING_EFFORT: "high" }),
    ).generateStructured(request);
    expect(result.value).toEqual({ value: "fake" });
    expect(result.metadata).toMatchObject({
      effectiveSettings: { reasoningEffort: null, llmRouting: { primary: { effort: "high" } } },
      ignoredParameters: ["reasoningEffort"],
    });
  });
});

describe("reasoning effort configuration validation", () => {
  it("requires the current snapshot version and an explicit effort value", () => {
    const snapshot = resolveLlmRoutingSnapshot(environment(), "basic");
    expect(snapshot.tier.primary.effort).toBeNull();
    expect(llmRoutingSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(llmRoutingSnapshotSchema.safeParse({ ...snapshot, policyVersion: "membership-v1" }).success).toBe(false);
    const { effort: _effort, ...primary } = snapshot.tier.primary;
    expect(llmRoutingSnapshotSchema.safeParse({ ...snapshot, tier: { ...snapshot.tier, primary } }).success).toBe(
      false,
    );
  });

  it.each<Partial<Env>>([
    { LLM_REASONING_EFFORT: "ultra" },
    { LLM_REASONING_EFFORT: "HIGH" },
    { LLM_FALLBACK_REASONING_EFFORT: "high" },
    { LLM_FALLBACK_PROVIDER: "openai", LLM_FALLBACK_MODEL: "fallback", LLM_FALLBACK_REASONING_EFFORT: "invalid" },
    { LLM_PROVIDER: "workers_ai", LLM_MODEL: "@cf/openai/gpt-oss-120b", LLM_REASONING_EFFORT: "xhigh" },
    { LLM_PROVIDER: "workers_ai", LLM_MODEL: "unsupported-model", LLM_REASONING_EFFORT: "low" },
  ])("rejects invalid common and fallback effort: %j", (overrides) => {
    const env = environment(overrides);
    expect(validateConfig(env).errors).toContain("LLM_ROUTES_INVALID");
    expect(() => createLlmProvider(env)).toThrow(
      expect.objectContaining({ code: "LLM_ROUTES_INVALID", retryable: false }),
    );
  });

  it.each(["", "ultra", null, 10, { effort: "high" }])("rejects invalid tier effort: %j", (effort) => {
    const env = environment({
      LLM_TIER_ROUTES_JSON: JSON.stringify({ premium: { provider: "openai", model: "tier", effort } }),
    });
    expect(validateConfig(env).errors).toContain("LLM_TIER_ROUTES_INVALID");
    expect(() => resolveLlmRoutingSnapshot(env, "premium")).toThrow(
      expect.objectContaining({ code: "LLM_TIER_ROUTES_INVALID" }),
    );
  });

  it("validates provider compatibility in tier routes and saved snapshots", () => {
    const env = environment();
    const snapshot = resolveLlmRoutingSnapshot(env, "premium");
    const invalid = { provider: "workers_ai", model: "@cf/openai/gpt-oss-120b", effort: "none" };
    env.LLM_TIER_ROUTES_JSON = JSON.stringify({ premium: invalid });
    expect(validateConfig(env).errors).toContain("LLM_TIER_ROUTES_INVALID");
    expect(
      llmRoutingSnapshotSchema.safeParse({ ...snapshot, tier: { primary: invalid, fallback: null } }).success,
    ).toBe(false);
  });

  it("accepts defaults and trims environment effort", () => {
    const env = environment({ LLM_REASONING_EFFORT: " high ", LLM_FALLBACK_REASONING_EFFORT: " " });
    expect(validateConfig(env)).toEqual({ ready: true, errors: [] });
    expect(resolveLlmRoutingSnapshot(env, "basic").common.primary.effort).toBe("high");
  });
});
