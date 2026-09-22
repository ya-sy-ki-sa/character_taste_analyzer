import { afterEach, describe, expect, it, vi } from "vitest";
import { choiceAnswer, isCertainChoice, isCertainNoul, scoreAnswer } from "../worker/judgment/policy";
import {
  CloudflareJevJudgmentProvider,
  FakeJudgmentProvider,
  ReplayJudgmentProvider,
  validateJudgmentConfig,
} from "../worker/judgment/provider";
import type { JudgmentRequest } from "../worker/judgment/types";
import { fixtureResult, parseJudgmentResult } from "../worker/judgment/validation";
import type { AiBinding } from "../worker/types";

const choice = {
  type: "choice",
  instructions: "原文は候補を支持するか",
  criteria: { supported: "支持", unknown: "不明" },
} as const;
const score = { type: "score", instructions: "条件への適合度", criteria: ["不一致", "一部一致", "一致"] } as const;
const request = (): JudgmentRequest => ({
  state: { source: "fixture" },
  questions: { support: choice },
  context: { correlationId: "test-run", stage: "support", domain: "standard" },
  fakeAnswers: { support: choiceAnswer(choice, "supported") },
});
const response = () => ({
  model: "typesafe/jev",
  answers: { support: choiceAnswer(choice, "supported") },
  usage: { input_tokens: 20, output_tokens: 0 },
});
const bindingResponse = () => ({
  state: "Completed",
  result: { ...response(), model: "jev-1.13.0" },
  gatewayMetadata: { keySource: "Unified" },
});
const gatewayId = "test-gateway";
const binding = (run: AiBinding["run"]): AiBinding => ({ run });

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("typed judgments", () => {
  it("limits concurrent requests and never logs source text", async () => {
    vi.useFakeTimers();
    let active = 0;
    let maximum = 0;
    const logs = vi.spyOn(console, "info").mockImplementation(() => {});
    const run = vi.fn(async () => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return response();
    });
    const provider = new CloudflareJevJudgmentProvider(binding(run), "typesafe/jev", gatewayId);
    const completion = Promise.all(
      Array.from({ length: 9 }, () => provider.evaluate({ ...request(), state: "PRIVATE_SOURCE_TEXT" })),
    );
    await vi.runAllTimersAsync();
    await completion;
    expect(maximum).toBe(4);
    expect(JSON.stringify(logs.mock.calls)).not.toContain("PRIVATE_SOURCE_TEXT");
  });
  it("retries capacity failures at most twice", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "info").mockImplementation(() => {});
    const run = vi.fn().mockRejectedValue({ status: 429 });
    const completion = expect(
      new CloudflareJevJudgmentProvider(binding(run), "typesafe/jev", gatewayId).evaluate(request()),
    ).rejects.toMatchObject({ code: "PROVIDER_CAPACITY_EXHAUSTED", retryable: true });
    await vi.runAllTimersAsync();
    await completion;
    expect(run).toHaveBeenCalledTimes(3);
  });
  it("requires the exact question set and probability distribution", () => {
    expect(() => parseJudgmentResult({ ...response(), answers: {} }, request().questions)).toThrow();
    expect(() =>
      parseJudgmentResult(
        {
          ...response(),
          answers: { support: { ...response().answers.support, probabilities: { supported: 0.6, unknown: 0.6 } } },
        },
        request().questions,
      ),
    ).toThrow();
    expect(() =>
      parseJudgmentResult({ ...response(), answers: { support: { type: "noul", noul: 1 } } }, request().questions),
    ).toThrow();
  });
  it("normalizes Jev probabilities rounded to two decimal places", () => {
    const rounded = {
      ...response(),
      answers: {
        support: {
          ...response().answers.support,
          choice: "unknown",
          probabilities: { supported: 0.02, unknown: 0.97 },
        },
      },
    };

    const parsed = parseJudgmentResult(rounded, request().questions);

    expect(parsed.answers.support).toMatchObject({ choice: "unknown" });
    expect(
      Object.values((parsed.answers.support as { probabilities: Record<string, number> }).probabilities),
    ).toHaveLength(2);
    expect(
      Object.values((parsed.answers.support as { probabilities: Record<string, number> }).probabilities).reduce(
        (sum, value) => sum + value,
        0,
      ),
    ).toBeCloseTo(1);
  });
  it("keeps Jev's explicit choice when the distribution is uncertain", () => {
    const answer = {
      ...response().answers.support,
      choice: "supported",
      probabilities: { supported: 0.4, unknown: 0.59 },
    };

    const parsed = parseJudgmentResult({ ...response(), answers: { support: answer } }, request().questions);

    expect(parsed.answers.support).toMatchObject({ choice: "supported" });
  });
  it("accepts a calibrated score with rounded probability expectation", () => {
    const question = { ...score, criteria: [...score.criteria] };
    const answer = {
      type: "score" as const,
      score: 0.79,
      probabilities: { "0": 0.22, "1": 0.78, "2": 0 },
      legend: Object.fromEntries(question.criteria.map((level, index) => [String(index), level])),
      confidence: 0.9,
    };

    const parsed = parseJudgmentResult(
      { model: "typesafe/jev", answers: { fit: answer }, usage: { input_tokens: 20, output_tokens: 0 } },
      { fit: question },
    );

    expect(parsed.answers.fit).toMatchObject({ score: 0.79 });
  });
  it("validates score levels and keeps probability separate from degree", () => {
    const question = { ...score, criteria: [...score.criteria] };
    const result = fixtureResult("fake", { fit: scoreAnswer(question, 1) }, { fit: question });
    expect(result.answers.fit).toMatchObject({ score: 1, confidence: 1 });
    expect(isCertainNoul({ type: "noul", noul: 0.5 })).toBe(false);
    expect(isCertainChoice({ ...choiceAnswer(choice, "supported"), confidence: 0.5 })).toBe(false);
  });
  it("Fake and Replay require explicit complete fixtures and never fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const provider of [new FakeJudgmentProvider(), new ReplayJudgmentProvider()]) {
      expect((await provider.evaluate(request())).answers.support).toEqual(choiceAnswer(choice, "supported"));
      await expect(provider.evaluate({ ...request(), fakeAnswers: {} })).rejects.toThrow();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("uses the Cloudflare AI binding and omits fixture answers and context", async () => {
    const run = vi.fn().mockResolvedValue(response());
    vi.spyOn(console, "info").mockImplementation(() => {});
    await new CloudflareJevJudgmentProvider(binding(run), "typesafe/jev", gatewayId).evaluate(request());
    expect(run).toHaveBeenCalledWith(
      "typesafe/jev",
      { state: request().state, questions: request().questions },
      {
        gateway: { id: gatewayId },
      },
    );
    expect(run.mock.calls[0]?.[1]).not.toHaveProperty("fakeAnswers");
    expect(run.mock.calls[0]?.[1]).not.toHaveProperty("context");
  });
  it("unwraps the Cloudflare AI binding response envelope before validation", async () => {
    const run = vi.fn().mockResolvedValue(bindingResponse());
    vi.spyOn(console, "info").mockImplementation(() => {});

    const result = await new CloudflareJevJudgmentProvider(binding(run), "typesafe/jev", gatewayId).evaluate(request());

    expect(result).toEqual(response());
  });
  it("marks malformed binding responses as Jev provider failures", async () => {
    const run = vi.fn().mockResolvedValue({ ...bindingResponse(), result: { ...response(), answers: {} } });
    vi.spyOn(console, "info").mockImplementation(() => {});

    await expect(
      new CloudflareJevJudgmentProvider(binding(run), "typesafe/jev", gatewayId).evaluate(request()),
    ).rejects.toMatchObject({
      reason: "invalid_response",
      context: { providerId: "typesafe", model: "typesafe/jev" },
    });
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("does not retry invalid responses or authentication errors", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const run = vi.fn().mockRejectedValue({ status: 401 });
    await expect(
      new CloudflareJevJudgmentProvider(binding(run), "typesafe/jev", gatewayId).evaluate(request()),
    ).rejects.toMatchObject({
      retryable: false,
    });
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("rejects missing configuration without inferring a provider from the LLM", () => {
    expect(validateJudgmentConfig({})).toContain("JEV_PROVIDER_CONFIGURATION_INVALID");
    expect(validateJudgmentConfig({ JEV_PROVIDER: "typesafe", JEV_MODEL: "typesafe/jev" })).toEqual(
      expect.arrayContaining(["AI_BINDING_MISSING_FOR_JEV", "AI_GATEWAY_GATEWAY_ID_REQUIRED_FOR_JEV"]),
    );
    expect(
      validateJudgmentConfig({
        JEV_PROVIDER: "typesafe",
        JEV_MODEL: "typesafe/jev",
        AI: binding(vi.fn()),
      }),
    ).toEqual(expect.arrayContaining(["AI_GATEWAY_GATEWAY_ID_REQUIRED_FOR_JEV"]));
    expect(
      validateJudgmentConfig({
        JEV_PROVIDER: "typesafe",
        JEV_MODEL: "typesafe/jev",
        AI: binding(vi.fn()),
        AI_GATEWAY_GATEWAY_ID: "test-gateway",
      }),
    ).toEqual([]);
    expect(validateJudgmentConfig({ JEV_PROVIDER: "fake", JEV_MODEL: "typesafe/jev" })).toEqual([]);
  });
});
