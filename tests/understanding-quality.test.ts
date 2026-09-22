import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { entryDraftSchema } from "../shared/contracts/entries";
import type { UnderstandingCandidate } from "../shared/contracts/understanding";
import { type UnderstandingAudit, understandingAuditSchema } from "../shared/contracts/understanding-quality";
import { understandingAspects } from "../shared/understanding-aspects";
import { fakeUnderstanding } from "../worker/features/analysis/deterministic";
import { understandOne } from "../worker/features/analysis/llm-understanding";
import { fakeGroundedUnderstanding } from "../worker/features/analysis/semantic-fake";
import type { EntryContext, NormalizeUnderstandingAudit } from "../worker/features/analysis/types";
import {
  assessUnderstandingInformation,
  explainUnknownUnderstandingAspects,
  understandingQualityIssues,
} from "../worker/features/analysis/understanding-quality";
import { choiceAnswer } from "../worker/judgment/policy";
import * as judgmentProvider from "../worker/judgment/provider";
import type { JudgmentProvider } from "../worker/judgment/types";
import { UNDERSTANDING_INFORMATION_POLICY } from "../worker/llm/prompts/understanding";
import { type LlmProvider, LlmProviderError, type StructuredLlmRequest } from "../worker/llm/types";
import type { Env } from "../worker/types";
import sparseFixtures from "./fixtures/sparse-understanding.json";
import { concreteAudit, frozenAudit } from "./support/understanding-audit";

const payload = entryDraftSchema.parse({
  registrationType: "existing",
  workTitle: "テスト作品",
  characterName: "テスト人物",
  identityResolution: { mode: "new" },
  preference: { responseChannels: [] },
});
const env = { AUTH_PEPPER: "test", JEV_PROVIDER: "fake", JEV_MODEL: "typesafe/jev" } as Env;
const research = { status: "collected" as const, sources: [] };

afterEach(() => vi.restoreAllMocks());

function known(): UnderstandingCandidate {
  const result = fakeUnderstanding(payload, false);
  result.summary.behavior = ["仲間の危機に助けに向かう"];
  result.summary.relationships = ["幼馴染と互いに困りごとを相談する"];
  const original = result.assertions[0];
  result.assertions = [
    { ...original, rawLabel: "行動", valueText: "仲間の危機に助けに向かう", attributeStableKey: null },
    { ...original, rawLabel: "関係性", valueText: "幼馴染と互いに困りごとを相談する", attributeStableKey: null },
  ];
  return result;
}

// Reproduces B05: identity and an identification assertion exist, all seven aspects are empty.
function identityOnly(): UnderstandingCandidate {
  const result = known();
  for (const aspect of understandingAspects) result.summary[aspect] = [];
  result.uncertainties = [{ topic: "人物像", reason: "公開資料は登場人物の同定のみ" }];
  return result;
}

function setup(
  outputs: Array<UnderstandingCandidate | UnderstandingAudit | LlmProviderError>,
  draft = payload,
  stage: "base" | "target" = "target",
  normalizationOverride?: NormalizeUnderstandingAudit,
) {
  const requests: StructuredLlmRequest<unknown>[] = [];
  let currentAudit: UnderstandingAudit | undefined;
  const llm: LlmProvider = {
    providerId: "replay",
    async generateStructured<T>(request: StructuredLlmRequest<T>) {
      requests.push(request);
      let value = outputs[requests.length - 1];
      if (value instanceof LlmProviderError) throw value;
      currentAudit =
        value && typeof value === "object" && "aspectAssessments" in value ? (value as UnderstandingAudit) : undefined;
      if (request.operation === "understanding_audit" && !("aspectAssessments" in value)) value = concreteAudit(value);
      if (request.operation === "understanding_audit") value = fakeGroundedUnderstanding(value as UnderstandingAudit);
      const metadata = {
        operation: request.operation,
        provider: "replay" as const,
        transport: "replay" as const,
        adapterVersion: "test",
        requestedModel: "test",
        resolvedModel: "test",
        latencyMs: 1,
        dataRetentionMode: "no_retention" as const,
        rootRequestId: request.idempotencyKey,
        citations: [{ url: `https://example.com/${requests.length}`, title: `資料${requests.length}` }],
      };
      return { value: request.schema.parse(value), metadata, attempts: [{ output: value, metadata }] };
    },
  };
  const provider: JudgmentProvider = {
    providerId: "fake",
    async evaluate(request) {
      if (!request.fakeAnswers) throw new Error("TEST_JUDGMENT_FIXTURE_MISSING");
      const answers = structuredClone(request.fakeAnswers);
      if (request.context.stage.endsWith(":aspect") && request.state && typeof request.state === "object") {
        const index = Number((request.state as { assertion?: { index?: number } }).assertion?.index);
        const assigned = Number.isInteger(index)
          ? Object.entries(currentAudit?.aspectAssessments ?? {}).find(([, assessment]) =>
              assessment.assertionIndexes.includes(index),
            )?.[0]
          : undefined;
        const assertion = (request.state as { assertion?: { valueText?: string; rawLabel?: string } }).assertion;
        const text = `${String(assertion?.rawLabel ?? "")} ${String(assertion?.valueText ?? "")}`;
        const fallback =
          assigned ??
          (/幼馴染|関係|相談/u.test(text)
            ? "relationships"
            : /外見|話し方|かわい|造形/u.test(text)
              ? "expression"
              : /親切|思いやり|忠実|価値/u.test(text)
                ? "values"
                : /英雄|ヒーロー|脇役|コミック/u.test(text)
                  ? "narrativeRole"
                  : /道徳|善|悪/u.test(text)
                    ? "moralityOrientation"
                    : /目的|目標|復讐/u.test(text)
                      ? "goals"
                      : "behavior");
        const question = request.questions.aspect;
        if (question?.type === "choice" && fallback in question.criteria)
          answers.aspect = choiceAnswer(question, fallback);
      }
      if (request.context.stage.endsWith(":information") && request.state && typeof request.state === "object") {
        const aspect = String((request.state as { aspect?: string }).aspect ?? "");
        const kind = currentAudit?.aspectAssessments[aspect as keyof UnderstandingAudit["aspectAssessments"]]?.kind;
        const question = request.questions.kind;
        if (kind && question?.type === "choice" && kind in question.criteria)
          answers.kind = choiceAnswer(question, kind);
      }
      return { model: "fake:typesafe/jev", answers, usage: { input_tokens: 0, output_tokens: 0 } };
    },
  };
  vi.spyOn(judgmentProvider, "createJudgmentProvider").mockReturnValue(provider);
  const entry = {
    llm,
    payload: draft,
    entryRevisionId: "revision",
    ownerUserId: "owner",
  } as EntryContext;
  // Isolate call/coverage orchestration here; pipeline tests run the real provenance normalization.
  const normalizeAudit: NormalizeUnderstandingAudit = async (audit, _citations, completionAttempted) => ({
    ...explainUnknownUnderstandingAspects(audit),
    aspectAssessments: audit.aspectAssessments,
    informationQuality: assessUnderstandingInformation(audit, completionAttempted),
  });
  return {
    requests,
    run: () =>
      understandOne(env, entry, "representation", stage, [], research, normalizationOverride ?? normalizeAudit),
  };
}

describe("character understanding completeness", () => {
  it("rejects identity-only output even when the JSON contract accepts it", () => {
    expect(understandingQualityIssues(identityOnly())).toContain(
      "人物の同定だけで、7項目のキャラクター像がすべて空です",
    );
    const candidate = identityOnly();
    candidate.summary.behavior = ["  "];
    expect(understandingQualityIssues(candidate)).not.toEqual([]);
  });

  it("keeps a partial understanding and explains unknown aspects without inventing assertions", () => {
    const candidate = known();
    expect(understandingQualityIssues(candidate)).toEqual([]);
    const displayed = explainUnknownUnderstandingAspects(candidate);
    expect(displayed.summary.behavior).toEqual(candidate.summary.behavior);
    expect(displayed.summary.goals[0]).toContain("確認できません：");
    expect(displayed.assertions).toEqual(candidate.assertions);
    expect(candidate.summary.goals).toEqual([]);
  });

  it("does not add calls when two aspects have concrete descriptions and other gaps are explained", async () => {
    const { run, requests } = setup([known(), known()]);
    const result = await run();
    expect(requests).toHaveLength(1);
    expect(Object.values(result.value.summary).every((value) => value.length > 0)).toBe(true);
  });

  it("repairs an audit that erases the understanding, then audits the repair", async () => {
    const { run, requests } = setup([identityOnly(), known()]);
    const result = await run();
    expect(requests).toHaveLength(2);
    expect(requests[1].enableWebSearch).toBe(true);
    expect(new Set(requests.map((request) => request.idempotencyKey)).size).toBe(2);
    expect(result.attempts).toHaveLength(2);
    expect(result.metadata.citations).toHaveLength(2);
    expect(result.value.summary.behavior).toEqual(known().summary.behavior);
  });

  it("stops after one repair instead of accepting an empty final audit", async () => {
    const result = await setup([identityOnly(), identityOnly(), identityOnly()]).run();
    expect(result.value.sourceAssessment.informationQuality).toMatchObject({
      status: "limited",
    });
    expect(result.attempts).toHaveLength(3);
  });

  it("repairs unexplained partial gaps and keeps original-character research disabled", async () => {
    const partial = known();
    partial.uncertainties = [];
    const original = entryDraftSchema.parse({
      registrationType: "original",
      characterName: "創作人物",
      characterBasicInfo: "仲間の危機に助けに向かう",
      preference: { responseChannels: [] },
    });
    const { run, requests } = setup([partial, known()], original);
    await run();
    expect(requests).toHaveLength(2);
    expect(requests[1].enableWebSearch).toBe(false);
  });

  it("preserves completed call records when an audit provider fails", async () => {
    const error = new LlmProviderError("unavailable", "EXTERNAL_PROVIDER_UNAVAILABLE", true);
    const { run } = setup([identityOnly(), error]);
    await expect(run()).rejects.toMatchObject({ code: error.code, attempts: [expect.any(Object)] });
  });

  it.each([false, true])(
    "preserves completed calls and retryability when provenance fails (after completion=%s)",
    async (afterCompletion) => {
      const candidate = afterCompletion ? frozenAudit(sparseFixtures[0]) : known();
      const { run, requests } = setup(
        [candidate, candidate, candidate, candidate],
        payload,
        "target",
        async (audit, _citations, attempted) => {
          if (!afterCompletion || attempted) throw new Error("D1_ERROR: provenance unavailable");
          return {
            ...explainUnknownUnderstandingAspects(audit),
            aspectAssessments: audit.aspectAssessments,
            informationQuality: assessUnderstandingInformation(audit, attempted),
          };
        },
      );
      await expect(run()).rejects.toMatchObject({
        code: "D1_ERROR: provenance unavailable",
        retryable: true,
        attempts: Array.from({ length: afterCompletion ? 2 : 1 }, () => expect.any(Object)),
      });
      expect(requests).toHaveLength(afterCompletion ? 2 : 1);
    },
  );
});

describe("sparse character understanding", () => {
  it("sends a closed seven-property object in the provider JSON Schema", () => {
    const schema = z.toJSONSchema(understandingAuditSchema, { target: "draft-7" });
    const aspects = schema.properties?.aspectAssessments;
    if (!aspects || typeof aspects !== "object") throw new Error("audit aspects must be an object schema");
    expect(aspects).toMatchObject({ type: "object", additionalProperties: false, required: understandingAspects });
    expect(Object.keys(aspects?.properties ?? {})).toEqual(understandingAspects);
    expect(aspects).not.toHaveProperty("propertyNames");
  });
  it("completes sparse content once and keeps the limited result reviewable", async () => {
    const candidate = frozenAudit(sparseFixtures[0]);
    const { run, requests } = setup([candidate, candidate, candidate, candidate]);
    const result = await run();
    expect(requests).toHaveLength(3);
    expect(result.value.sourceAssessment.informationQuality).toMatchObject({
      status: "limited",
      contentAspectCount: 1,
      concreteAspectCount: 0,
      completionAttempted: true,
    });
    expect(result.value.assertions).toEqual(candidate.assertions);
    expect(Object.values(result.value.summary).every((item) => item.length > 0)).toBe(true);
    expect(result.value).not.toHaveProperty("aspectAssessments");
    expect(result.attempts).toHaveLength(3);
    expect(result.metadata.effectiveSettings).toMatchObject({
      understandingInformationPolicy: UNDERSTANDING_INFORMATION_POLICY,
    });
  });

  it("does not complete D03 when the summary labels reference concrete assertions", async () => {
    const fixture = sparseFixtures.find((item) => item.caseId === "D03");
    if (!fixture) throw new Error("D03 fixture missing");
    const candidate = frozenAudit(fixture);
    const { run, requests } = setup([candidate, candidate]);
    const result = await run();
    expect(requests).toHaveLength(1);
    expect(result.value.sourceAssessment.informationQuality).toMatchObject({
      status: "not_flagged",
      concreteAspectCount: 6,
      completionAttempted: false,
    });
  });

  it("clears the limited flag when completion supplies concrete descriptions", async () => {
    const sparse = frozenAudit(sparseFixtures[0]);
    const { run, requests } = setup([sparse, known()]);
    const result = await run();
    expect(requests).toHaveLength(2);
    expect(result.value.sourceAssessment.informationQuality).toMatchObject({
      status: "not_flagged",
      completionAttempted: true,
      reasons: [],
    });
  });

  it("continues with one concrete scene for an original minor character without web search", async () => {
    const candidate = concreteAudit(known());
    candidate.summary.relationships = [];
    candidate.aspectAssessments.relationships = {
      kind: "unknown",
      reason: "一場面のみで関係は不明",
      summaryIndexes: [],
      assertionIndexes: [],
    };
    const draft = entryDraftSchema.parse({
      registrationType: "original",
      characterName: "一場面の端役",
      characterBasicInfo: "仲間の危機に助けに向かう",
      preference: { responseChannels: [] },
    });
    const { run, requests } = setup([candidate, candidate, candidate, candidate], draft);
    expect((await run()).value.sourceAssessment.informationQuality).toMatchObject({
      status: "limited",
      contentAspectCount: 1,
      concreteAspectCount: 1,
    });
    expect(requests).toHaveLength(3);
    expect(requests.every((request) => !request.enableWebSearch)).toBe(true);
  });

  it.each(["base", "target"] as const)("preserves customized %s boundaries during completion", async (stage) => {
    const candidate = frozenAudit(sparseFixtures[0]);
    const draft = entryDraftSchema.parse({
      registrationType: "customized_existing",
      representationType: "alternate_setting",
      workTitle: "原典",
      baseCharacterName: "原典の人物",
      characterName: "改変した人物",
      customizationDescription: "旧友にだけ本音を話す",
      preference: { likedReasons: "好みの秘密", responseChannels: [] },
      identityResolution: { mode: "new" },
    });
    const { run, requests } = setup([candidate, candidate, candidate, candidate], draft, stage);
    await run();
    expect(requests[1].enableWebSearch).toBe(stage === "base");
    const content = requests[1].messages.map((item) => item.content).join("\n");
    expect(content).not.toContain("好みの秘密");
    expect(content.includes("旧友にだけ本音を話す")).toBe(stage === "target");
  });

  it("does not count attribution notes distributed across multiple aspects as concrete", () => {
    const candidate = frozenAudit(sparseFixtures[2]);
    candidate.summary.behavior = [...candidate.summary.relationships];
    candidate.aspectAssessments.behavior = { ...candidate.aspectAssessments.relationships };
    expect(assessUnderstandingInformation(understandingAuditSchema.parse(candidate), false)).toMatchObject({
      status: "limited",
      contentAspectCount: 2,
      concreteAspectCount: 0,
    });
  });

  it("accepts concrete user interpretations without promoting them to canonical facts", async () => {
    const candidate = concreteAudit(known());
    candidate.assertions[0].assertionKind = "user_interpretation";
    candidate.assertions[0].explicitness = "user_explicit";
    const { run } = setup([candidate, candidate]);
    const result = await run();
    expect(result.value.sourceAssessment.informationQuality.status).toBe("not_flagged");
    expect(result.value.assertions[0].assertionKind).toBe("user_interpretation");
  });

  it.each(["missing_aspect", "missing_summary", "out_of_range", "duplicate", "no_assertion", "unknown_content"])(
    "rejects invalid audit structure: %s",
    (failure) => {
      const candidate = concreteAudit(known());
      if (failure === "missing_aspect") Reflect.deleteProperty(candidate.aspectAssessments, "goals");
      if (failure === "missing_summary") candidate.aspectAssessments.behavior.summaryIndexes = [];
      if (failure === "out_of_range") candidate.aspectAssessments.behavior.assertionIndexes = [999];
      if (failure === "duplicate") candidate.aspectAssessments.behavior.summaryIndexes = [0, 0];
      if (failure === "no_assertion") candidate.aspectAssessments.behavior.assertionIndexes = [];
      if (failure === "unknown_content") candidate.aspectAssessments.behavior.kind = "unknown";
      expect(understandingAuditSchema.safeParse(candidate).success).toBe(false);
    },
  );

  it("still stops on unexplained gaps after completion", async () => {
    const partial = known();
    partial.uncertainties = [];
    const { run, requests } = setup([partial, partial, partial]);
    const result = await run();
    expect(result.value.sourceAssessment.informationQuality.status).toBe("not_flagged");
    expect(requests).toHaveLength(3);
  });

  it("keeps completed records when the additional audit fails", async () => {
    const sparse = frozenAudit(sparseFixtures[0]);
    const error = new LlmProviderError("unavailable", "EXTERNAL_PROVIDER_UNAVAILABLE", true);
    const { run } = setup([sparse, sparse, error]);
    await expect(run()).rejects.toMatchObject({
      code: error.code,
      attempts: [expect.any(Object), expect.any(Object)],
    });
  });

  it("records the new audit policy on failed provider attempts too", async () => {
    const sparse = frozenAudit(sparseFixtures[0]);
    const error = new LlmProviderError("invalid audit", "LLM_SCHEMA_INVALID", false);
    error.attemptMetadata = {
      operation: "understanding_audit",
      provider: "replay",
      transport: "replay",
      adapterVersion: "test",
      requestedModel: "test",
      resolvedModel: "test",
      latencyMs: 1,
      dataRetentionMode: "no_retention",
    };
    error.attempts = [{ output: { invalid: true }, metadata: error.attemptMetadata }];
    const { run } = setup([sparse, error]);
    await expect(run()).rejects.toMatchObject({
      attempts: [
        expect.any(Object),
        expect.objectContaining({
          metadata: expect.objectContaining({
            effectiveSettings: {
              understandingInformationPolicy: UNDERSTANDING_INFORMATION_POLICY,
              understandingSchemaVersion: "1.0",
            },
          }),
        }),
      ],
      attemptMetadata: expect.objectContaining({
        effectiveSettings: expect.objectContaining({
          understandingInformationPolicy: UNDERSTANDING_INFORMATION_POLICY,
        }),
      }),
    });
  });
});
