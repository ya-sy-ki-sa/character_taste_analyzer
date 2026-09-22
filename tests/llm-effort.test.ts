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
    JEV_PROVIDER: "fake",
    JEV_MODEL: "typesafe/jev",
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

function tierRoute(tier: string, effort?: string) {
  return JSON.stringify({
    [tier]: { provider: "openai", model: `${tier}-model`, ...(effort === undefined ? {} : { effort }) },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("LLM reasoning effort transport", () => {
  it("uses model defaults when the common route and tier route omit effort", async () => {
    const { bodies } = mockOpenAi();
    const result = await createLlmProvider(environment()).generateStructured(request);
    expect(bodies()[0]).not.toHaveProperty("reasoning");
    expect(result.metadata.effectiveSettings?.reasoningEffort).toBeNull();
  });

  it.each(membershipTierSchema.options)("uses the effort configured in %s tier route", async (tier) => {
    const { bodies } = mockOpenAi();
    const efforts = { basic: "none", silver: "low", gold: "high", premium: "max" };
    const env = environment({ LLM_TIER_ROUTES_JSON: tierRoute(tier, efforts[tier]) });
    const llm = createLlmProvider(env, { snapshot: resolveLlmRoutingSnapshot(env, tier) });
    await llm.generateStructured(request);
    expect(bodies()[0]).toMatchObject({ model: `${tier}-model`, reasoning: { effort: efforts[tier] } });
    expect(llmRoutingSnapshotSchema.parse(resolveLlmRoutingSnapshot(env, tier)).tier.primary.effort).toBe(
      efforts[tier],
    );
  });

  it("uses the common model default for common operations", async () => {
    const { bodies } = mockOpenAi();
    const env = environment({ LLM_TIER_ROUTES_JSON: tierRoute("gold", "high") });
    const llm = createLlmProvider(env, { snapshot: resolveLlmRoutingSnapshot(env, "gold") });
    await llm.generateStructured({ ...request, operation: "dark_scope_assessment" });
    expect(bodies()[0]).toEqual(expect.objectContaining({ model: "configured-model" }));
    expect(bodies()[0]).not.toHaveProperty("reasoning");
  });

  it("uses the JSON default route when no tier route matches", async () => {
    const { bodies } = mockOpenAi();
    const env = environment({
      LLM_TIER_ROUTES_JSON: JSON.stringify({
        default: { provider: "openai", model: "default-model", effort: "high" },
      }),
    });
    const llm = createLlmProvider(env, { snapshot: resolveLlmRoutingSnapshot(env, "premium") });
    await llm.generateStructured(request);
    await llm.generateStructured({ ...request, operation: "dark_scope_assessment" });
    expect(bodies().map((body) => ({ model: body.model, effort: body.reasoning?.effort }))).toEqual([
      { model: "default-model", effort: "high" },
      { model: "default-model", effort: "high" },
    ]);
  });

  it("prefers an explicit tier route over the JSON default route", async () => {
    const { bodies } = mockOpenAi();
    const env = environment({
      LLM_TIER_ROUTES_JSON: JSON.stringify({
        default: { provider: "openai", model: "default-model", effort: "high" },
        gold: { provider: "openai", model: "gold-model", effort: "low" },
      }),
    });
    const llm = createLlmProvider(env, { snapshot: resolveLlmRoutingSnapshot(env, "gold") });
    await llm.generateStructured(request);
    expect(bodies()[0]).toMatchObject({ model: "gold-model", reasoning: { effort: "low" } });
  });

  it("keeps replay as the default when a JSON default route is present", async () => {
    const env = environment({
      LLM_PROVIDER: "replay",
      LLM_MODEL: "replay-v1",
      LLM_TIER_ROUTES_JSON: JSON.stringify({
        default: { provider: "openai", model: "default-model", effort: "high" },
      }),
    });
    const snapshot = resolveLlmRoutingSnapshot(env, "premium");
    expect(snapshot.common.primary).toEqual({ provider: "replay", model: "replay-v1", effort: null });
    expect(snapshot.tier.primary).toEqual(snapshot.common.primary);
    const result = await createLlmProvider(env, { snapshot }).generateStructured(request);
    expect(result.metadata.provider).toBe("replay");
    expect(result.metadata.requestedModel).toBe("replay-v1");
  });

  it("keeps the saved tier effort on schema repair after settings change", async () => {
    const { bodies } = mockOpenAi();
    const env = environment({ LLM_TIER_ROUTES_JSON: tierRoute("basic", "high") });
    const snapshot = resolveLlmRoutingSnapshot(env, "basic");
    env.LLM_TIER_ROUTES_JSON = tierRoute("basic", "low");
    const result = await createLlmProvider(env, { snapshot }).generateStructured({
      ...request,
      operation: "schema_repair",
      repairOfOperation: "preference_analysis",
    });
    expect(bodies()[0].reasoning).toEqual({ effort: "high" });
    expect(result.metadata.effectiveSettings?.reasoningEffort).toBe("high");
  });

  it.each(["@cf/openai/gpt-oss-120b", "@cf/openai/gpt-oss-20b"])(
    "uses the tier route effort for Workers AI %s",
    async (model) => {
      const run = vi.fn(async (_model: string, _input: Record<string, unknown>) => ({ response: '{"value":"ok"}' }));
      for (const effort of [undefined, "low", "medium", "high"]) {
        const env = environment({
          LLM_TIER_ROUTES_JSON: JSON.stringify({
            basic: { provider: "workers_ai", model, ...(effort ? { effort } : {}) },
          }),
          AI: { run },
        });
        const result = await createLlmProvider(env).generateStructured(request);
        const body = run.mock.calls.at(-1)?.[1];
        if (effort) expect(body).toHaveProperty("reasoning_effort", effort);
        else expect(body).not.toHaveProperty("reasoning_effort");
        expect(result.metadata.effectiveSettings?.reasoningEffort).toBe(effort ?? null);
      }
    },
  );

  it("uses the fallback model default because fallback effort is not separately configured", async () => {
    const { fetchMock, bodies } = mockOpenAi();
    fetchMock.mockResolvedValue(Response.json({ error: { message: "capacity" } }, { status: 429 }));
    const run = vi.fn(async (_model: string, _input: Record<string, unknown>) => ({ response: '{"value":"ok"}' }));
    const env = environment({
      LLM_FALLBACK_PROVIDER: "workers_ai",
      LLM_FALLBACK_MODEL: "@cf/openai/gpt-oss-120b",
      AI: { run },
    });
    const result = await createLlmProvider(env).generateStructured(request);
    expect(run.mock.calls[0]?.[1]).not.toHaveProperty("reasoning_effort");
    expect(result.attempts?.at(-1)?.metadata.effectiveSettings?.reasoningEffort).toBeNull();
    expect(bodies()[0]).not.toHaveProperty("reasoning");
  });
});

describe("tier route effort validation", () => {
  it("requires the current snapshot version and complete route shape", () => {
    const snapshot = resolveLlmRoutingSnapshot(environment(), "basic");
    expect(snapshot.tier.primary.effort).toBeNull();
    expect(llmRoutingSnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(llmRoutingSnapshotSchema.safeParse({ ...snapshot, policyVersion: "membership-v1" }).success).toBe(false);
    const { effort: _effort, ...primary } = snapshot.tier.primary;
    expect(llmRoutingSnapshotSchema.safeParse({ ...snapshot, tier: { ...snapshot.tier, primary } }).success).toBe(
      false,
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

  it("rejects an invalid JSON default route", () => {
    const env = environment({ LLM_TIER_ROUTES_JSON: '{"default":{"provider":"openai"}}' });
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
});
