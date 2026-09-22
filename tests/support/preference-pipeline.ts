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
import { choiceAnswer, scoreAnswer } from "../../worker/judgment/policy";
import * as judgmentProvider from "../../worker/judgment/provider";
import type { JudgmentAnswer, JudgmentQuestion } from "../../worker/judgment/types";
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
    JEV_PROVIDER: "fake",
    JEV_MODEL: "typesafe/jev",
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
        ["character_understanding", "customization_delta"].includes(request.operation)
      )
        value = fixture.understanding as typeof value;
      if (useScript && ["preference_analysis", "dark_preference_analysis"].includes(request.operation)) {
        const scripted = fixture.generatedCandidate ?? scriptedCandidate(fixture, domain);
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
  const preferenceAudit = fixture.auditOverride?.(
    fakeGroundedPreferences(
      structuredClone(
        (fixture.generatedCandidate ??
          scriptedCandidate(fixture, domain)) as import("../../shared/contracts/preference").PreferenceCandidate,
      ),
    ),
  );
  const understandingAudits = new Map<
    number,
    import("../../shared/contracts/semantic-audit").GroundedUnderstandingAudit
  >();
  const overrideChoice = (
    answers: Record<string, JudgmentAnswer>,
    questions: Record<string, JudgmentQuestion>,
    id: string,
    choice: string,
  ) => {
    const question = questions[id];
    if (question?.type === "choice" && choice in question.criteria) answers[id] = choiceAnswer(question, choice);
  };
  vi.spyOn(judgmentProvider, "createJudgmentProvider").mockReturnValue({
    providerId: "fake",
    async evaluate(request) {
      if (!request.fakeAnswers) throw new Error("TEST_JUDGMENT_FIXTURE_MISSING");
      const answers = structuredClone(request.fakeAnswers);
      const understandingMatch = request.context.stage.match(/^(?:base|target)(?::reconsider:(\d+))?:assertion$/u);
      if (understandingMatch && fixture.understanding && fixture.understandingAuditOverride) {
        const round = Number(understandingMatch[1] ?? 0);
        let audit = understandingAudits.get(round);
        if (!audit) {
          audit = fixture.understandingAuditOverride(
            fakeGroundedUnderstanding(structuredClone(fixture.understanding)),
            round + 1,
          );
          understandingAudits.set(round, audit);
        }
        for (const id of Object.keys(request.questions)) {
          const match = id.match(/^assertion_(\d+)_(scope|evidence_(\d+)|set)$/u);
          if (!match) continue;
          const assertion = audit.assertions[Number(match[1])];
          if (!assertion) continue;
          if (match[2] === "scope") overrideChoice(answers, request.questions, id, assertion.scopeAssessment.verdict);
          else if (match[2] === "set" && assertion.evidenceSetAssessment)
            overrideChoice(answers, request.questions, id, assertion.evidenceSetAssessment.verdict);
          else {
            const evidence = assertion.evidence[Number(match[3])];
            if (evidence) overrideChoice(answers, request.questions, id, evidence.supportAssessment.verdict);
          }
        }
      }
      if (preferenceAudit && request.context.stage.startsWith("preference:")) {
        for (const id of Object.keys(request.questions)) {
          const match = id.match(
            /^(preference|stance)_(\d+)(?:_projected)?_(scope|evidence_(\d+)|set|explicitness|polarity|strength)$/u,
          );
          if (!match) continue;
          const assertion =
            match[1] === "preference"
              ? preferenceAudit.preferenceAssertions[Number(match[2])]
              : preferenceAudit.valueStanceAssertions[Number(match[2])];
          if (!assertion) continue;
          const field = match[3];
          if (field === "scope") overrideChoice(answers, request.questions, id, assertion.scopeAssessment.verdict);
          else if (field === "set" && assertion.evidenceSetAssessment)
            overrideChoice(answers, request.questions, id, assertion.evidenceSetAssessment.verdict);
          else if (field === "explicitness") overrideChoice(answers, request.questions, id, assertion.explicitness);
          else if (field === "polarity" && "polarity" in assertion)
            overrideChoice(answers, request.questions, id, assertion.polarity);
          else if (field === "strength" && "strength" in assertion) {
            const question = request.questions[id];
            if (question?.type === "score") {
              const anchors = [0.3, 0.6, 0.8, 0.95];
              const level = anchors.reduce(
                (best, anchor, index) =>
                  Math.abs(anchor - assertion.strength) < Math.abs(anchors[best] - assertion.strength) ? index : best,
                0,
              );
              answers[id] = scoreAnswer(question, level);
            }
          } else {
            const evidence = assertion.evidence[Number(match[4])];
            if (evidence) overrideChoice(answers, request.questions, id, evidence.supportAssessment.verdict);
          }
        }
      }
      return { answers, model: "fake:typesafe/jev", usage: { input_tokens: 0, output_tokens: 0 } };
    },
  });
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
