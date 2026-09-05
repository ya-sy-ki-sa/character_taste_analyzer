import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalysisDomain } from "../shared/analysis-domain";
import { anyEntryDraftSchema } from "../shared/contracts/entries";
import { reviewDetailSchema } from "../shared/contracts/entry-review";
import { generationRequestInputSchema } from "../shared/contracts/generation";
import { type AnyPreferenceCandidate, preferenceCandidateSchema } from "../shared/contracts/preference";
import { preferenceReviewMutationSchema } from "../shared/contracts/reviews";
import { activateAnalysisAndRebuild } from "../worker/features/analysis/activation";
import { processPreferenceAnalysis } from "../worker/features/analysis/preference";
import { processCharacterAnalysis } from "../worker/features/analysis/understanding";
import { createEntry } from "../worker/features/entries/create";
import { mutatePreferenceReview } from "../worker/features/entries/preference-review";
import { loadEntryReview } from "../worker/features/entries/review";
import { confirmUnderstanding } from "../worker/features/entries/understanding-review";
import { compileBrief } from "../worker/features/generation/brief";
import { createGenerationRequest } from "../worker/features/generation/request";
import { loadCurrentProfile, processProfileRebuild } from "../worker/features/profile/projection";
import { loadProfileSnapshotItems } from "../worker/features/profile/snapshot";
import * as execution from "../worker/llm/execution";
import { EXPLICIT_PREFERENCE_INSTRUCTION } from "../worker/llm/prompts/preference";
import type { LlmProvider, StructuredLlmRequest } from "../worker/llm/types";
import type { Env } from "../worker/types";
import fixtures from "./fixtures/explicit-preferences.json";
import { testDatabase } from "./support/database";

const databases: ReturnType<typeof testDatabase>[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) db.close();
});
const context = {
  schemaVersion: "2" as const,
  entryScope: null,
  subjects: [],
  relationships: [],
  narrativePhases: [],
  conditions: [] as string[],
  exceptions: [],
};
// These are scripted provider outputs: they verify transport/storage, not live-model extraction accuracy.
type Fixture = {
  caseId: string;
  preference: { likedReasons: string; dislikedReasons?: string; responseChannels: string[] };
  expectedAssertions: Array<{ rawLabel: string; quote: string; responseChannel: string | null; conditions: string[] }>;
};
function scriptedCandidate(fixture: Fixture): AnyPreferenceCandidate {
  const evidence = (pointer: string, quote: string) => [
    { sourceRef: `input:${pointer}`, sourceUrl: null, inputPointer: pointer, quote, inferenceType: "direct" as const },
  ];
  return preferenceCandidateSchema.parse({
    summary: { userExplicitSummary: [fixture.preference.likedReasons], inferredSummary: [], limitations: [] },
    preferenceAssertions: fixture.expectedAssertions.map((item) => ({
      attributeStableKey: null,
      rawLabel: item.rawLabel,
      polarity: "positive",
      responseChannel: item.responseChannel,
      strength: 0.9,
      explicitness: "user_explicit",
      confidence: 0.92,
      context: { ...context, conditions: item.conditions },
      evidence: evidence("/preference/likedReasons", item.quote),
    })),
    valueStanceAssertions: fixture.preference.dislikedReasons
      ? [
          {
            targetType: "action",
            targetRef: "誰かを傷つける行為",
            stance: "reject",
            orientation: "mixed",
            context,
            explicitness: "user_explicit",
            confidence: 0.99,
            evidence: evidence("/preference/dislikedReasons", fixture.preference.dislikedReasons),
          },
        ]
      : [],
    uncertainties: fixture.expectedAssertions.length
      ? []
      : [{ topic: "好きな理由", reason: "具体的な対象・理由が不明", recommendedQuestion: "どの点が気になりますか？" }],
  });
}
async function setup(domain: AnalysisDomain, fixture: Fixture = fixtures[0], useScript = true) {
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
  const requests: StructuredLlmRequest<unknown>[] = [];
  const provider: LlmProvider = {
    providerId: "fake",
    async generateStructured(request) {
      requests.push(request);
      let value = request.fakeFactory();
      if (useScript && /^(dark_)?preference_(analysis|audit)$/.test(request.operation)) {
        const scripted = scriptedCandidate(fixture);
        value = { ...scripted, ...(domain === "dark" ? { auditNotes: [] } : {}) } as typeof value;
      }
      return {
        value: request.schema.parse(value),
        metadata: {
          operation: request.operation,
          provider: "fake",
          transport: "fake",
          adapterVersion: "test",
          requestedModel: "test",
          resolvedModel: "test",
          latencyMs: 1,
          dataRetentionMode: "no_retention",
          rootRequestId: request.idempotencyKey,
        },
      };
    },
  };
  vi.spyOn(execution, "createJobLlmProvider").mockResolvedValue(provider);
  const draft = anyEntryDraftSchema.parse({
    registrationType: "original",
    characterName: "固定応答テスト",
    characterBasicInfo: "冷酷な知略で支配する人物。",
    preference: fixture.preference,
    ...(domain === "dark" ? { darkContext: { focusDescription: "外部から操作され敵対する状態" } } : {}),
  });
  const created = await createEntry(env, owner, domain, draft, crypto.randomUUID());
  const params = {
    jobId: created.jobId,
    entryId: created.entryId,
    ownerUserId: owner,
    analysisDomain: domain,
    inputGeneration: 1,
    stage: "understanding" as const,
  };
  await processCharacterAnalysis(env, params);
  const initial = await loadEntryReview(env, owner, domain, created.entryId);
  if (!initial?.understanding)
    throw new Error(JSON.stringify(db.database.prepare("SELECT error_detail_safe FROM jobs").all()));
  await confirmUnderstanding(env, owner, domain, initial.understanding.id);
  await processPreferenceAnalysis(env, { ...params, stage: "preference" });
  const detail = await loadEntryReview(env, owner, domain, created.entryId);
  if (!detail?.preferenceAnalysis)
    throw new Error(JSON.stringify(db.database.prepare("SELECT error_detail_safe FROM jobs").all()));
  expect(reviewDetailSchema.safeParse(detail).success).toBe(true);
  return { db, env, owner, params, detail, analysis: detail.preferenceAnalysis, requests };
}
async function rebuild(value: Awaited<ReturnType<typeof setup>>, domain: AnalysisDomain) {
  const { env, owner, analysis } = value;
  const activated = await activateAnalysisAndRebuild(env, owner, domain, analysis.id);
  await processProfileRebuild(env, {
    jobId: activated.profileJobId,
    ownerUserId: owner,
    desiredGeneration: activated.freshness.desiredGeneration,
  });
  return loadCurrentProfile(env, owner, domain);
}

describe("frozen explicit preferences", () => {
  it.each(fixtures)(
    "preserves $caseId content, quotes and qualifications through the existing two calls",
    async (fixture) => {
      const result = await setup("standard", fixture);
      const { analysis, requests, db } = result;
      expect(analysis.assertions.map((item) => item.raw_label).sort()).toEqual(
        fixture.expectedAssertions.map((item) => item.rawLabel).sort(),
      );
      for (const expected of fixture.expectedAssertions) {
        const item = analysis.assertions.find((item) => item.raw_label === expected.rawLabel);
        if (!item) throw new Error("missing assertion");
        expect(item.response_channel).toBe(expected.responseChannel);
        expect(item.confidence).toBe(0.92);
        expect(item.evidence).toEqual([
          expect.objectContaining({ quote: expected.quote, verificationStatus: "verified_quote" }),
        ]);
        expect(
          JSON.parse(
            String(
              db.database.prepare("SELECT context_json FROM preference_assertions WHERE id=?").get(item.id)
                ?.context_json,
            ),
          ).conditions,
        ).toEqual(expected.conditions);
      }
      const calls = requests.filter((item) => /^(dark_)?preference_(analysis|audit)$/.test(item.operation));
      expect(calls).toHaveLength(2);
      expect(
        calls.every((item) =>
          item.messages.some((message) => message.content.includes(EXPLICIT_PREFERENCE_INSTRUCTION)),
        ),
      ).toBe(true);
      expect(analysis.qualityContext).toMatchObject({
        preferenceAssertionCount: fixture.expectedAssertions.length,
        valueStanceAssertionCount: fixture.preference.dislikedReasons ? 1 : 0,
        unresolvedResponseChannelCount: fixture.expectedAssertions.filter((item) => item.responseChannel === null)
          .length,
      });
      const runs = db.database
        .prepare("SELECT prompt_version,schema_version FROM model_run_metadata WHERE operation LIKE 'preference_%'")
        .all();
      expect(runs).toHaveLength(2);
      expect(
        runs.every((item) => String(item.prompt_version).endsWith("/v3.0.0") && item.schema_version === "3.0"),
      ).toBe(true);
      if (!fixture.expectedAssertions.length) {
        expect(analysis.summary.userExplicitSummary).toContain(fixture.preference.likedReasons);
        expect(analysis.uncertainties).not.toHaveLength(0);
      }
      const profile = await rebuild(result, "standard");
      expect(profile?.dimensions.map((item) => item.label).sort()).toEqual(
        fixture.expectedAssertions.map((item) => item.rawLabel).sort(),
      );
      if (!fixture.expectedAssertions.length) return;
      const snapshot = await loadProfileSnapshotItems(result.env, result.owner, "standard");
      if (!snapshot.snapshot) throw new Error("missing snapshot");
      const request = await createGenerationRequest(
        result.env,
        result.owner,
        "standard",
        generationRequestInputSchema.parse({
          profileSnapshotId: snapshot.snapshot.id,
          purpose: "具体的な好みを反映",
          selectedItemIds: snapshot.items.filter((item) => item.type === "dimension").map((item) => item.id),
        }),
        crypto.randomUUID(),
      );
      const { brief } = await compileBrief(result.env, result.owner, request.generationRequestId);
      expect(brief.preferenceSelections.map((item) => item.responseChannel).sort()).toEqual(
        fixture.expectedAssertions.map((item) => item.responseChannel).sort(),
      );
      for (const item of brief.preferenceSelections)
        expect(
          fixture.expectedAssertions.some(
            (expected) =>
              expected.rawLabel === item.label &&
              JSON.stringify(expected.conditions) === JSON.stringify(item.condition.conditions),
          ),
        ).toBe(true);
    },
  );
});

describe.each(["standard", "dark"] as const)("unresolved reaction in %s", (domain) => {
  it("preserves evidence and strength when setting a channel, including concurrent retries", async () => {
    const result = await setup(domain);
    const { env, owner, analysis, db } = result;
    const original = analysis.assertions[0];
    const input = preferenceReviewMutationSchema.parse({
      action: "set_response_channel",
      targetId: original.id,
      responseChannel: domain === "dark" ? "dark_character_liking" : "admiration",
    });
    if (input.action !== "set_response_channel") throw new Error("unexpected action");
    const key = crypto.randomUUID();
    const changed = await Promise.all(
      [1, 2].map(() => mutatePreferenceReview(env, owner, domain, analysis.id, input, key)),
    );
    expect(changed[0].changedId).toBe(changed[1].changedId);
    expect(changed.map((item) => item.replayed).sort()).toEqual([false, true]);
    const review = await loadEntryReview(env, owner, domain, result.params.entryId);
    const current = review?.preferenceAnalysis?.assertions.find((item) => item.id === changed[0].changedId);
    expect(current).toMatchObject({
      response_channel: input.responseChannel,
      confidence: original.confidence,
      strength: original.strength,
      explicitness: original.explicitness,
    });
    expect(
      db.database.prepare("SELECT context_json FROM preference_assertions WHERE id=?").get(current?.id ?? ""),
    ).toEqual(db.database.prepare("SELECT context_json FROM preference_assertions WHERE id=?").get(original.id));
    expect(current?.evidence.map(({ id: _id, ...item }) => item)).toEqual(
      original.evidence.map(({ id: _id, ...item }) => item),
    );
    expect(
      db.database.prepare("SELECT superseded_by_id FROM preference_assertions WHERE id=?").get(original.id)
        ?.superseded_by_id,
    ).toBe(current?.id);
    const profile = await rebuild(result, domain);
    expect(profile?.dimensions).toHaveLength(2);
    expect(profile?.dimensions.every((item) => item.evidenceCount === 1 && item.positiveScore > 0)).toBe(true);
    expect(new Set(profile?.dimensions.map((item) => item.positiveScore)).size).toBe(1);
    expect(new Set(profile?.dimensions.map((item) => item.confidence)).size).toBe(1);
    expect(await mutatePreferenceReview(env, owner, domain, analysis.id, input, key)).toMatchObject({ replayed: true });
  });
  it("keeps unknown channels in the profile without inventing a graph channel", async () => {
    const result = await setup(domain);
    const profile = await rebuild(result, domain);
    expect(profile?.dimensions).toHaveLength(2);
    expect(
      profile?.dimensions.every(
        (item) =>
          item.responseChannel === null && item.positiveScore > 0 && item.flags.includes("response_channel_unresolved"),
      ),
    ).toBe(true);
    expect(
      result.db.database
        .prepare("SELECT COUNT(*) n FROM graph_projection_nodes WHERE node_type='response_channel'")
        .get()?.n,
    ).toBe(0);
  });
  it("rolls back a channel correction if copying its evidence fails", async () => {
    const { env, owner, analysis, db } = await setup(domain);
    const before = db.database.prepare("SELECT * FROM preference_assertions ORDER BY id").all();
    const evidence = db.database.prepare("SELECT * FROM evidence_fragments ORDER BY id").all();
    db.database.exec(
      "CREATE TRIGGER fail_evidence_copy BEFORE INSERT ON evidence_fragments BEGIN SELECT RAISE(ABORT, 'injected copy failure'); END",
    );
    await expect(
      mutatePreferenceReview(
        env,
        owner,
        domain,
        analysis.id,
        { action: "set_response_channel", targetId: analysis.assertions[0].id, responseChannel: null },
        crypto.randomUUID(),
      ),
    ).rejects.toThrow("injected copy failure");
    expect(db.database.prepare("SELECT * FROM preference_assertions ORDER BY id").all()).toEqual(before);
    expect(db.database.prepare("SELECT * FROM evidence_fragments ORDER BY id").all()).toEqual(evidence);
  });
  it("rejects a foreign-domain channel and stale target without mutating the candidate", async () => {
    const { env, owner, analysis, db } = await setup(domain);
    await expect(
      mutatePreferenceReview(
        env,
        owner,
        domain,
        analysis.id,
        {
          action: "set_response_channel",
          targetId: analysis.assertions[0].id,
          responseChannel: domain === "dark" ? "admiration" : "dark_character_liking",
        },
        crypto.randomUUID(),
      ),
    ).rejects.toThrow("RESPONSE_CHANNEL_NOT_IN_DOMAIN");
    await expect(
      mutatePreferenceReview(
        env,
        owner,
        domain,
        analysis.id,
        { action: "set_response_channel", targetId: crypto.randomUUID(), responseChannel: null },
        crypto.randomUUID(),
      ),
    ).rejects.toThrow("PREFERENCE_REVIEW_STATE_CHANGED");
    expect(db.database.prepare("SELECT COUNT(*) n FROM preference_assertions").get()?.n).toBe(2);
  });
  it.each([false, true])("does not infer liking from an empty reason with selected=%s", async (selected) => {
    const fixture = {
      ...fixtures[0],
      preference: {
        likedReasons: "",
        responseChannels: selected ? [domain === "dark" ? "dark_character_liking" : "admiration"] : [],
      },
      expectedAssertions: [],
    };
    const result = await setup(domain, fixture, false);
    expect(result.analysis.assertions).toEqual([]);
  });
  it("extracts explicit negative and positive keyword examples without assigning a default channel", async () => {
    const fixture = {
      ...fixtures[0],
      preference: {
        likedReasons: "冷酷な知略が好き",
        dislikedReasons: "残酷に苦しめるところは苦手",
        responseChannels: [],
      },
      expectedAssertions: [],
    };
    const result = await setup(domain, fixture, false);
    expect(result.analysis.assertions.some((item) => item.polarity === "positive")).toBe(true);
    expect(result.analysis.assertions.some((item) => item.polarity === "negative")).toBe(true);
    expect(result.analysis.assertions.every((item) => item.response_channel === null)).toBe(true);
  });
  it.each(fixtures.filter((item) => !item.expectedAssertions.length))(
    "does not fabricate attributes for $caseId in the fake provider",
    async (fixture) => {
      const result = await setup(domain, fixture, false);
      expect(result.analysis.assertions).toEqual([]);
      expect(result.analysis.summary.userExplicitSummary).toContain(fixture.preference.likedReasons);
      expect(result.analysis.uncertainties.length).toBeGreaterThan(0);
    },
  );
});
