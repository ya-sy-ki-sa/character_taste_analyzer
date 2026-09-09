import { describe, expect, it } from "vitest";
import { z } from "zod";
import { entryDraftSchema } from "../shared/contracts/entries";
import type { UnderstandingCandidate } from "../shared/contracts/understanding";
import { type UnderstandingAudit, understandingAuditSchema } from "../shared/contracts/understanding-quality";
import { understandingAspects } from "../shared/understanding-aspects";
import { fakeUnderstanding } from "../worker/features/analysis/deterministic";
import { understandOne } from "../worker/features/analysis/llm-understanding";
import { fakeGroundedUnderstanding } from "../worker/features/analysis/semantic-fake";
import type { EntryContext } from "../worker/features/analysis/types";
import {
  assessUnderstandingInformation,
  explainUnknownUnderstandingAspects,
  understandingQualityIssues,
} from "../worker/features/analysis/understanding-quality";
import { SEMANTIC_AUDIT_POLICY, SEMANTIC_AUDIT_SCHEMA_VERSION } from "../worker/llm/prompts/semantic-audit";
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
const env = { AUTH_PEPPER: "test" } as Env;
const research = { status: "collected" as const, sources: [] };

function known(): UnderstandingCandidate {
  const result = fakeUnderstanding(payload, false);
  result.summary.behavior = ["仲間の危機に助けに向かう"];
  result.summary.relationships = ["幼馴染と互いに困りごとを相談する"];
  result.assertions[0].valueText = "仲間の危機に助けに向かい、幼馴染とは互いに困りごとを相談する";
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
) {
  const requests: StructuredLlmRequest<unknown>[] = [];
  const llm: LlmProvider = {
    providerId: "replay",
    async generateStructured<T>(request: StructuredLlmRequest<T>) {
      requests.push(request);
      let value = outputs[requests.length - 1];
      if (value instanceof LlmProviderError) throw value;
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
  const entry = {
    llm,
    payload: draft,
    entryRevisionId: "revision",
    ownerUserId: "owner",
  } as EntryContext;
  return { requests, run: () => understandOne(env, entry, "representation", stage, [], research) };
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
    expect(requests).toHaveLength(2);
    expect(Object.values(result.value.summary).every((value) => value.length > 0)).toBe(true);
  });

  it("repairs an audit that erases the understanding, then audits the repair", async () => {
    const { run, requests } = setup([known(), identityOnly(), known(), known()]);
    const result = await run();
    expect(requests).toHaveLength(4);
    expect(requests[2].enableWebSearch).toBe(true);
    expect(requests[3].operation).toBe("understanding_audit");
    expect(new Set(requests.map((request) => request.idempotencyKey)).size).toBe(4);
    expect(result.attempts).toHaveLength(4);
    expect(result.metadata.citations).toHaveLength(4);
    expect(result.value.summary.behavior).toEqual(known().summary.behavior);
  });

  it("stops after one repair instead of accepting an empty final audit", async () => {
    const { run, requests } = setup([identityOnly(), identityOnly(), known(), identityOnly()]);
    await expect(run()).rejects.toMatchObject({
      code: "LLM_SCHEMA_INVALID",
      retryable: false,
      attempts: expect.any(Array),
      safeDetail: expect.stringContaining("参考情報や対象場面を追記"),
    });
    expect(requests).toHaveLength(4);
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
    const { run, requests } = setup([partial, partial, known(), known()], original);
    await run();
    expect(requests).toHaveLength(4);
    expect(requests[2].enableWebSearch).toBe(false);
  });

  it("preserves completed call records when an audit provider fails", async () => {
    const error = new LlmProviderError("unavailable", "EXTERNAL_PROVIDER_UNAVAILABLE", true);
    const { run } = setup([known(), error]);
    await expect(run()).rejects.toMatchObject({ code: error.code, attempts: [expect.any(Object)] });
  });
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
    expect(requests).toHaveLength(4);
    expect(result.value.sourceAssessment.informationQuality).toMatchObject({
      status: "limited",
      contentAspectCount: 1,
      concreteAspectCount: 0,
      completionAttempted: true,
      aspects: candidate.aspectAssessments,
    });
    expect(result.value.assertions).toEqual(candidate.assertions);
    expect(Object.values(result.value.summary).every((item) => item.length > 0)).toBe(true);
    expect(result.value).not.toHaveProperty("aspectAssessments");
    expect(result.attempts).toHaveLength(4);
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
    expect(requests).toHaveLength(2);
    expect(result.value.sourceAssessment.informationQuality).toMatchObject({
      status: "not_flagged",
      concreteAspectCount: 6,
      completionAttempted: false,
    });
  });

  it("clears the limited flag when completion supplies concrete descriptions", async () => {
    const sparse = frozenAudit(sparseFixtures[0]);
    const { run, requests } = setup([sparse, sparse, known(), known()]);
    const result = await run();
    expect(requests).toHaveLength(4);
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
    expect(requests).toHaveLength(4);
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
    expect(requests[2].enableWebSearch).toBe(stage === "base");
    const content = requests[2].messages.map((item) => item.content).join("\n");
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
    const { run, requests } = setup([partial, partial, partial, partial]);
    await expect(run()).rejects.toMatchObject({ code: "LLM_SCHEMA_INVALID", retryable: false });
    expect(requests).toHaveLength(4);
  });

  it("keeps completed records when the additional audit fails", async () => {
    const sparse = frozenAudit(sparseFixtures[0]);
    const error = new LlmProviderError("unavailable", "EXTERNAL_PROVIDER_UNAVAILABLE", true);
    const { run } = setup([sparse, sparse, sparse, error]);
    await expect(run()).rejects.toMatchObject({
      code: error.code,
      attempts: [expect.any(Object), expect.any(Object), expect.any(Object)],
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
              understandingSchemaVersion: SEMANTIC_AUDIT_SCHEMA_VERSION,
              semanticAuditPolicy: SEMANTIC_AUDIT_POLICY,
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
