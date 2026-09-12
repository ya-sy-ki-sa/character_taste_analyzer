import { afterEach, expect, vi } from "vitest";
import type { AnalysisDomain } from "../../shared/analysis-domain";
import { anyEntryDraftSchema } from "../../shared/contracts/entries";
import { reviewDetailSchema } from "../../shared/contracts/entry-review";
import {
  type AnyPreferenceCandidate,
  darkPreferenceCandidateSchema,
  preferenceCandidateSchema,
} from "../../shared/contracts/preference";
import type { UnderstandingAudit } from "../../shared/contracts/understanding-quality";
import { activateAnalysisAndRebuild } from "../../worker/features/analysis/activation";
import { processPreferenceAnalysis } from "../../worker/features/analysis/preference";
import { fakeGroundedPreferences, fakeGroundedUnderstanding } from "../../worker/features/analysis/semantic-fake";
import { processCharacterAnalysis } from "../../worker/features/analysis/understanding";
import { createEntry } from "../../worker/features/entries/create";
import { loadEntryReview } from "../../worker/features/entries/review";
import { confirmUnderstanding } from "../../worker/features/entries/understanding-review";
import { loadCurrentProfile, processProfileRebuild } from "../../worker/features/profile/projection";
import * as execution from "../../worker/llm/execution";
import type { LlmProvider, StructuredLlmRequest } from "../../worker/llm/types";
import type { Env } from "../../worker/types";
import fixtures from "../fixtures/explicit-preferences.json";
import { testDatabase } from "./database";

const databases: ReturnType<typeof testDatabase>[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) db.close();
});
export const context = {
  schemaVersion: "2" as const,
  entryScope: null,
  subjects: [],
  relationships: [],
  narrativePhases: [],
  conditions: [] as string[],
  exceptions: [],
};
// These are scripted provider outputs: they verify transport/storage, not live-model extraction accuracy.
export type Fixture = {
  caseId: string;
  auditOverride?: (
    value: import("../../shared/contracts/semantic-audit").GroundedPreferenceAudit,
  ) => import("../../shared/contracts/semantic-audit").GroundedPreferenceAudit;
  understanding?: UnderstandingAudit;
  understandingAuditOverride?: (
    value: import("../../shared/contracts/semantic-audit").GroundedUnderstandingAudit,
    auditNumber: number,
  ) => import("../../shared/contracts/semantic-audit").GroundedUnderstandingAudit;
  preference: { likedReasons: string; dislikedReasons?: string; responseChannels: string[] };
  expectedAssertions: Array<{
    rawLabel: string;
    quote: string;
    responseChannel: string | null;
    conditions: string[];
    polarity?: string;
    attributeStableKey?: string | null;
    inputPointer?: string;
    context?: Record<string, unknown>;
  }>;
  valueStances?: AnyPreferenceCandidate["valueStanceAssertions"];
  generatedCandidate?: AnyPreferenceCandidate;
  uncertainties?: AnyPreferenceCandidate["uncertainties"];
};
export function scriptedCandidate(fixture: Fixture, domain: AnalysisDomain = "standard"): AnyPreferenceCandidate {
  const evidence = (pointer: string, quote: string) => [
    { sourceRef: `input:${pointer}`, sourceUrl: null, inputPointer: pointer, quote, inferenceType: "direct" as const },
  ];
  const schema = domain === "dark" ? darkPreferenceCandidateSchema : preferenceCandidateSchema;
  return schema.parse({
    ...(domain === "dark" ? { auditNotes: [] } : {}),
    summary: { userExplicitSummary: [fixture.preference.likedReasons], inferredSummary: [], limitations: [] },
    preferenceAssertions: fixture.expectedAssertions.map((item) => ({
      attributeStableKey: item.attributeStableKey ?? null,
      rawLabel: item.rawLabel,
      polarity: item.polarity ?? "positive",
      responseChannel: item.responseChannel,
      strength: 0.9,
      explicitness: "user_explicit",
      confidence: 0.92,
      context: item.context ?? { ...context, conditions: item.conditions },
      evidence: evidence(item.inputPointer ?? "/preference/likedReasons", item.quote),
    })),
    valueStanceAssertions:
      fixture.valueStances ??
      (fixture.preference.dislikedReasons
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
        : []),
    uncertainties:
      fixture.uncertainties ??
      (fixture.expectedAssertions.length
        ? []
        : [
            {
              topic: "好きな理由",
              reason: "具体的な対象・理由が不明",
              recommendedQuestion: "どの点が気になりますか？",
            },
          ]),
  });
}
export async function setup(
  domain: AnalysisDomain,
  fixture: Fixture = fixtures[0],
  useScript = true,
  beforeConfirm?: (env: Env, owner: string, snapshotId: string) => Promise<void>,
) {
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
      if (
        domain === "standard" &&
        fixture.understanding &&
        ["character_understanding", "customization_delta", "understanding_audit"].includes(request.operation)
      )
        value = fixture.understanding as typeof value;
      if (useScript && /^(dark_)?preference_(analysis|audit)$/.test(request.operation)) {
        const scripted =
          request.operation.endsWith("_analysis") && fixture.generatedCandidate
            ? fixture.generatedCandidate
            : scriptedCandidate(fixture, domain);
        value = { ...scripted, ...(domain === "dark" ? { auditNotes: [] } : {}) } as typeof value;
      }
      if (domain === "standard" && request.operation === "understanding_audit")
        value = fakeGroundedUnderstanding(value as UnderstandingAudit) as typeof value;
      if (domain === "standard" && request.operation === "understanding_audit" && fixture.understandingAuditOverride)
        value = fixture.understandingAuditOverride(
          value as import("../../shared/contracts/semantic-audit").GroundedUnderstandingAudit,
          requests.filter((item) => item.operation === "understanding_audit").length,
        ) as typeof value;
      if (domain === "standard" && request.operation === "preference_audit")
        value = fakeGroundedPreferences(
          value as import("../../shared/contracts/preference").PreferenceCandidate,
        ) as typeof value;
      if (domain === "standard" && request.operation === "preference_audit" && fixture.auditOverride)
        value = fixture.auditOverride(
          value as import("../../shared/contracts/semantic-audit").GroundedPreferenceAudit,
        ) as typeof value;
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
  await beforeConfirm?.(env, owner, initial.understanding.id);
  await confirmUnderstanding(env, owner, domain, initial.understanding.id);
  await processPreferenceAnalysis(env, { ...params, stage: "preference" });
  const detail = await loadEntryReview(env, owner, domain, created.entryId);
  if (!detail?.preferenceAnalysis)
    throw new Error(JSON.stringify(db.database.prepare("SELECT error_detail_safe FROM jobs").all()));
  expect(reviewDetailSchema.safeParse(detail).success).toBe(true);
  return { db, env, owner, params, detail, analysis: detail.preferenceAnalysis, requests };
}
export async function rebuild(value: Awaited<ReturnType<typeof setup>>, domain: AnalysisDomain) {
  const { env, owner, analysis } = value;
  const activated = await activateAnalysisAndRebuild(env, owner, domain, analysis.id);
  await processProfileRebuild(env, {
    jobId: activated.profileJobId,
    ownerUserId: owner,
    desiredGeneration: activated.freshness.desiredGeneration,
  });
  return loadCurrentProfile(env, owner, domain);
}
