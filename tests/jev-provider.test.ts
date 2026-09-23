import { describe, expect, it, vi } from "vitest";
import {
  CloudflareJevJudgmentProvider,
  createJudgmentProvider,
  unwrapJevResponse,
  validateJudgmentConfig,
} from "../worker/judgment/provider";
import { JudgmentProviderError, type JudgmentRequest } from "../worker/judgment/types";
import type { Env } from "../worker/types";

const request: JudgmentRequest = {
  state: { character: "架空人物" },
  questions: {
    condition: {
      type: "choice",
      instructions: "条件を確認",
      criteria: { satisfied: "満たす", violated: "違反", uncertain: "不明" },
    },
  },
  fakeAnswers: {
    condition: {
      type: "choice",
      choice: "satisfied",
      confidence: 0.98,
      probabilities: { satisfied: 0.98, violated: 0.01, uncertain: 0.01 },
    },
  },
  context: { correlationId: "request-id", stage: "generation-validation-initial-1", domain: "standard" },
};
const payload = () => ({
  model: "typesafe/jev",
  answers: structuredClone(request.fakeAnswers),
  usage: { input_tokens: 3, output_tokens: 2 },
});

function environment(run: (model: string, input: unknown, options: unknown) => Promise<unknown>): Env {
  return {
    AI: { run },
    JEV_PROVIDER: "typesafe",
    JEV_MODEL: "typesafe/jev",
    AI_GATEWAY_GATEWAY_ID: "default",
    ENVIRONMENT: "production",
  } as Env;
}

describe("Cloudflare Jev transport contract", () => {
  it("accepts direct and nested result envelopes, preserving usage", async () => {
    for (const wrap of [
      (value: unknown) => value,
      (value: unknown) => ({ result: value }),
      (value: unknown) => ({ success: true, result: { result: value } }),
    ]) {
      const run = vi.fn(async () => wrap(payload()));
      const provider = new CloudflareJevJudgmentProvider(environment(run));
      const result = await provider.evaluate(request);
      expect(result.answers.condition.choice).toBe("satisfied");
      expect(result.usage).toEqual({ input_tokens: 3, output_tokens: 2 });
      expect(run).toHaveBeenCalledWith(
        "typesafe/jev",
        { state: request.state, questions: request.questions },
        { gateway: { id: "default" } },
      );
    }
  });

  it.each([
    ["missing answer", () => ({ ...payload(), answers: {} }), "invalid_response"],
    [
      "extra answer",
      () => ({ ...payload(), answers: { ...payload().answers, unexpected: payload().answers?.condition } }),
      "invalid_response",
    ],
    [
      "wrong type",
      () => ({ ...payload(), answers: { condition: { ...request.fakeAnswers?.condition, type: "score" } } }),
      "invalid_response",
    ],
    [
      "bad distribution",
      () => ({
        ...payload(),
        answers: {
          condition: { ...request.fakeAnswers?.condition, probabilities: { satisfied: 1, violated: 1, uncertain: 1 } },
        },
      }),
      "invalid_distribution",
    ],
    ["wrong model", () => ({ ...payload(), model: "not-jev" }), "model_mismatch"],
    ["upstream error", () => ({ success: false, errors: [{ code: 10000 }] }), "upstream_error"],
  ])("rejects %s with Jev context", async (_name, response, reason) => {
    const provider = new CloudflareJevJudgmentProvider(environment(async () => ({ result: response() })));
    await expect(provider.evaluate(request)).rejects.toMatchObject({
      reason,
      context: { providerId: "typesafe", model: "typesafe/jev" },
    });
  });

  it("identifies auth and transport failures as Jev, without prior OpenAI metadata", async () => {
    for (const [failure, reason] of [
      [{ status: 401 }, "authentication_error"],
      [{ status: 403 }, "authentication_error"],
      [{ status: 400 }, "http_400"],
    ] as const) {
      const provider = new CloudflareJevJudgmentProvider(
        environment(async () => {
          throw failure;
        }),
      );
      await expect(provider.evaluate(request)).rejects.toMatchObject({ reason, context: { providerId: "typesafe" } });
    }
    const provider = new CloudflareJevJudgmentProvider(
      environment(async () => {
        throw new JudgmentProviderError("timeout", false);
      }),
    );
    await expect(provider.evaluate(request)).rejects.toMatchObject({
      reason: "timeout",
      context: { providerId: "typesafe" },
    });
  });

  it("retries transient communication failures, then reports Jev network failure", async () => {
    const run = vi.fn(async () => {
      throw new Error("connection refused");
    });
    const provider = new CloudflareJevJudgmentProvider(environment(run));
    await expect(provider.evaluate(request)).rejects.toMatchObject({
      reason: "network_error",
      context: { providerId: "typesafe" },
    });
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("runs fake and replay without remote AI, while disabled configuration needs no Jev credentials", async () => {
    for (const id of ["fake", "replay"] as const) {
      const provider = createJudgmentProvider({ JEV_PROVIDER: id, JEV_MODEL: "typesafe/jev" } as Env);
      const result = await provider.evaluate(request);
      expect(result.model).toBe(`${id}:typesafe/jev`);
      expect(result.answers.condition.choice).toBe("satisfied");
    }
    expect(
      validateJudgmentConfig({ JEV_PROVIDER: "typesafe", JEV_MODEL: "typesafe/jev", ENVIRONMENT: "production" } as Env),
    ).toContain("AI_BINDING_MISSING_FOR_JEV");
    expect(() => unwrapJevResponse({ result: { success: false, errors: ["denied"] } })).toThrowError();
  });
});
