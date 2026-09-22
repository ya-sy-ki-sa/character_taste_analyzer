import { afterEach, describe, expect, it, vi } from "vitest";
import { choiceAnswer, isCertainChoice, isCertainNoul, scoreAnswer } from "../worker/judgment/policy";
import {
  FakeJudgmentProvider,
  ReplayJudgmentProvider,
  TypeSafeJudgmentProvider,
  validateJudgmentConfig,
} from "../worker/judgment/provider";
import type { JudgmentRequest } from "../worker/judgment/types";
import { fixtureResult, parseJudgmentResult } from "../worker/judgment/validation";

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
  model: "jev-1.13.0",
  answers: { support: choiceAnswer(choice, "supported") },
  usage: { input_tokens: 20, output_tokens: 0 },
});

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
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        active++;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        return Response.json(response());
      }),
    );
    const provider = new TypeSafeJudgmentProvider("test-key", "jev-1.13.0");
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
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(new Response(null, { status: 429 })));
    vi.stubGlobal("fetch", fetchMock);
    const completion = expect(
      new TypeSafeJudgmentProvider("test-key", "jev-1.13.0").evaluate(request()),
    ).rejects.toMatchObject({ code: "PROVIDER_CAPACITY_EXHAUSTED", retryable: true });
    await vi.runAllTimersAsync();
    await completion;
    expect(fetchMock).toHaveBeenCalledTimes(3);
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
  it("sends only real state/questions and omits fixture answers and context", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json(response()));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "info").mockImplementation(() => {});
    await new TypeSafeJudgmentProvider("test-key", "jev-1.13.0").evaluate(request());
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(Object.keys(body).sort()).toEqual(["model", "questions", "state"]);
    expect(body).not.toHaveProperty("fakeAnswers");
  });
  it("does not retry invalid responses or authentication errors", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const fetchMock = vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new TypeSafeJudgmentProvider("test-key", "jev-1.13.0").evaluate(request())).rejects.toMatchObject({
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("rejects missing configuration without inferring a provider from the LLM", () => {
    expect(validateJudgmentConfig({})).toContain("JEV_PROVIDER_CONFIGURATION_INVALID");
    expect(validateJudgmentConfig({ JEV_PROVIDER: "typesafe", JEV_MODEL: "jev-1.13.0" })).toContain(
      "TYPESAFE_API_KEY_REQUIRED",
    );
    expect(validateJudgmentConfig({ JEV_PROVIDER: "fake", JEV_MODEL: "jev-1.13.0" })).toEqual([]);
  });
});
