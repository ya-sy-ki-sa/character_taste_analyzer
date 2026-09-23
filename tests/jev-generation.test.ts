import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GenerationBrief } from "../shared/contracts/generation-brief";
import { fakeCharacter, fakeDarkCharacter, fakeValidationReport } from "../worker/features/generation/deterministic";
import { generateCandidate, validateGeneratedCandidate } from "../worker/features/generation/candidates";
import { tryJevGenerationValidation } from "../worker/features/generation/jev-validation";
import type { JudgmentProvider, JudgmentRequest, JudgmentResult } from "../worker/judgment/types";
import type { LlmProvider } from "../worker/llm/types";
import type { Env, GenerationWorkflowParams } from "../worker/types";

vi.mock("../worker/features/generation/model-runs", () => ({ persistModelRun: vi.fn(async () => "run-id") }));
vi.mock("../worker/features/generation/repositories/candidates", () => ({
  insertGenerationValidationRuns: vi.fn(() => ({ run: vi.fn(async () => ({})) })),
  updateJobs: vi.fn(() => ({ run: vi.fn(async () => ({})) })),
}));
vi.mock("../worker/features/generation/similarity", () => ({
  inspectGenerationSimilarity: vi.fn(async () => ({ passed: true, matches: [], violations: [] })),
}));

const brief = (analysisDomain: "standard" | "dark"): GenerationBrief => ({
  schemaVersion: "2.0",
  analysisDomain,
  briefId: "brief-id",
  generationRequestId: "request-id",
  profileSnapshot: { id: "profile", generation: 1, contentHash: "hash", ontologyVersion: "1", algorithmVersion: "1" },
  mode: "faithful",
  purpose: "条件に沿う架空人物を作る",
  creativeContext: { world: null, genre: null, role: null, tone: null, targetDetail: "detailed" },
  preferenceSelections: [
    {
      profileSnapshotItemId: "required-1",
      stableKey: "agency",
      label: "主体性",
      treatment: "required",
      weight: 1,
      condition: {},
      responseChannel: null,
      reactionDescription: null,
      polarity: null,
      valueStance: null,
      rationale: "明示された条件",
      overrideText: null,
    },
  ],
  valuePolicy: {
    allowedOrientations: [],
    requiredStances: [],
    redemption: "not_required",
    hiddenGoodness: "not_required",
    moralJustification: "not_required",
    punishmentOrDefeat: "not_required",
  },
  constraints: { required: [], prohibited: [], contentBoundaries: [], freeInstruction: null },
  nonRequirements: [],
  similarityPolicy: { avoidNamedCharacters: [], nameThreshold: 1, semanticThreshold: 1, combinationThreshold: 1 },
  provenance: { selectedItemIds: ["required-1"], userConstraintHash: "hash", compiledAt: "2026-09-23T00:00:00Z" },
});

function scenario(domain: "standard" | "dark" = "standard") {
  const input = brief(domain);
  const candidate = domain === "dark" ? fakeDarkCharacter(input) : fakeCharacter(input);
  candidate.uncertainties = [];
  const env = {
    GENERATION_JEV_MODE: "guarded",
    JEV_PROVIDER: "fake",
    AUTH_PEPPER: "test-pepper",
  } as Env;
  const generateStructured = vi.fn(async () => ({
    value: fakeValidationReport(input, candidate),
    metadata: { operation: "generation_validation" },
  }));
  const llm = { generateStructured } as unknown as LlmProvider;
  return { input, candidate, env, llm, generateStructured };
}

function providerWith(changed: (result: JudgmentResult) => void): JudgmentProvider {
  return {
    providerId: "fake",
    async evaluate(request: JudgmentRequest) {
      const result: JudgmentResult = {
        model: "typesafe/jev",
        usage: { input_tokens: 10, output_tokens: 3 },
        answers: Object.fromEntries(
          Object.keys(request.questions).map((key) => [
            key,
            {
              type: "choice",
              choice: "satisfied",
              confidence: 0.99,
              probabilities: { satisfied: 0.98, violated: 0.01, uncertain: 0.01 },
            },
          ]),
        ),
      };
      changed(result);
      return result;
    },
  };
}

describe("generation-only Jev guard", () => {
  beforeEach(() => vi.restoreAllMocks());

  it.each(["standard", "dark"] as const)("skips the validation LLM for clear %s pass", async (domain) => {
    const { input, candidate, env, llm, generateStructured } = scenario(domain);
    const report = await validateGeneratedCandidate(env, llm, "owner", "request-id", input, candidate, "initial");
    expect(report.passed).toBe(true);
    expect(report.checks).toHaveLength(4);
    expect(generateStructured).not.toHaveBeenCalled();
  });

  it("does not build offline fixtures for the remote Jev provider", async () => {
    const { input, candidate, env } = scenario();
    const delegate = providerWith(() => {});
    const provider: JudgmentProvider = {
      providerId: "typesafe",
      evaluate(request) {
        expect(request.fakeAnswers).toBeUndefined();
        return delegate.evaluate(request);
      },
    };
    const decision = await tryJevGenerationValidation(env, "request-id", input, candidate, "initial", 1, provider);
    expect(decision.reason).toBe("pass");
  });

  it("keeps the legacy LLM result in shadow and sends no Jev request when off", async () => {
    const { input, candidate, env, llm, generateStructured } = scenario();
    const run = vi.fn(async () => {
      throw new Error("Jev should not be called");
    });
    env.AI = { run } as Env["AI"];
    env.JEV_PROVIDER = "typesafe";
    env.AI_GATEWAY_GATEWAY_ID = "default";
    env.GENERATION_JEV_MODE = "off";
    const off = await validateGeneratedCandidate(env, llm, "owner", "request-id", input, candidate, "initial");
    expect(run).not.toHaveBeenCalled();
    env.JEV_PROVIDER = "fake";
    env.GENERATION_JEV_MODE = "shadow";
    const shadow = await validateGeneratedCandidate(env, llm, "owner", "request-id", input, candidate, "initial");
    expect(shadow).toEqual(off);
    expect(generateStructured).toHaveBeenCalledTimes(2);
  });

  it.each(["violated", "uncertain", "low_confidence"] as const)("falls back on %s", async (state) => {
    const { input, candidate, env } = scenario();
    const decision = await tryJevGenerationValidation(
      env,
      "request-id",
      input,
      candidate,
      "initial",
      1,
      providerWith((result) => {
        const first = Object.values(result.answers)[0];
        if (state === "low_confidence") first.confidence = 0.89;
        else first.choice = state;
      }),
    );
    expect(decision.report).toBeNull();
    expect(decision.reason).toBe(state === "low_confidence" ? "low_confidence" : "not_satisfied");
  });

  it("rejects unrelated pointers and sends dark agency/consent/timeline questions together", async () => {
    const { input, candidate, env } = scenario("dark");
    let instructions = "";
    const decision = await tryJevGenerationValidation(env, "request-id", input, candidate, "initial", 1, {
      providerId: "fake",
      async evaluate(request) {
        instructions = Object.values(request.questions)
          .map((question) => question.instructions)
          .join("\n");
        const result = await providerWith((response) => {
          response.answers.selection_0_pointer.choice = "violated";
        }).evaluate(request);
        return result;
      },
    });
    expect(decision.reason).toBe("not_satisfied");
    expect(instructions).toContain("主体性と同意");
    expect(instructions).toContain("時系列");
    expect(instructions).toContain("Pointerの存在や説明用の自己申告だけではsatisfiedにしない");
  });

  it("falls back for missing or self-reported pointers and candidate uncertainty", async () => {
    const { input, candidate, env, llm, generateStructured } = scenario();
    candidate.briefCoverage[0].outputPointers = ["/briefCoverage/0/explanation"];
    await validateGeneratedCandidate(env, llm, "owner", "request-id", input, candidate, "initial");
    candidate.briefCoverage[0].outputPointers = ["/personality/summary"];
    candidate.uncertainties = ["要確認"];
    await validateGeneratedCandidate(env, llm, "owner", "request-id", input, candidate, "initial");
    expect(generateStructured).toHaveBeenCalledTimes(2);
  });

  it("falls back after Jev authentication failure without tagging the error as OpenAI", async () => {
    const { input, candidate, env, llm, generateStructured } = scenario();
    env.JEV_PROVIDER = "typesafe";
    env.AI_GATEWAY_GATEWAY_ID = "default";
    env.AI = {
      run: vi.fn(async () => {
        throw { status: 401 };
      }),
    } as Env["AI"];
    const log = vi.spyOn(console, "info").mockImplementation(() => {});
    await validateGeneratedCandidate(env, llm, "owner", "request-id", input, candidate, "initial");
    expect(generateStructured).toHaveBeenCalledOnce();
    const events = log.mock.calls.map(([line]) => JSON.parse(line as string) as Record<string, unknown>);
    expect(events).toContainEqual(expect.objectContaining({ reason: "authentication_error", provider: "typesafe" }));
    expect(JSON.stringify(events)).not.toContain("openai");
  });

  it.each(["violated", "low_confidence"] as const)("uses the validation LLM for Jev %s", async (state) => {
    const { input, candidate, env, llm, generateStructured } = scenario();
    env.JEV_PROVIDER = "typesafe";
    env.AI_GATEWAY_GATEWAY_ID = "default";
    env.AI = {
      run: vi.fn(async (_model, wireInput) => {
        const questions = (wireInput as { questions: Record<string, unknown> }).questions;
        const answers = Object.fromEntries(
          Object.keys(questions).map((key) => [
            key,
            {
              type: "choice",
              choice: key === "selection_0" && state === "violated" ? "violated" : "satisfied",
              confidence: state === "low_confidence" ? 0.89 : 0.99,
              probabilities:
                key === "selection_0" && state === "violated"
                  ? { satisfied: 0.01, violated: 0.98, uncertain: 0.01 }
                  : { satisfied: 0.98, violated: 0.01, uncertain: 0.01 },
            },
          ]),
        );
        return { result: { model: "typesafe/jev", answers, usage: { input_tokens: 1, output_tokens: 1 } } };
      }),
    } as Env["AI"];
    await validateGeneratedCandidate(env, llm, "owner", "request-id", input, candidate, "initial");
    expect(generateStructured).toHaveBeenCalledOnce();
  });

  it("keeps one repair attempt and skips only the repaired candidate's validation LLM", async () => {
    const { input, env } = scenario();
    const initial = fakeCharacter(input);
    initial.uncertainties = [];
    initial.briefCoverage[0].status = "violated";
    const repaired = fakeCharacter(input);
    repaired.uncertainties = [];
    const operations: string[] = [];
    const llm = {
      generateStructured: vi.fn(async ({ operation }: { operation: string }) => {
        operations.push(operation);
        const value =
          operation === "character_generation"
            ? initial
            : operation === "generation_repair"
              ? repaired
              : fakeValidationReport(input, initial);
        return { value, metadata: { operation } };
      }),
    } as unknown as LlmProvider;
    const params = {
      ownerUserId: "owner",
      generationRequestId: "request-id",
      jobId: "job-id",
      analysisDomain: "standard",
    } as GenerationWorkflowParams;
    const result = await generateCandidate(env, llm, params, input, input.briefId, 1, []);
    expect(result.report.passed).toBe(true);
    expect(operations).toEqual(["character_generation", "generation_validation", "generation_repair"]);
  });
});
