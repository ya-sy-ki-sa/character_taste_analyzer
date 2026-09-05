import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { membershipTierSchema } from "../shared/membership";
import { validateConfig } from "../worker/config";
import { createLlmProvider } from "../worker/llm/providers";
import { llmOperationRouting, parseTierRoutes, resolveLlmRoutingSnapshot } from "../worker/llm/routing";
import type { LlmOperation } from "../worker/llm/types";
import type { Env } from "../worker/types";

const schema = z.object({ value: z.string() });
const request = {
  operation: "character_understanding" as LlmOperation,
  schemaName: "routing_test",
  schemaVersion: "1",
  schema,
  jsonSchema: z.toJSONSchema(schema) as Record<string, unknown>,
  messages: [{ role: "user" as const, content: "test data" }],
  maxOutputTokens: 100,
  temperature: 0,
  idempotencyKey: "routing-test",
  fakeFactory: () => ({ value: "fake" }),
};
function setup(overrides: Partial<Env> = {}) {
  const run = vi.fn(async (_model: string, _input: Record<string, unknown>, _options: { gateway: { id: string } }) => ({
    response: '{"value":"ok"}',
  }));
  const env = {
    DB: {} as D1Database,
    ENVIRONMENT: "local",
    AUTH_PEPPER: "test-only",
    LLM_PROVIDER: "workers_ai",
    LLM_MODEL: "common-model",
    LLM_TIER_ROUTES_JSON: JSON.stringify(
      Object.fromEntries(
        membershipTierSchema.options.map((tier) => [tier, { provider: "workers_ai", model: `${tier}-model` }]),
      ),
    ),
    AI: { run },
    AI_GATEWAY_GATEWAY_ID: "test-gateway",
    MODERATION_PROVIDER: "fake",
    EMBEDDING_PROVIDER: "fake",
    EMBEDDING_MODEL: "fake-v1",
    EMBEDDING_DIMENSIONS: "1536",
    ...overrides,
  } as Env;
  return { env, run };
}
afterEach(() => vi.unstubAllGlobals());

describe.each(membershipTierSchema.options)("%s routing", (tier) => {
  it.each(Object.keys(llmOperationRouting) as LlmOperation[])(
    "selects and records the model for %s",
    async (operation) => {
      const { env, run } = setup();
      const snapshot = resolveLlmRoutingSnapshot(env, tier);
      const result = await createLlmProvider(env, { snapshot, jobId: "job" }).generateStructured({
        ...request,
        operation,
        ...(operation === "schema_repair" ? { repairOfOperation: "preference_analysis" as const } : {}),
      });
      const common = operation === "dark_scope_assessment";
      const model = common ? "common-model" : `${tier}-model`;
      expect(run.mock.calls[0]?.[0]).toBe(model);
      expect(result.metadata).toMatchObject({ operation, requestedModel: model, resolvedModel: model });
      expect(result.metadata.effectiveSettings?.llmRouting).toMatchObject({
        membershipTier: tier,
        operation,
        selectionReason: common ? "common" : "tier",
        policyVersion: "membership-v2",
        jobId: "job",
      });
      expect(result.attempts?.[0].metadata).toEqual(result.metadata);
    },
  );

  it("inherits the environment model when a tier is omitted", async () => {
    const { env, run } = setup({ LLM_TIER_ROUTES_JSON: undefined });
    await createLlmProvider(env, { snapshot: resolveLlmRoutingSnapshot(env, tier) }).generateStructured(request);
    expect(run.mock.calls[0]?.[0]).toBe("common-model");
  });

  it("uses the same model for automatic schema repair", async () => {
    const { env, run } = setup();
    run.mockResolvedValueOnce({ response: '{"value":123}' });
    const result = await createLlmProvider(env, { snapshot: resolveLlmRoutingSnapshot(env, tier) }).generateStructured(
      request,
    );
    expect(run.mock.calls.map((call) => call[0])).toEqual([`${tier}-model`, `${tier}-model`]);
    expect(result.attempts?.map((attempt) => attempt.metadata.attemptNumber)).toEqual([0, 1]);
    expect(result.attempts?.every((attempt) => attempt.metadata.effectiveSettings?.llmRouting)).toBe(true);
  });

  it("keeps the configured common fallback and permits tier fallback only for basic", async () => {
    const { env, run } = setup({ LLM_FALLBACK_PROVIDER: "fake", LLM_FALLBACK_MODEL: "fake-v1" });
    run.mockRejectedValue(new Error("429 capacity exhausted"));
    const llm = createLlmProvider(env, { snapshot: resolveLlmRoutingSnapshot(env, tier) });
    if (tier === "basic") {
      const result = await llm.generateStructured(request);
      expect(result.metadata.provider).toBe("fake");
      expect(result.attempts).toHaveLength(2);
    } else {
      await expect(llm.generateStructured(request)).rejects.toMatchObject({
        code: "PROVIDER_CAPACITY_EXHAUSTED",
        retryable: true,
        attempts: [
          {
            metadata: {
              requestedModel: `${tier}-model`,
              effectiveSettings: { llmRouting: { membershipTier: tier, fallback: null } },
            },
          },
        ],
      });
    }
    const result = await llm.generateStructured({ ...request, operation: "dark_scope_assessment" });
    expect(result.metadata).toMatchObject({ provider: "fake", fallbackFromProvider: "workers_ai" });
    expect(result.attempts).toHaveLength(2);
  });
});

describe("routing configuration and repair contracts", () => {
  it.each([
    "",
    "{",
    "null",
    "[]",
    '{"diamond":{"provider":"openai","model":"x"}}',
    '{"gold":{"provider":"unknown","model":"x"}}',
    '{"gold":{"provider":"openai","model":" "}}',
    '{"gold":{"provider":"openai"}}',
    '{"gold":{"model":"x"}}',
    '{"gold":{"provider":"openai","model":"x","apiKey":"not-allowed"}}',
  ])("rejects invalid configuration: %s", (value) => {
    expect(() => parseTierRoutes(value)).toThrow();
    expect(validateConfig(setup({ LLM_TIER_ROUTES_JSON: value }).env).errors).toContain("LLM_TIER_ROUTES_INVALID");
  });

  it("validates dependencies that are used only by a tier", () => {
    const { env } = setup({
      LLM_PROVIDER: "fake",
      AI: undefined,
      AI_GATEWAY_GATEWAY_ID: undefined,
      LLM_TIER_ROUTES_JSON:
        '{"silver":{"provider":"workers_ai","model":"x"},"premium":{"provider":"openai","model":"y"}}',
    });
    expect(validateConfig(env).errors).toEqual(
      expect.arrayContaining([
        "AI_BINDING_MISSING",
        "AI_GATEWAY_GATEWAY_ID_MISSING",
        "AI_GATEWAY_ACCOUNT_ID_MISSING",
        "AI_GATEWAY_TOKEN_MISSING",
        "OPENAI_API_KEY_MISSING",
      ]),
    );
  });

  it("requires an origin for explicit schema repair, including common-operation repair", async () => {
    const { env, run } = setup();
    const llm = createLlmProvider(env, { snapshot: resolveLlmRoutingSnapshot(env, "premium") });
    await expect(llm.generateStructured({ ...request, operation: "schema_repair" })).rejects.toMatchObject({
      code: "LLM_REPAIR_ORIGIN_REQUIRED",
    });
    expect(run).not.toHaveBeenCalled();
    await llm.generateStructured({
      ...request,
      operation: "schema_repair",
      repairOfOperation: "dark_scope_assessment",
    });
    expect(run.mock.calls[0]?.[0]).toBe("common-model");
  });

  it("sends the selected OpenAI model and never retries a nonretryable rejection on fallback", async () => {
    const fetchMock = vi.fn(async () => Response.json({ error: { message: "bad request" } }, { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);
    const { env } = setup({
      LLM_TIER_ROUTES_JSON: '{"basic":{"provider":"openai","model":"selected-model"}}',
      LLM_FALLBACK_PROVIDER: "fake",
      LLM_FALLBACK_MODEL: "fake-v1",
      OPENAI_API_KEY: "test-key",
      AI_GATEWAY_ACCOUNT_ID: "test-account",
      AI_GATEWAY_TOKEN: "test-token",
    });
    await expect(createLlmProvider(env).generateStructured(request)).rejects.toMatchObject({
      code: "EXTERNAL_PROVIDER_REJECTED",
      retryable: false,
      attempts: [
        {
          metadata: {
            requestedModel: "selected-model",
            effectiveSettings: { llmRouting: { membershipTier: "basic" } },
          },
        },
      ],
    });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.model).toBe("selected-model");
    expect(body.input).toEqual(request.messages);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("allows an explicit fallback to a different model of the same provider", async () => {
    const { env, run } = setup({ LLM_FALLBACK_PROVIDER: "workers_ai", LLM_FALLBACK_MODEL: "alternate-model" });
    run.mockRejectedValueOnce(new Error("429 capacity exhausted"));
    const result = await createLlmProvider(env).generateStructured(request);
    expect(run.mock.calls.map((call) => call[0])).toEqual(["basic-model", "alternate-model"]);
    expect(result.metadata).toMatchObject({ requestedModel: "alternate-model", fallbackFromProvider: "workers_ai" });
  });
});
