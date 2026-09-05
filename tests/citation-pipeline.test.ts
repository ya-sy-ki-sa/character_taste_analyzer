import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalysisDomain } from "../shared/analysis-domain";
import { anyEntryDraftSchema } from "../shared/contracts/entries";
import { reviewDetailSchema } from "../shared/contracts/entry-review";
import type { EvidenceReference } from "../shared/contracts/evidence";
import type { PreferenceCandidate } from "../shared/contracts/preference";
import type { UnderstandingCandidate } from "../shared/contracts/understanding";
import { activateAnalysisAndRebuild } from "../worker/features/analysis/activation";
import { loadConfirmedUnderstanding } from "../worker/features/analysis/confirmed-understanding";
import { processPreferenceAnalysis } from "../worker/features/analysis/preference";
import * as research from "../worker/features/analysis/research";
import { loadRetainedPreferences } from "../worker/features/analysis/retention";
import { processCharacterAnalysis } from "../worker/features/analysis/understanding";
import { createEntry } from "../worker/features/entries/create";
import { mutatePreferenceReview } from "../worker/features/entries/preference-review";
import { loadEntryReview } from "../worker/features/entries/review";
import { confirmUnderstanding, mutateUnderstandingReview } from "../worker/features/entries/understanding-review";
import { processProfileRebuild } from "../worker/features/profile/projection";
import * as projection from "../worker/features/profile/repositories/projection";
import * as execution from "../worker/llm/execution";
import type { LlmProvider, LlmRunMetadata, StructuredLlmRequest } from "../worker/llm/types";
import type { Env } from "../worker/types";
import failures from "./fixtures/citation-failures.json";
import { testDatabase } from "./support/database";

const databases: ReturnType<typeof testDatabase>[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) db.close();
});
const liked = "冷酷な知略と非道徳な悪そのものが好き";

async function setup(domain: AnalysisDomain, fixture = failures[0], allInvalid = false) {
  const db = testDatabase();
  databases.push(db);
  const owner = crypto.randomUUID(),
    now = new Date().toISOString();
  db.database
    .prepare(
      "INSERT INTO users (id,username,username_normalized,status,is_public,created_at,updated_at) VALUES (?,?,?,'active',0,?,?)",
    )
    .run(owner, owner, owner, now, now);
  const env = {
    DB: db.DB,
    ENVIRONMENT: "local",
    AUTH_PEPPER: "test",
    LLM_PROVIDER: "fake",
    LLM_MODEL: "fake",
    EMBEDDING_PROVIDER: "fake",
    EMBEDDING_MODEL: "fake",
    ANALYSIS_DAILY_QUOTA: "100",
    GENERATION_DAILY_QUOTA: "100",
  } as Env;
  vi.spyOn(research, "collectCharacterResearch").mockResolvedValue({
    status: "collected",
    sources: fixture.allowedUrls.map((url) => ({
      url,
      title: "収集資料",
      excerpt: "照合可能な人物像",
      provider: "wikipedia_ja",
      trustReason: "fixture",
    })),
  });
  vi.spyOn(console, "info").mockImplementation(() => {});
  const requests: StructuredLlmRequest<unknown>[] = [];
  const bad: EvidenceReference = {
    sourceRef: null,
    sourceUrl: fixture.sourceUrl,
    inputPointer: null,
    quote: null,
    inferenceType: "paraphrase",
  };
  const input: EvidenceReference = {
    sourceRef: "input:/preference/likedReasons",
    sourceUrl: null,
    inputPointer: "/preference/likedReasons",
    quote: liked,
    inferenceType: "direct",
  };
  const provider: LlmProvider = {
    providerId: "fake",
    async generateStructured(request) {
      requests.push(request);
      const value = structuredClone(request.fakeFactory());
      if (
        [
          "customization_delta",
          "character_understanding",
          "understanding_audit",
          "dark_character_understanding",
          "dark_understanding_audit",
        ].includes(request.operation)
      ) {
        const candidate = value as UnderstandingCandidate;
        const template = candidate.assertions[0];
        const registry = JSON.parse(
          request.messages.at(-1)?.content.replace("出典台帳（参照データ）: ", "") ?? "[]",
        ) as Array<{ sourceRef: string }>;
        const good: EvidenceReference = {
          ...bad,
          sourceUrl: null,
          sourceRef: registry[0].sourceRef,
          quote: "照合可能な人物像",
          inferenceType: "direct",
        };
        candidate.assertions = [
          {
            ...template,
            attributeStableKey: null,
            rawLabel: "無効な人物属性",
            valueText: "無効な人物像の詳細",
            explicitness: "source_explicit",
            confidence: 0.99,
            evidence: [bad],
          },
          ...(allInvalid
            ? []
            : [
                {
                  ...template,
                  attributeStableKey: null,
                  rawLabel: "有効な人物属性",
                  valueText: "有効な人物像の詳細",
                  evidence: [good],
                },
                {
                  ...template,
                  attributeStableKey: null,
                  rawLabel: "混在する人物属性",
                  valueText: "混在する人物像の詳細",
                  evidence: [bad, good],
                },
                {
                  ...template,
                  attributeStableKey: null,
                  rawLabel: "独立したモデル知識",
                  valueText: "モデル知識の詳細",
                  explicitness: "model_knowledge" as const,
                  evidence: [{ ...bad, sourceUrl: null, sourceRef: "model_knowledge" }],
                },
              ]),
        ];
        candidate.summary.behavior = ["レビュー用の人物像"];
        for (const [topic, content] of Object.entries(candidate.summary)) {
          if (Array.isArray(content) && !content.length)
            candidate.uncertainties.push({ topic, reason: "fixtureでは不明" });
        }
      }
      if (
        ["preference_analysis", "preference_audit", "dark_preference_analysis", "dark_preference_audit"].includes(
          request.operation,
        )
      ) {
        const candidate = value as PreferenceCandidate;
        const template = candidate.preferenceAssertions[0];
        candidate.preferenceAssertions = [
          { ...template, attributeStableKey: null, rawLabel: "無効な好み", responseChannel: null, evidence: [bad] },
          { ...template, attributeStableKey: null, rawLabel: "有効な好み", responseChannel: null, evidence: [input] },
          {
            ...template,
            attributeStableKey: null,
            rawLabel: "混在する好み",
            responseChannel: null,
            evidence: [bad, input],
          },
        ];
        const stance = candidate.valueStanceAssertions[0];
        candidate.valueStanceAssertions = [
          { ...stance, targetRef: "無効な価値態度", evidence: [bad] },
          { ...stance, targetRef: "有効な価値態度", evidence: [input] },
        ];
      }
      const metadata: LlmRunMetadata = {
        operation: request.operation,
        provider: "fake",
        transport: "fake",
        adapterVersion: "test",
        requestedModel: "test",
        resolvedModel: "test",
        latencyMs: 1,
        dataRetentionMode: "no_retention",
        rootRequestId: request.idempotencyKey,
        citations: fixture.allowedUrls.map((url) => ({ url, title: "本文のない検索注釈" })),
      };
      return { value: request.schema.parse(value), metadata, attempts: [{ output: structuredClone(value), metadata }] };
    },
  };
  vi.spyOn(execution, "createJobLlmProvider").mockResolvedValue(provider);
  const draft = anyEntryDraftSchema.parse({
    registrationType: "existing",
    workTitle: "試験作品",
    characterName: "試験人物",
    identityResolution: { mode: "new" },
    referenceMaterial: "冷酷な知略を持つ悪役",
    preference: {
      likedReasons: liked,
      valueStanceNote: "悪そのもの",
      responseChannels: [domain === "dark" ? "villain_role_fascination" : "narrative_interest"],
    },
    ...(domain === "dark" ? { darkContext: { focusDescription: "自ら冷酷な知略で支配する悪役" } } : {}),
  });
  const entry = await createEntry(env, owner, domain, draft, crypto.randomUUID());
  const params = {
    jobId: entry.jobId,
    ownerUserId: owner,
    entryId: entry.entryId,
    stage: "understanding" as const,
    inputGeneration: 1,
    analysisDomain: domain,
  };
  await processCharacterAnalysis(env, params);
  const detail = await loadEntryReview(env, owner, domain, entry.entryId);
  expect(
    detail?.entry.status,
    JSON.stringify(db.database.prepare("SELECT error_code,error_detail_safe FROM jobs").all()),
  ).toBe("understanding_review");
  if (!detail?.understanding) throw new Error("missing understanding");
  return { db, env, owner, params, detail, snapshot: detail.understanding, requests };
}

describe.each(["standard", "dark"] as const)("citation recovery in %s", (domain) => {
  it.each(failures)("keeps $caseId reviewable with valid evidence intact and no extra LLM calls", async (fixture) => {
    const { snapshot, detail, requests } = await setup(domain, fixture);
    const bad = snapshot.assertions.find((item) => item.raw_label === "無効な人物属性");
    expect(bad).toMatchObject({
      confidence: 0,
      evidence: [{ verificationStatus: "invalid", sourceUrl: null, canNavigate: false }],
    });
    expect(snapshot.assertions.find((item) => item.raw_label === "混在する人物属性")?.confidence).toBeGreaterThan(0);
    expect(reviewDetailSchema.parse(detail).understanding?.citationIssues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reason: "url_not_allowed",
          sourceUrl: fixture.sourceUrl,
          targetId: bad?.id,
          modelRunId: expect.any(String),
        }),
      ]),
    );
    expect(requests.filter((item) => item.operation !== "dark_scope_assessment")).toHaveLength(
      domain === "dark" ? 2 : 4,
    );
  });

  it("does not adopt invalid-only assertions on confirmation, but accepts user corrections", async () => {
    const { env, owner, snapshot } = await setup(domain);
    await confirmUnderstanding(env, owner, domain, snapshot.id);
    const confirmed = await loadConfirmedUnderstanding(env, owner, snapshot.id);
    expect(confirmed.rows.map((item) => item.raw_label)).toEqual([
      "有効な人物属性",
      "混在する人物属性",
      "独立したモデル知識",
    ]);
    expect(confirmed.excluded).toContainEqual(
      expect.objectContaining({ raw_label: "無効な人物属性", status: "unverified" }),
    );
    expect(confirmed.assertions.find((item) => item.rawLabel === "混在する人物属性")?.evidence).toHaveLength(1);
    const correction = await setup(domain);
    await mutateUnderstandingReview(
      correction.env,
      correction.owner,
      domain,
      correction.snapshot.id,
      {
        action: "update_assertion",
        targetId: correction.snapshot.assertions[0].id,
        rawLabel: "訂正済み人物属性",
        valueText: "ユーザーが確認した人物像",
        attributeStableKey: null,
      },
      crypto.randomUUID(),
    );
    await confirmUnderstanding(correction.env, correction.owner, domain, correction.snapshot.id);
    const corrected = await loadConfirmedUnderstanding(correction.env, correction.owner, correction.snapshot.id);
    expect(corrected.assertions.find((item) => item.rawLabel === "訂正済み人物属性")?.evidence).toEqual([
      expect.objectContaining({
        quote: "ユーザーが確認した人物像",
        inputPointer: expect.stringContaining("/confirmedUnderstanding/"),
      }),
    ]);
  });

  it("excludes invalid-only preferences and stances from aggregation and retained refinements", async () => {
    const { env, owner, snapshot, params, db } = await setup(domain);
    await confirmUnderstanding(env, owner, domain, snapshot.id);
    await processPreferenceAnalysis(env, { ...params, stage: "preference" });
    const detail = await loadEntryReview(env, owner, domain, params.entryId);
    expect(
      detail?.entry.status,
      JSON.stringify(db.database.prepare("SELECT error_code,error_detail_safe FROM jobs").all()),
    ).toBe("analysis_review");
    const analysis = detail?.preferenceAnalysis;
    if (!analysis) throw new Error("missing preferences");
    expect(analysis.citationIssues).toHaveLength(3);
    expect(analysis.assertions.find((item) => item.raw_label === "無効な好み")?.confidence).toBe(0);
    const invalid = analysis.assertions.find((item) => item.raw_label === "無効な好み");
    if (!invalid) throw new Error("missing invalid preference");
    const correction = await mutatePreferenceReview(
      env,
      owner,
      domain,
      analysis.id,
      {
        action: "set_response_channel",
        targetId: invalid.id,
        responseChannel: domain === "dark" ? "dark_character_liking" : "admiration",
      },
      crypto.randomUUID(),
    );
    const corrected = await loadEntryReview(env, owner, domain, params.entryId);
    expect(corrected?.preferenceAnalysis?.assertions.find((item) => item.id === correction.changedId)).toMatchObject({
      confidence: 0,
      evidence: [expect.objectContaining({ verificationStatus: "invalid" })],
    });
    const activated = await activateAnalysisAndRebuild(env, owner, domain, analysis.id);
    await processProfileRebuild(env, {
      jobId: activated.profileJobId,
      ownerUserId: owner,
      desiredGeneration: activated.freshness.desiredGeneration,
    });
    const rows = await projection
      .selectPreferenceAssertions(db.DB, [owner, owner])
      .all<{ raw_label: string; evidence_count: number; evidence_quality: number }>();
    expect(rows.results?.map((row) => row.raw_label).sort()).toEqual(["有効な好み", "混在する好み"].sort());
    expect(rows.results?.every((row) => row.evidence_count === 1 && row.evidence_quality === 1)).toBe(true);
    const stances = await projection.selectValueStanceAssertions(db.DB, [owner, owner]).all<{ target_ref: string }>();
    expect(stances.results?.map((row) => row.target_ref)).toEqual(["有効な価値態度"]);
    const retained = await loadRetainedPreferences(env, owner, analysis.id);
    expect(retained.preferences).toHaveLength(2);
    expect(retained.stances).toHaveLength(1);
  });

  it("keeps an entirely unverified understanding reviewable and passes no assertions after confirmation", async () => {
    const { env, owner, snapshot } = await setup(domain, failures[0], true);
    expect(snapshot).not.toHaveProperty("confidence");
    expect(snapshot.evidenceSummary.counts.invalid).toBeGreaterThan(0);
    expect(snapshot.sourceAssessment.coverage).toBe("none");
    await confirmUnderstanding(env, owner, domain, snapshot.id);
    expect((await loadConfirmedUnderstanding(env, owner, snapshot.id)).assertions).toEqual([]);
  });
});
